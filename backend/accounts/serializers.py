from django.contrib.auth import get_user_model
from django.contrib.auth.validators import UnicodeUsernameValidator
from django.db import transaction
from rest_framework import serializers

from accounts.crypto import SALT_BYTES, b64decode_strict
from accounts.models import Profile

User = get_user_model()

AUTH_HASH_BYTES = 32  # PBKDF2-SHA256 output, 256 bits
# AES-GCM: 12-byte IV + 32-byte key + 16-byte tag. Upper bound just guards against junk.
ENCRYPTED_MASTER_KEY_MIN_BYTES = 12 + 32 + 16
ENCRYPTED_MASTER_KEY_MAX_BYTES = 512


def _validate_b64(value: str, *, exact: int | None = None, min_len: int = 0, max_len: int | None = None) -> str:
    try:
        raw = b64decode_strict(value)
    except ValueError:
        raise serializers.ValidationError("Must be valid base64.")
    if exact is not None and len(raw) != exact:
        raise serializers.ValidationError(f"Must decode to exactly {exact} bytes.")
    if len(raw) < min_len or (max_len is not None and len(raw) > max_len):
        raise serializers.ValidationError("Unexpected length.")
    return value


class UsernameField(serializers.CharField):
    def __init__(self, **kwargs):
        super().__init__(max_length=150, validators=[UnicodeUsernameValidator()], **kwargs)


class RegisterSerializer(serializers.Serializer):
    username = UsernameField()
    auth_hash = serializers.CharField(write_only=True)
    salt = serializers.CharField(write_only=True)
    encrypted_master_key = serializers.CharField(write_only=True)

    def validate_username(self, value: str) -> str:
        if User.objects.filter(username__iexact=value).exists():
            raise serializers.ValidationError("This username is already taken.")
        return value

    def validate_auth_hash(self, value: str) -> str:
        return _validate_b64(value, exact=AUTH_HASH_BYTES)

    def validate_salt(self, value: str) -> str:
        return _validate_b64(value, exact=SALT_BYTES)

    def validate_encrypted_master_key(self, value: str) -> str:
        return _validate_b64(
            value,
            min_len=ENCRYPTED_MASTER_KEY_MIN_BYTES,
            max_len=ENCRYPTED_MASTER_KEY_MAX_BYTES,
        )

    @transaction.atomic
    def create(self, validated_data):
        # auth_hash is not the user's password but a value derived from it in the browser,
        # so Django's password-strength validators are meaningless here; Django still hashes it.
        user = User(username=validated_data["username"])
        user.set_password(validated_data["auth_hash"])
        user.save()
        Profile.objects.create(
            user=user,
            salt=validated_data["salt"],
            encrypted_master_key=validated_data["encrypted_master_key"],
        )
        return user


class SaltRequestSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=150)


class SaltResponseSerializer(serializers.Serializer):
    salt = serializers.CharField()


class LoginSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=150)
    auth_hash = serializers.CharField(write_only=True)


class LoginResponseSerializer(serializers.Serializer):
    access = serializers.CharField()
    refresh = serializers.CharField()
    encrypted_master_key = serializers.CharField()


class RegisterResponseSerializer(serializers.Serializer):
    username = serializers.CharField()

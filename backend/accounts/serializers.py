from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.hashers import check_password, make_password
from django.contrib.auth.validators import UnicodeUsernameValidator
from django.db import transaction
from rest_framework import serializers

from accounts.avatars import DEFAULT_AVATARS, MAX_AVATAR_BYTES
from accounts.crypto import SALT_BYTES
from accounts.models import Profile
from config.validators import GCM_OVERHEAD_BYTES, validate_b64
from storage.services import used_bytes

User = get_user_model()

AUTH_HASH_BYTES = 32  # PBKDF2-SHA256 output, 256 bits
# Encrypted 32-byte AES key. Upper bound just guards against junk.
ENCRYPTED_MASTER_KEY_MIN_BYTES = GCM_OVERHEAD_BYTES + 32
ENCRYPTED_MASTER_KEY_MAX_BYTES = 512


def validate_encrypted_key(value: str) -> str:
    return validate_b64(value, min_len=ENCRYPTED_MASTER_KEY_MIN_BYTES, max_len=ENCRYPTED_MASTER_KEY_MAX_BYTES)


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
        return validate_b64(value, exact=AUTH_HASH_BYTES)

    def validate_salt(self, value: str) -> str:
        return validate_b64(value, exact=SALT_BYTES)

    def validate_encrypted_master_key(self, value: str) -> str:
        return validate_encrypted_key(value)

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
    default_avatar = serializers.CharField()


class RegisterResponseSerializer(serializers.Serializer):
    username = serializers.CharField()


class NewPasswordMixin(serializers.Serializer):
    """Fields for setting a new password: the same masterKey re-encrypted under the new password.

    Files are untouched: they are encrypted with fileKeys under masterKey, which does not change.
    """

    new_auth_hash = serializers.CharField(write_only=True)
    new_salt = serializers.CharField(write_only=True)
    new_encrypted_master_key = serializers.CharField(write_only=True)

    def validate_new_auth_hash(self, value: str) -> str:
        return validate_b64(value, exact=AUTH_HASH_BYTES)

    def validate_new_salt(self, value: str) -> str:
        return validate_b64(value, exact=SALT_BYTES)

    def validate_new_encrypted_master_key(self, value: str) -> str:
        return validate_encrypted_key(value)

    @transaction.atomic
    def set_new_password(self, user) -> None:
        user.set_password(self.validated_data["new_auth_hash"])
        user.save(update_fields=["password"])
        profile = user.profile
        profile.salt = self.validated_data["new_salt"]
        profile.encrypted_master_key = self.validated_data["new_encrypted_master_key"]
        profile.save(update_fields=["salt", "encrypted_master_key"])


class CurrentPasswordMixin(serializers.Serializer):
    """Re-confirms the password for sensitive actions, so a stolen access token is not enough."""

    auth_hash = serializers.CharField(write_only=True)

    def validate_auth_hash(self, value: str) -> str:
        if not self.context["request"].user.check_password(value):
            raise serializers.ValidationError("Current password is incorrect.")
        return value


class ChangePasswordSerializer(NewPasswordMixin):
    old_auth_hash = serializers.CharField(write_only=True)

    def validate_old_auth_hash(self, value: str) -> str:
        if not self.context["request"].user.check_password(value):
            raise serializers.ValidationError("Current password is incorrect.")
        return value

    def save(self) -> None:
        self.set_new_password(self.context["request"].user)


# --- recovery key ---


class RecoverySetupSerializer(CurrentPasswordMixin):
    recovery_auth_hash = serializers.CharField(write_only=True)
    recovery_encrypted_master_key = serializers.CharField(write_only=True)

    def validate_recovery_auth_hash(self, value: str) -> str:
        return validate_b64(value, exact=AUTH_HASH_BYTES)

    def validate_recovery_encrypted_master_key(self, value: str) -> str:
        return validate_encrypted_key(value)

    def save(self) -> None:
        profile = self.context["request"].user.profile
        profile.recovery_auth_hash = make_password(self.validated_data["recovery_auth_hash"])
        profile.recovery_encrypted_master_key = self.validated_data["recovery_encrypted_master_key"]
        profile.save(update_fields=["recovery_auth_hash", "recovery_encrypted_master_key"])


class DeleteAccountSerializer(CurrentPasswordMixin):
    pass


class RecoveryDisableSerializer(CurrentPasswordMixin):
    def save(self) -> None:
        profile = self.context["request"].user.profile
        profile.recovery_auth_hash = ""
        profile.recovery_encrypted_master_key = ""
        profile.save(update_fields=["recovery_auth_hash", "recovery_encrypted_master_key"])


def profile_for_recovery(username: str, recovery_auth_hash: str) -> Profile | None:
    """The profile if the recovery key is right; None otherwise (same timing either way)."""
    profile = (
        Profile.objects.filter(user__username=username, user__is_active=True)
        .exclude(recovery_auth_hash="")
        .select_related("user")
        .first()
    )
    if profile is None:
        make_password(recovery_auth_hash)  # spend the same time as a real check
        return None
    return profile if check_password(recovery_auth_hash, profile.recovery_auth_hash) else None


class RecoveryVerifySerializer(serializers.Serializer):
    username = serializers.CharField(max_length=150)
    recovery_auth_hash = serializers.CharField(write_only=True)


class RecoveryVerifyResponseSerializer(serializers.Serializer):
    recovery_encrypted_master_key = serializers.CharField()


class RecoveryResetSerializer(NewPasswordMixin, RecoveryVerifySerializer):
    pass


class SessionSerializer(serializers.Serializer):
    """Who the session cookie belongs to; shown on the unlock screen after a reload."""

    username = serializers.CharField()
    default_avatar = serializers.CharField()


class SessionActivateSerializer(serializers.Serializer):
    refresh = serializers.CharField(write_only=True)


class MeSerializer(serializers.Serializer):
    username = serializers.CharField(source="user.username", read_only=True)
    default_avatar = serializers.ChoiceField(choices=DEFAULT_AVATARS)
    has_custom_avatar = serializers.SerializerMethodField()
    has_recovery_key = serializers.BooleanField(read_only=True)
    storage_used = serializers.SerializerMethodField()
    storage_quota = serializers.SerializerMethodField()

    def get_has_custom_avatar(self, profile) -> bool:
        return bool(profile.encrypted_avatar)

    def get_storage_used(self, profile) -> int:
        return used_bytes(profile.user)

    def get_storage_quota(self, profile) -> int:
        return settings.STORAGE_QUOTA_BYTES


class AvatarUploadSerializer(serializers.Serializer):
    blob = serializers.FileField(allow_empty_file=False)

    def validate_blob(self, blob):
        if blob.size <= GCM_OVERHEAD_BYTES:
            raise serializers.ValidationError("Blob is too small to be AES-GCM ciphertext.")
        if blob.size > MAX_AVATAR_BYTES:
            raise serializers.ValidationError("Avatar is larger than 1 MB.")
        return blob

from django.conf import settings
from rest_framework import serializers

from config.validators import GCM_OVERHEAD_BYTES, validate_b64
from storage.models import File, Folder
from storage.services import used_bytes

MAX_PLAINTEXT_BYTES = 200 * 1024 * 1024  # files are encrypted whole in browser memory
MAX_BLOB_BYTES = MAX_PLAINTEXT_BYTES + GCM_OVERHEAD_BYTES
MAX_ENCRYPTED_NAME_BYTES = 4096
ENCRYPTED_KEY_BYTES = GCM_OVERHEAD_BYTES + 32  # encrypted raw AES-256 key


def validate_encrypted_name(value: str) -> str:
    return validate_b64(value, min_len=GCM_OVERHEAD_BYTES, max_len=MAX_ENCRYPTED_NAME_BYTES)


class OwnedFolderField(serializers.PrimaryKeyRelatedField):
    """A folder reference limited to the requesting user's folders (others look nonexistent)."""

    def __init__(self, **kwargs):
        kwargs.setdefault("allow_null", True)
        kwargs.setdefault("required", False)
        super().__init__(**kwargs)

    def get_queryset(self):
        return Folder.objects.filter(owner=self.context["request"].user)


class FolderSerializer(serializers.ModelSerializer):
    parent = OwnedFolderField()
    encrypted_name = serializers.CharField(validators=[validate_encrypted_name])

    class Meta:
        model = Folder
        fields = ["id", "parent", "encrypted_name", "created_at"]
        read_only_fields = ["id", "created_at"]

    def validate_parent(self, parent: Folder | None) -> Folder | None:
        # Moving a folder into itself or its own subtree would create a cycle.
        if self.instance is not None and parent is not None and parent.is_descendant_of(self.instance):
            raise serializers.ValidationError("Cannot move a folder into itself or its subfolder.")
        return parent


class PathItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = Folder
        fields = ["id", "encrypted_name"]


class FileSerializer(serializers.ModelSerializer):
    """Metadata of a file. The blob itself is only available via the download endpoint."""

    folder = OwnedFolderField()
    encrypted_name = serializers.CharField(validators=[validate_encrypted_name])

    class Meta:
        model = File
        fields = ["id", "folder", "encrypted_name", "encrypted_file_key", "size", "created_at"]
        read_only_fields = ["id", "encrypted_file_key", "size", "created_at"]


class FileUploadSerializer(serializers.ModelSerializer):
    folder = OwnedFolderField()
    encrypted_name = serializers.CharField(validators=[validate_encrypted_name])
    encrypted_file_key = serializers.CharField(
        validators=[lambda v: validate_b64(v, exact=ENCRYPTED_KEY_BYTES)],
    )
    blob = serializers.FileField(write_only=True, allow_empty_file=False)

    class Meta:
        model = File
        fields = ["id", "folder", "encrypted_name", "encrypted_file_key", "blob", "size", "created_at"]
        read_only_fields = ["id", "size", "created_at"]

    def validate_blob(self, blob):
        if blob.size < GCM_OVERHEAD_BYTES:
            raise serializers.ValidationError("Blob is too small to be AES-GCM ciphertext.")
        if blob.size > MAX_BLOB_BYTES:
            raise serializers.ValidationError("File is larger than 200 MB.")
        if used_bytes(self.context["request"].user) + blob.size > settings.STORAGE_QUOTA_BYTES:
            raise serializers.ValidationError("Storage quota exceeded.")
        return blob

    def create(self, validated_data):
        validated_data["size"] = validated_data["blob"].size
        return super().create(validated_data)


class FolderContentsSerializer(serializers.Serializer):
    """Response of GET /folders/?parent=…: the folder, its path from root and its children."""

    folder = FolderSerializer(allow_null=True)
    path = PathItemSerializer(many=True)
    folders = FolderSerializer(many=True)
    files = FileSerializer(many=True)

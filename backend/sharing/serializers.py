from django.utils import timezone
from rest_framework import serializers

from sharing.models import ShareLink
from storage.models import File

MAX_DOWNLOADS_LIMIT = 1000


class ShareLinkSerializer(serializers.ModelSerializer):
    """Owner's view of a link."""

    file = serializers.PrimaryKeyRelatedField(queryset=File.objects.none())
    max_downloads = serializers.IntegerField(
        min_value=1, max_value=MAX_DOWNLOADS_LIMIT, allow_null=True, required=False
    )
    downloads_left = serializers.IntegerField(read_only=True, allow_null=True)

    class Meta:
        model = ShareLink
        fields = ["id", "file", "expires_at", "max_downloads", "download_count", "downloads_left", "created_at"]
        read_only_fields = ["id", "download_count", "created_at"]

    def get_fields(self):
        fields = super().get_fields()
        # Only the requesting user's files can be shared; others look nonexistent.
        request = self.context.get("request")
        user = getattr(request, "user", None)
        # (Anonymous only during OpenAPI schema generation.)
        fields["file"].queryset = (
            File.objects.filter(owner=user) if user and user.is_authenticated else File.objects.none()
        )
        return fields

    def validate_expires_at(self, value):
        if value is not None and value <= timezone.now():
            raise serializers.ValidationError("Must be in the future.")
        return value


class PublicShareSerializer(serializers.ModelSerializer):
    """What anyone with the link sees. No ids or owner info: just ciphertext metadata."""

    encrypted_name = serializers.CharField(source="file.encrypted_name")
    size = serializers.IntegerField(source="file.size")
    downloads_left = serializers.IntegerField(allow_null=True)

    class Meta:
        model = ShareLink
        fields = ["encrypted_name", "size", "expires_at", "downloads_left"]

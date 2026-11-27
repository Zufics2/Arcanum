import uuid

from django.conf import settings
from django.db import models


def blob_upload_to(instance: "File", filename: str) -> str:
    # The original filename is ignored on purpose: on disk every blob gets a random name.
    return f"blobs/{uuid.uuid4().hex}"


class Folder(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="folders")
    parent = models.ForeignKey(
        "self",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="children",
    )  # null = root
    encrypted_name = models.TextField()  # base64(iv || ciphertext), encrypted with masterKey
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]
        indexes = [models.Index(fields=["owner", "parent"])]

    def __str__(self) -> str:
        return f"Folder({self.id})"

    def ancestors(self) -> list["Folder"]:
        """Folders from the root down to this one (inclusive)."""
        chain = []
        node: Folder | None = self
        while node is not None:
            chain.append(node)
            node = node.parent
        return list(reversed(chain))

    def is_descendant_of(self, other: "Folder") -> bool:
        """True if ``self`` is ``other`` or lies anywhere inside it."""
        node: Folder | None = self
        while node is not None:
            if node.pk == other.pk:
                return True
            node = node.parent
        return False


class File(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="files")
    folder = models.ForeignKey(
        Folder,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="files",
    )  # null = root
    encrypted_name = models.TextField()  # encrypted with this file's fileKey
    encrypted_file_key = models.TextField()  # fileKey encrypted with masterKey
    blob = models.FileField(upload_to=blob_upload_to)  # ciphertext only
    size = models.BigIntegerField()  # ciphertext size in bytes
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["owner", "folder"])]

    def __str__(self) -> str:
        return f"File({self.id})"

import secrets

from django.db import models
from django.utils import timezone

from storage.models import File


def generate_link_id() -> str:
    # 16 random bytes = 128 bits: share links cannot be guessed or enumerated.
    return secrets.token_urlsafe(16)


class ShareLinkQuerySet(models.QuerySet):
    def expired(self):
        return self.filter(expires_at__lte=timezone.now())

    def active(self):
        return self.filter(models.Q(expires_at__isnull=True) | models.Q(expires_at__gt=timezone.now()))


class ShareLink(models.Model):
    """A public, self-destructing link to one file.

    The decryption key is NOT stored here: it travels only in the URL fragment (#key),
    which browsers never send to the server.
    """

    id = models.CharField(primary_key=True, max_length=32, default=generate_link_id, editable=False)
    file = models.ForeignKey(File, on_delete=models.CASCADE, related_name="share_links")
    expires_at = models.DateTimeField(null=True, blank=True)  # null = no time limit
    max_downloads = models.PositiveIntegerField(null=True, blank=True)  # null = unlimited
    download_count = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    objects = ShareLinkQuerySet.as_manager()

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"ShareLink({self.id})"

    @property
    def is_expired(self) -> bool:
        return self.expires_at is not None and self.expires_at <= timezone.now()

    @property
    def is_exhausted(self) -> bool:
        return self.max_downloads is not None and self.download_count >= self.max_downloads

    @property
    def downloads_left(self) -> int | None:
        return None if self.max_downloads is None else max(0, self.max_downloads - self.download_count)

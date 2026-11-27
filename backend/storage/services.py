from django.db.models import Sum

from storage.models import File


def used_bytes(user) -> int:
    """Total ciphertext size stored by the user."""
    return File.objects.filter(owner=user).aggregate(total=Sum("size"))["total"] or 0

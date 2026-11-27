from django.db import transaction
from django.db.models.signals import post_delete
from django.dispatch import receiver

from storage.models import File


@receiver(post_delete, sender=File)
def delete_blob_from_disk(sender, instance: File, **kwargs) -> None:
    """Remove the encrypted blob once the row is gone.

    Fires for cascaded deletes too (folder or account removal). Deferred to on_commit
    so a rolled-back transaction never leaves a row pointing to a missing blob.
    """
    if not instance.blob:
        return
    storage, name = instance.blob.storage, instance.blob.name
    transaction.on_commit(lambda: storage.delete(name))

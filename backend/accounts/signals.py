from django.db import transaction
from django.db.models.signals import post_delete
from django.dispatch import receiver

from accounts.models import Profile


@receiver(post_delete, sender=Profile)
def delete_avatar_from_disk(sender, instance: Profile, **kwargs) -> None:
    if instance.encrypted_avatar:
        storage, name = instance.encrypted_avatar.storage, instance.encrypted_avatar.name
        transaction.on_commit(lambda: storage.delete(name))

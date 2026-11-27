from django.apps import AppConfig


class StorageConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "storage"

    def ready(self) -> None:
        from storage import signals  # noqa: F401

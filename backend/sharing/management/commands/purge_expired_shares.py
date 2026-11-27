from django.core.management.base import BaseCommand
from django.db.models import F

from sharing.models import ShareLink


class Command(BaseCommand):
    help = "Delete share links that are expired or have used up their downloads (run from cron)."

    def handle(self, *args, **options):
        expired, _ = ShareLink.objects.expired().delete()
        exhausted, _ = ShareLink.objects.filter(
            max_downloads__isnull=False, download_count__gte=F("max_downloads")
        ).delete()
        self.stdout.write(f"Deleted {expired + exhausted} share link(s).")

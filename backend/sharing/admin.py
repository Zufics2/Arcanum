from django.contrib import admin

from sharing.models import ShareLink


@admin.register(ShareLink)
class ShareLinkAdmin(admin.ModelAdmin):
    list_display = ("id", "file", "expires_at", "download_count", "max_downloads", "created_at")
    readonly_fields = ("id", "file", "download_count", "created_at")

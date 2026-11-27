from django.contrib import admin

from storage.models import File, Folder


@admin.register(Folder)
class FolderAdmin(admin.ModelAdmin):
    list_display = ("id", "owner", "parent", "created_at")
    list_filter = ("owner",)
    readonly_fields = ("encrypted_name",)


@admin.register(File)
class FileAdmin(admin.ModelAdmin):
    list_display = ("id", "owner", "folder", "size", "created_at")
    list_filter = ("owner",)
    readonly_fields = ("encrypted_name", "encrypted_file_key", "blob", "size")

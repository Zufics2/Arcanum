from django.contrib import admin

from accounts.models import Profile


@admin.register(Profile)
class ProfileAdmin(admin.ModelAdmin):
    list_display = ("user",)
    search_fields = ("user__username",)
    # Crypto material is opaque to the server; show it read-only.
    readonly_fields = ("user", "salt", "encrypted_master_key")

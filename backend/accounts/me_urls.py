from django.urls import path

from accounts.views import AvatarView, MeView

urlpatterns = [
    path("", MeView.as_view(), name="me"),
    path("avatar/", AvatarView.as_view(), name="me-avatar"),
]

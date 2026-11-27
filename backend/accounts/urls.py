from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView

from accounts.views import (
    ChangePasswordView,
    DeleteAccountView,
    LoginView,
    LogoutView,
    RecoveryResetView,
    RecoveryVerifyView,
    RecoveryView,
    RegisterView,
    SaltView,
    SessionView,
)

urlpatterns = [
    path("register/", RegisterView.as_view(), name="auth-register"),
    path("salt/", SaltView.as_view(), name="auth-salt"),
    path("login/", LoginView.as_view(), name="auth-login"),
    path("refresh/", TokenRefreshView.as_view(), name="auth-refresh"),
    path("session/", SessionView.as_view(), name="auth-session"),
    path("logout/", LogoutView.as_view(), name="auth-logout"),
    path("change-password/", ChangePasswordView.as_view(), name="auth-change-password"),
    path("account/", DeleteAccountView.as_view(), name="auth-account"),
    path("recovery/", RecoveryView.as_view(), name="auth-recovery"),
    path("recovery/verify/", RecoveryVerifyView.as_view(), name="auth-recovery-verify"),
    path("recovery/reset/", RecoveryResetView.as_view(), name="auth-recovery-reset"),
]

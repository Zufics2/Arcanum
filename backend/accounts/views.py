from django.conf import settings
from django.contrib.auth import authenticate
from django.contrib.auth.models import update_last_login
from django.db import transaction
from django.http import FileResponse, Http404
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import status
from rest_framework.parsers import MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.crypto import fake_salt
from accounts.models import Profile
from accounts.serializers import (
    AvatarUploadSerializer,
    ChangePasswordSerializer,
    LoginResponseSerializer,
    LoginSerializer,
    MeSerializer,
    RecoveryDisableSerializer,
    RecoveryResetSerializer,
    RecoverySetupSerializer,
    RecoveryVerifyResponseSerializer,
    RecoveryVerifySerializer,
    RegisterResponseSerializer,
    RegisterSerializer,
    SaltRequestSerializer,
    SaltResponseSerializer,
    SessionActivateSerializer,
    SessionSerializer,
    profile_for_recovery,
)
from accounts.session import clear_refresh_cookie, set_refresh_cookie, user_from_refresh


class PublicAPIView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]


class RegisterView(PublicAPIView):
    @extend_schema(request=RegisterSerializer, responses={201: RegisterResponseSerializer})
    def post(self, request: Request) -> Response:
        serializer = RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        return Response({"username": user.username}, status=status.HTTP_201_CREATED)


class SaltView(PublicAPIView):
    @extend_schema(request=SaltRequestSerializer, responses=SaltResponseSerializer)
    def post(self, request: Request) -> Response:
        serializer = SaltRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        username = serializer.validated_data["username"]

        profile = Profile.objects.filter(user__username=username).only("salt").first()
        salt = profile.salt if profile else fake_salt(username)
        return Response({"salt": salt})


class LoginView(PublicAPIView):
    @extend_schema(request=LoginSerializer, responses={200: LoginResponseSerializer})
    def post(self, request: Request) -> Response:
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        # ModelBackend runs the password hasher even for unknown users, so response time
        # does not reveal whether the username exists.
        user = authenticate(
            request,
            username=serializer.validated_data["username"],
            password=serializer.validated_data["auth_hash"],
        )
        if user is None:
            return Response(
                {"detail": "Invalid username or password."},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        update_last_login(None, user)
        refresh = RefreshToken.for_user(user)
        response = Response(
            {
                "access": str(refresh.access_token),
                "refresh": str(refresh),
                "encrypted_master_key": user.profile.encrypted_master_key,
                "default_avatar": user.profile.default_avatar,
            }
        )
        set_refresh_cookie(response, str(refresh))
        return response


class SessionView(PublicAPIView):
    """The session stored in the httpOnly cookie.

    GET tells a freshly loaded page who is logged in (for the unlock screen).
    POST makes another in-memory session the one restored after reload (account switch).
    """

    @extend_schema(responses={200: SessionSerializer, 401: OpenApiResponse(description="No valid session")})
    def get(self, request: Request) -> Response:
        user = user_from_refresh(request.COOKIES.get(settings.REFRESH_COOKIE_NAME))
        if user is None:
            response = Response({"detail": "No active session."}, status=status.HTTP_401_UNAUTHORIZED)
            clear_refresh_cookie(response)
            return response
        return Response({"username": user.username, "default_avatar": user.profile.default_avatar})

    @extend_schema(request=SessionActivateSerializer, responses={204: None})
    def post(self, request: Request) -> Response:
        serializer = SessionActivateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        refresh = serializer.validated_data["refresh"]
        if user_from_refresh(refresh) is None:
            return Response({"detail": "Invalid refresh token."}, status=status.HTTP_401_UNAUTHORIZED)
        response = Response(status=status.HTTP_204_NO_CONTENT)
        set_refresh_cookie(response, refresh)
        return response


class LogoutView(PublicAPIView):
    @extend_schema(request=None, responses={204: None})
    def post(self, request: Request) -> Response:
        response = Response(status=status.HTTP_204_NO_CONTENT)
        clear_refresh_cookie(response)
        return response


class ChangePasswordView(APIView):
    @extend_schema(request=ChangePasswordSerializer, responses={204: None})
    def post(self, request: Request) -> Response:
        serializer = ChangePasswordSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(status=status.HTTP_204_NO_CONTENT)


class RecoveryView(APIView):
    """Create/replace (POST) or remove (DELETE) the recovery key. Both need the current password."""

    @extend_schema(request=RecoverySetupSerializer, responses={204: None})
    def post(self, request: Request) -> Response:
        serializer = RecoverySetupSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @extend_schema(request=RecoveryDisableSerializer, responses={204: None})
    def delete(self, request: Request) -> Response:
        serializer = RecoveryDisableSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(status=status.HTTP_204_NO_CONTENT)


INVALID_RECOVERY = {"detail": "Invalid username or recovery key."}


class RecoveryVerifyView(PublicAPIView):
    """Step 1 of password reset: proves the recovery key, returns masterKey encrypted under it."""

    @extend_schema(request=RecoveryVerifySerializer, responses={200: RecoveryVerifyResponseSerializer})
    def post(self, request: Request) -> Response:
        serializer = RecoveryVerifySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        profile = profile_for_recovery(**serializer.validated_data)
        if profile is None:
            return Response(INVALID_RECOVERY, status=status.HTTP_401_UNAUTHORIZED)
        return Response({"recovery_encrypted_master_key": profile.recovery_encrypted_master_key})


class RecoveryResetView(PublicAPIView):
    """Step 2: sets the new password (masterKey re-encrypted by the browser). Files stay as they are."""

    @extend_schema(request=RecoveryResetSerializer, responses={204: None})
    def post(self, request: Request) -> Response:
        serializer = RecoveryResetSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        profile = profile_for_recovery(
            serializer.validated_data["username"], serializer.validated_data["recovery_auth_hash"]
        )
        if profile is None:
            return Response(INVALID_RECOVERY, status=status.HTTP_401_UNAUTHORIZED)
        serializer.set_new_password(profile.user)
        return Response(status=status.HTTP_204_NO_CONTENT)


class MeView(APIView):
    """Profile of the current user: avatar settings and storage usage."""

    @extend_schema(responses=MeSerializer)
    def get(self, request: Request) -> Response:
        return Response(MeSerializer(request.user.profile).data)

    @extend_schema(request=MeSerializer, responses=MeSerializer)
    def patch(self, request: Request) -> Response:
        profile = request.user.profile
        serializer = MeSerializer(profile, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        if "default_avatar" in serializer.validated_data:
            with transaction.atomic():
                profile.default_avatar = serializer.validated_data["default_avatar"]
                # Picking a built-in icon replaces a custom picture.
                _drop_custom_avatar(profile)
                profile.save()
        return Response(MeSerializer(profile).data)


def _drop_custom_avatar(profile: Profile) -> None:
    if profile.encrypted_avatar:
        storage, name = profile.encrypted_avatar.storage, profile.encrypted_avatar.name
        transaction.on_commit(lambda: storage.delete(name))
        profile.encrypted_avatar = None


class AvatarView(APIView):
    """Custom avatar, encrypted with masterKey in the browser: the server never sees the picture."""

    parser_classes = [MultiPartParser]

    @extend_schema(responses={(200, "application/octet-stream"): OpenApiResponse(OpenApiTypes.BINARY)})
    def get(self, request: Request) -> FileResponse:
        profile = request.user.profile
        if not profile.encrypted_avatar:
            raise Http404
        response = FileResponse(profile.encrypted_avatar.open("rb"), content_type="application/octet-stream")
        response["Cache-Control"] = "no-store"
        return response

    @extend_schema(
        request={"multipart/form-data": AvatarUploadSerializer},
        responses={204: None},
    )
    def put(self, request: Request) -> Response:
        serializer = AvatarUploadSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        profile = request.user.profile
        with transaction.atomic():
            _drop_custom_avatar(profile)
            profile.encrypted_avatar = serializer.validated_data["blob"]
            profile.save()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @extend_schema(responses={204: None})
    def delete(self, request: Request) -> Response:
        profile = request.user.profile
        with transaction.atomic():
            _drop_custom_avatar(profile)
            profile.save()
        return Response(status=status.HTTP_204_NO_CONTENT)

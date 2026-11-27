from django.contrib.auth import authenticate
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.crypto import fake_salt
from accounts.models import Profile
from accounts.serializers import (
    LoginResponseSerializer,
    LoginSerializer,
    RegisterResponseSerializer,
    RegisterSerializer,
    SaltRequestSerializer,
    SaltResponseSerializer,
)


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

        refresh = RefreshToken.for_user(user)
        return Response(
            {
                "access": str(refresh.access_token),
                "refresh": str(refresh),
                "encrypted_master_key": user.profile.encrypted_master_key,
            }
        )

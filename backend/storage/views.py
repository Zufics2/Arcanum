import uuid

from django.http import FileResponse, HttpResponse
from django.shortcuts import get_object_or_404
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, OpenApiResponse, extend_schema
from rest_framework import mixins, serializers, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.request import Request
from rest_framework.response import Response

from storage.models import File, Folder
from storage.serializers import (
    FileSerializer,
    FileUploadSerializer,
    FolderContentsSerializer,
    FolderSerializer,
)


MAX_HEAD_BYTES = 4096


class OwnedQuerysetMixin:
    """Every query is limited to the current user, so foreign objects simply 404."""

    model: type

    def get_queryset(self):
        return self.model.objects.filter(owner=self.request.user)

    def perform_create(self, serializer):
        serializer.save(owner=self.request.user)


class FolderViewSet(
    OwnedQuerysetMixin,
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    model = Folder
    serializer_class = FolderSerializer
    http_method_names = ["get", "post", "patch", "delete"]

    @extend_schema(
        parameters=[
            OpenApiParameter("parent", OpenApiTypes.UUID, description="Folder id; omit for the root."),
        ],
        responses=FolderContentsSerializer,
    )
    def list(self, request: Request) -> Response:
        """Contents of a folder: subfolders, files and the path from the root (for breadcrumbs)."""
        folder = None
        if parent_id := request.query_params.get("parent"):
            try:
                uuid.UUID(parent_id)
            except ValueError:
                raise serializers.ValidationError({"parent": "Must be a valid UUID."})
            folder = get_object_or_404(self.get_queryset(), pk=parent_id)

        context = self.get_serializer_context()
        data = {
            "folder": folder,
            "path": folder.ancestors() if folder else [],
            "folders": self.get_queryset().filter(parent=folder),
            "files": File.objects.filter(owner=request.user, folder=folder),
        }
        return Response(FolderContentsSerializer(data, context=context).data)

    @extend_schema(responses=FolderSerializer(many=True))
    @action(detail=False)
    def tree(self, request: Request) -> Response:
        """All folders of the user as a flat list (the client builds the tree, e.g. for "Move")."""
        return Response(self.get_serializer(self.get_queryset(), many=True).data)


class FileViewSet(
    OwnedQuerysetMixin,
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    model = File
    http_method_names = ["get", "post", "patch", "delete"]

    def get_serializer_class(self):
        return FileUploadSerializer if self.action == "create" else FileSerializer

    # Upload is multipart; rename/move (PATCH) is JSON.
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    @extend_schema(
        parameters=[
            OpenApiParameter(
                "head", OpenApiTypes.INT, description=f"Return only the first N bytes (max {MAX_HEAD_BYTES})."
            ),
        ],
        responses={(200, "application/octet-stream"): OpenApiResponse(OpenApiTypes.BINARY)},
    )
    @action(detail=True)
    def download(self, request: Request, pk=None) -> HttpResponse:
        """Raw ciphertext (iv || ciphertext). Decryption happens in the browser.

        ``?head=N`` returns just the first bytes, for the "server's eyes" hex view.
        """
        file = self.get_object()
        if (head := request.query_params.get("head")) is not None:
            try:
                limit = min(max(int(head), 1), MAX_HEAD_BYTES)
            except ValueError:
                raise serializers.ValidationError({"head": "Must be an integer."})
            with file.blob.open("rb") as blob:
                response = HttpResponse(blob.read(limit), content_type="application/octet-stream")
            response["Cache-Control"] = "no-store"
            return response
        response = FileResponse(file.blob.open("rb"), content_type="application/octet-stream")
        response["Cache-Control"] = "no-store"
        return response

import uuid

from django.db import transaction
from django.http import FileResponse, Http404
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, OpenApiResponse, extend_schema
from rest_framework import serializers, status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from sharing.models import ShareLink
from sharing.serializers import PublicShareSerializer, ShareLinkSerializer


def get_live_link(link_id: str, *, lock: bool = False) -> ShareLink:
    """A link that is still usable; expired or used-up links are deleted on sight."""
    queryset = ShareLink.objects.select_related("file")
    if lock:
        queryset = queryset.select_for_update()
    link = queryset.filter(pk=link_id).first()
    if link is None:
        raise Http404
    if link.is_expired or link.is_exhausted:
        link.delete()
        raise Http404
    return link


class ShareLinkListCreateView(APIView):
    """The owner's links: create one for a file, or list the active links of a file."""

    @extend_schema(
        parameters=[OpenApiParameter("file", OpenApiTypes.UUID, description="Only links to this file.")],
        responses=ShareLinkSerializer(many=True),
    )
    def get(self, request: Request) -> Response:
        links = ShareLink.objects.active().filter(file__owner=request.user)
        if file_id := request.query_params.get("file"):
            try:
                uuid.UUID(file_id)
            except ValueError:
                raise serializers.ValidationError({"file": "Must be a valid UUID."})
            links = links.filter(file_id=file_id)
        return Response(ShareLinkSerializer(links, many=True, context={"request": request}).data)

    @extend_schema(request=ShareLinkSerializer, responses={201: ShareLinkSerializer})
    def post(self, request: Request) -> Response:
        serializer = ShareLinkSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class ShareLinkDetailView(APIView):
    """GET is public (metadata for the share page); DELETE revokes the link (owner only)."""

    def _is_public(self) -> bool:
        # request is None while drf-spectacular builds the schema.
        return getattr(self.request, "method", None) == "GET"

    def get_authenticators(self):
        # A stale token from the recipient's own session must not break a public page.
        return [] if self._is_public() else super().get_authenticators()

    def get_permissions(self):
        return [AllowAny()] if self._is_public() else [IsAuthenticated()]

    @extend_schema(responses={200: PublicShareSerializer, 404: OpenApiResponse(description="Expired or unknown")})
    def get(self, request: Request, link_id: str) -> Response:
        return Response(PublicShareSerializer(get_live_link(link_id)).data)

    @extend_schema(responses={204: None})
    def delete(self, request: Request, link_id: str) -> Response:
        link = ShareLink.objects.filter(pk=link_id, file__owner=request.user).first()
        if link is None:
            raise Http404
        link.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class ShareLinkDownloadView(APIView):
    """Public download of the ciphertext. Counts the download; the last allowed one deletes the link."""

    authentication_classes = []
    permission_classes = [AllowAny]

    @extend_schema(responses={(200, "application/octet-stream"): OpenApiResponse(OpenApiTypes.BINARY)})
    def get(self, request: Request, link_id: str) -> FileResponse:
        # Row lock: two simultaneous downloads cannot both slip past max_downloads.
        with transaction.atomic():
            link = get_live_link(link_id, lock=True)
            file = link.file
            link.download_count += 1
            if link.is_exhausted:
                link.delete()  # self-destruct; the file itself stays with its owner
            else:
                link.save(update_fields=["download_count"])

        response = FileResponse(file.blob.open("rb"), content_type="application/octet-stream")
        response["Cache-Control"] = "no-store"
        return response

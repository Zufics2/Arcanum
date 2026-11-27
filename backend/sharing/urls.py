from django.urls import path

from sharing.views import ShareLinkDetailView, ShareLinkDownloadView, ShareLinkListCreateView

urlpatterns = [
    path("", ShareLinkListCreateView.as_view(), name="share-list"),
    path("<str:link_id>/", ShareLinkDetailView.as_view(), name="share-detail"),
    path("<str:link_id>/download/", ShareLinkDownloadView.as_view(), name="share-download"),
]

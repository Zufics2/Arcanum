from rest_framework.routers import SimpleRouter

from storage.views import FileViewSet, FolderViewSet

router = SimpleRouter()
router.register("folders", FolderViewSet, basename="folder")
router.register("files", FileViewSet, basename="file")

urlpatterns = router.urls

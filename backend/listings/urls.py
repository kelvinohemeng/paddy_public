from rest_framework.routers import DefaultRouter
from .views import ListingViewSet

router = DefaultRouter()
router.register('', ListingViewSet, basename='listing')
# register(url_prefix, the ViewSet class, a base name for these routes)
# This ONE line generates all 5 URL patterns automatically —
# GET/POST /listings/, GET/PATCH/DELETE /listings/<id>/

urlpatterns = router.urls
# Instead of a manually-written list like accounts/urls.py has

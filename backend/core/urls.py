from rest_framework.routers import DefaultRouter
from .views import AmenityViewSet

router = DefaultRouter()
router.register('amenities', AmenityViewSet, basename='amenity')
# No trailing slash in the prefix — DRF appends its own trailing slash
# when building routes, so 'amenities/' here generated /core/amenities//
# (double slash). The frontend calls /core/amenities/ (single slash),
# which matched nothing → 404 → the picker's "Couldn't load amenities"
# error. (listings/viewings register with '' and never hit this.)

urlpatterns = router.urls

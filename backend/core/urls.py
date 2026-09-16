from rest_framework.routers import DefaultRouter
from .views import AmenityViewSet

router = DefaultRouter()
router.register('amenities/', AmenityViewSet, basename='amenity')

urlpatterns = router.urls

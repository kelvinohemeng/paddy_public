from rest_framework.routers import DefaultRouter
from .views import ViewingViewSet

router = DefaultRouter()
router.register('', ViewingViewSet, basename='viewing')
# Same one-line router registration as listings/urls.py — this single
# line generates all the standard URL patterns AND the custom @action
# URLs (assign-staff, complete, cancel) automatically, based on what's
# defined on ViewingViewSet

urlpatterns = router.urls

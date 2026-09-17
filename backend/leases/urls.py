from rest_framework.routers import DefaultRouter
from .views import LeaseViewSet, LeaseRecordViewSet

router = DefaultRouter()
router.register('records', LeaseRecordViewSet, basename='lease-record')
# Registered BEFORE the empty-prefix registration below — DefaultRouter
# resolves in registration order, and 'records' needs to win over the
# empty-prefix ViewSet's own <pk> pattern (otherwise /leases/records/
# would get parsed as /leases/<pk>/ with pk='records')
router.register('', LeaseViewSet, basename='lease')

urlpatterns = router.urls

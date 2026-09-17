from rest_framework.routers import DefaultRouter
from .views import ListingViewSet, SavedListingViewSet

router = DefaultRouter()
router.register('saved', SavedListingViewSet, basename='saved-listing')
# Registered BEFORE the empty-prefix registration below — same ordering
# reasoning as leases/urls.py: 'saved' needs to win over the empty-prefix
# ViewSet's own <pk> pattern, otherwise /listings/saved/ would get
# parsed as /listings/<pk>/ with pk='saved'
router.register('', ListingViewSet, basename='listing')
# register(url_prefix, the ViewSet class, a base name for these routes)
# This ONE line generates all 5 URL patterns automatically —
# GET/POST /listings/, GET/PATCH/DELETE /listings/<id>/

urlpatterns = router.urls
# Instead of a manually-written list like accounts/urls.py has

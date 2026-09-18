from rest_framework.routers import DefaultRouter
from .views import ListingViewSet, ListingPhotoViewSet, SavedListingViewSet

router = DefaultRouter()
router.register('saved', SavedListingViewSet, basename='saved-listing')
# Registered BEFORE the empty-prefix registration below — same ordering
# reasoning as leases/urls.py: 'saved' needs to win over the empty-prefix
# ViewSet's own <pk> pattern, otherwise /listings/saved/ would get
# parsed as /listings/<pk>/ with pk='saved'
router.register('photos', ListingPhotoViewSet, basename='listing-photo')
# Same ordering-must-win-over-<pk> reasoning as 'saved' above:
# registered BEFORE the empty-prefix ListingViewSet, otherwise
# /listings/photos/<id>/ would parse as /listings/<pk>/ with
# pk='photos'. Only management (GET/PATCH/DELETE) is routed — creation
# stays on POST /listings/<id>/photos/ (upload_photos), which is why
# ListingPhotoViewSet disables POST/PUT at the http_method_names level.
router.register('', ListingViewSet, basename='listing')
# register(url_prefix, the ViewSet class, a base name for these routes)
# This ONE line generates all 5 URL patterns automatically —
# GET/POST /listings/, GET/PATCH/DELETE /listings/<id>/

urlpatterns = router.urls
# Instead of a manually-written list like accounts/urls.py has

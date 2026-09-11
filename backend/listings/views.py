from rest_framework import viewsets, status
# viewsets = a different module from what we've used before — provides
# the higher-level class-based building blocks, including ModelViewSet

from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.exceptions import PermissionDenied

from django.contrib.gis.geos import Polygon
# Polygon — GeoDjango's shape class, same toolbox that gave us PointField
# on the model. We're not storing a Polygon anywhere; we're building one
# temporarily, in memory, purely to describe the map's visible rectangle
# for THIS ONE request — it only exists for the life of this function call

from .models import Listing, ListingPhoto
from .serializers import ListingSerializer, ListingPhotoSerializer


class ListingViewSet(viewsets.ModelViewSet):
    # Inheriting from ModelViewSet — same inheritance pattern as
    # AbstractUser, just a different base class providing different
    # pre-built behavior (all 5 CRUD operations, instead of auth basics)

    queryset = Listing.objects.all()
    # Tells the ViewSet WHERE to pull data from for list/retrieve/update/
    # delete — "start from every Listing row" (we'll narrow this down
    # below for non-staff users)

    serializer_class = ListingSerializer
    # Tells the ViewSet WHICH serializer to validate/format data with —
    # same ListingSerializer we already wrote, reused as-is

    permission_classes = [IsAuthenticated]
    # Same baseline check as before — must be logged in for ANY of the
    # 5 operations. We'll add more specific rules below

    def get_queryset(self):
        user = self.request.user
        # Overriding this method lets us customize WHICH listings show
        # up, depending on who's asking — this is where "only show
        # published listings to the public" logic goes

        if user.role == user.Role.STAFF:
            queryset = Listing.objects.all()
            # Staff can see everything, including drafts/pending listings
        elif user.role == user.Role.LANDLORD:
            queryset = Listing.objects.filter(landlord_profile__user=user) | Listing.objects.filter(status=Listing.Status.PUBLISHED)
            # A landlord sees: their OWN listings (any status) OR published
            # listings from anyone (browsing the marketplace like anyone else)
            # landlord_profile__user — the double-underscore lets you filter
            # across a relationship, in one line, without manually
            # traversing it yourself. Reads as "filter by the user field,
            # on the related landlord_profile"
        else:
            queryset = Listing.objects.filter(status=Listing.Status.PUBLISHED)
            # Everyone else (renters, landlords browsing) only sees
            # published listings — draft/pending/rejected ones stay hidden
        # Stored in a variable now instead of returned immediately —
        # we need to keep narrowing it below before the final return

        city = self.request.query_params.get('city')
        # self.request.query_params — DRF's parsed version of the URL's
        # query string (?city=Accra&...). .get('city') returns None if
        # 'city' wasn't provided at all, which is exactly what we want
        # (optional filter)

        if city:
            queryset = queryset.filter(city__iexact=city)
            # city__iexact — __iexact = "exactly equal to,
            # case-insensitive" — so ?city=accra and ?city=Accra both
            # match "Accra" in the database

        min_price = self.request.query_params.get('min_price')
        if min_price:
            queryset = queryset.filter(price_monthly__gte=min_price)
            # __gte = "greater than or equal to"

        max_price = self.request.query_params.get('max_price')
        if max_price:
            queryset = queryset.filter(price_monthly__lte=max_price)
            # __lte = "less than or equal to"

        bedrooms = self.request.query_params.get('bedrooms')
        if bedrooms:
            queryset = queryset.filter(bedrooms=bedrooms)
            # Plain equality here — no __ suffix needed for exact match

        advance_rent_period = self.request.query_params.get('advance_rent_period')
        if advance_rent_period:
            queryset = queryset.filter(advance_rent_period=advance_rent_period)

        north = self.request.query_params.get('north')
        south = self.request.query_params.get('south')
        east = self.request.query_params.get('east')
        west = self.request.query_params.get('west')
        # The four corners of whatever rectangle the frontend's map is
        # currently showing. Same .get(...) pattern as every filter
        # above — each one is None if not provided

        if north and south and east and west:
            # ALL FOUR must be present together — a bounding box only
            # makes sense as a complete rectangle, there's no valid
            # meaning to "just north, nothing else". Using `and` here
            # means this whole block is skipped entirely unless the
            # frontend sends a genuinely complete box

            bbox = Polygon.from_bbox((float(west), float(south), float(east), float(north)))
            # Polygon.from_bbox expects (west, south, east, north) in
            # THAT exact order — (min_x, min_y, max_x, max_y) in
            # longitude/latitude terms. float(...) is required because
            # query_params always arrive as plain TEXT strings (like
            # every other query param we've read so far) — Polygon needs
            # actual numbers, not the string "5.65"

            queryset = queryset.filter(location__within=bbox)
            # location__within — the geospatial lookup this whole feature
            # was building toward. Reads as "keep only listings whose
            # location point falls inside this rectangle". Listings with
            # location=None (still allowed, since the field is nullable)
            # are automatically excluded here too — a null point can
            # never be "within" any shape, so this naturally handles
            # listings that haven't been geocoded yet without needing a
            # separate check

        return queryset
        # Only NOW do we actually return — after every optional filter
        # has had a chance to narrow things down further

    def perform_create(self, serializer):
        # Called automatically by ModelViewSet during its built-in
        # "create" flow (POST) — this REPLACES our old create_listing
        # function entirely, same underlying logic though

        if self.request.user.role != self.request.user.Role.LANDLORD:
            raise PermissionDenied('Only landlords can create listings')
            # Different mechanism than before (raising an exception
            # instead of manually returning a Response) — ModelViewSet
            # expects errors to be raised this way, and it automatically
            # converts this into the correct 403 response for us

        landlord_profile = self.request.user.landlordprofile

        existing_listing_count = Listing.objects.filter(landlord_profile=landlord_profile).count()
        # How many listings this landlord already has, REGARDLESS of
        # status (draft/published/etc.) — the free tier's cap counts
        # every listing they've ever created, not just published ones

        from payments.models import LandlordSubscription
        # Imported here, inside the method, rather than at the top of
        # the file — avoids a circular import risk (payments doesn't
        # import from listings, but keeping cross-app imports scoped to
        # where they're actually used is a common, safe habit once an
        # app graph gets more connected)

        subscription = LandlordSubscription.objects.filter(landlord_profile=landlord_profile).first()

        if subscription is not None and subscription.is_active():
            cap = subscription.listing_cap()
            # A genuinely active PAID subscription — use whatever cap
            # their tier grants (10 for agent, None/unlimited for lord)
        else:
            cap = LandlordSubscription.LISTING_CAPS[LandlordSubscription.Tier.FREE]
            # No subscription row at all, OR one that exists but isn't
            # currently active (lapsed/past due/never paid) — falls
            # back to the FREE tier's cap regardless of what tier value
            # happens to be stored on the row, since is_active() being
            # False means we can't trust that tier is currently paid for

        if cap is not None and existing_listing_count >= cap:
            raise PermissionDenied(
                f'You have reached your listing limit ({cap}). '
                'Please upgrade your subscription to publish more listings.'
            )

        serializer.save(landlord_profile=landlord_profile)
        # Exact same line as before — landlord_profile always comes from
        # whoever's logged in, never from the request body

    def perform_update(self, serializer):
        # Called automatically during "update" (PATCH/PUT) — this is
        # NEW, we hadn't written update logic by hand yet

        listing = self.get_object()
        # Fetches the specific listing being updated (ModelViewSet
        # already found it via the URL's <id>, this just retrieves it)

        if listing.landlord_profile.user != self.request.user:
            raise PermissionDenied("You can only edit your own listings")
            # THE actual "only the owner can edit this" check we've been
            # talking about conceptually since the permissions discussion
            # — now finally written, for real

        serializer.save()

    def perform_destroy(self, instance):
        # Called automatically during "delete" — same ownership check
        # as update, since deleting is just as sensitive

        if instance.landlord_profile.user != self.request.user:
            raise PermissionDenied("You can only delete your own listings")

        instance.delete()

    @action(detail=True, methods=['post'], url_path='photos')
    # @action = DRF's way of adding a custom endpoint to a ViewSet,
    # beyond the standard 5. detail=True means this operates on ONE
    # specific listing (so the URL includes its ID) — the resulting URL
    # becomes POST /listings/<id>/photos/
    # url_path='photos' = the URL segment, matches what we sketched earlier

    def upload_photos(self, request, pk=None):
        # pk = the listing's ID, automatically extracted from the URL by
        # DRF's routing, since detail=True — same idea as the <id> in
        # accounts/urls.py's manually-written paths, just automatic here

        listing = self.get_object()
        # self.get_object() — a method ModelViewSet already provides,
        # fetches the specific Listing this URL refers to, ALREADY
        # respecting get_queryset() (so a non-owner still can't reach a
        # listing they can't see, same 404-not-403 behavior as before)

        if listing.landlord_profile.user != request.user:
            raise PermissionDenied("You can only upload photos to your own listings")
            # Same ownership check pattern as perform_update/perform_destroy

        images = request.FILES.getlist('images')
        # request.FILES — where Django puts uploaded FILES specifically
        # (separate from request.data, which holds regular text/JSON
        # fields). .getlist('images') grabs every file sent under that
        # key, since one request can carry multiple files at once

        if not images:
            return Response({'error': 'No images provided'}, status=status.HTTP_400_BAD_REQUEST)

        existing_count = listing.photos.count()
        # How many photos this listing already has — needed so a second
        # upload batch continues the `order` sequence instead of
        # restarting at 0 and colliding

        created_photos = []
        for index, image in enumerate(images):
            photo = ListingPhoto.objects.create(
                listing=listing,
                image=image,
                order=existing_count + index,
                is_cover=(existing_count == 0 and index == 0),
                # Only auto-mark as cover if this is the VERY FIRST photo
                # ever uploaded for this listing — avoids accidentally
                # resetting the cover photo on a second upload batch
            )
            created_photos.append(photo)

        serializer = ListingPhotoSerializer(created_photos, many=True)
        # many=True — same concept as before, we're serializing a LIST
        # of objects, not just one

        return Response(serializer.data, status=status.HTTP_201_CREATED)
from django.utils.text import slugify
# Django's built-in helper — turns "Swimming Pool" into "swimming-pool"
# automatically (lowercases, replaces spaces with hyphens, strips
# anything not URL-safe). No need to hand-write this logic yourself.

from rest_framework import viewsets, status
from rest_framework.permissions import IsAuthenticated, AllowAny, BasePermission
from rest_framework.response import Response

from accounts.models import User
from .models import Amenity
from .serializers import AmenitySerializer


class CanCreateAmenity(BasePermission):
    # A DRF "permission class" — a tiny object DRF asks "is this request
    # allowed?" BEFORE the view method (create/update/...) runs at all.
    # has_permission() returning False makes DRF answer 403 Forbidden for
    # us, so the view code never has to remember to check.
    #
    # Who may ADD an amenity: landlords (the listing create/edit form
    # lets a landlord type a new amenity like "Borehole" inline, which
    # POSTs here while they're logged in), plus staff and admins.
    # Renters can't — they only ever pick from the existing list.
    message = 'Only landlords, staff, or admins can add amenities.'

    def has_permission(self, request, view):
        return (
            request.user.is_authenticated
            and request.user.role in (User.Role.LANDLORD, User.Role.STAFF, User.Role.ADMIN)
        )
        # is_authenticated is checked FIRST: an anonymous visitor is an
        # AnonymousUser object, which has no `role` attribute at all, so
        # reading .role on it would crash. Python's `and` stops at the
        # first False, so .role is never touched for anonymous users.


class CanEditAmenity(BasePermission):
    # Who may RENAME or DELETE an existing amenity: staff and admins only.
    # Amenities are shared by every listing on the site, so one edit
    # changes what every renter sees; deleting one silently strips it
    # from every listing that had it (the many-to-many link rows go with
    # it). That's a site-wide change, not something a single landlord
    # (or, before this fix, ANY logged-in renter) should be able to make.
    message = 'Only staff or admins can edit or delete amenities.'

    def has_permission(self, request, view):
        return (
            request.user.is_authenticated
            and request.user.role in (User.Role.STAFF, User.Role.ADMIN)
        )


class AmenityViewSet(viewsets.ModelViewSet):
    queryset = Amenity.objects.all()
    serializer_class = AmenitySerializer
    permission_classes = [IsAuthenticated]
    # Fallback only — get_permissions() below decides every action this
    # viewset actually has. Kept so any action added later without a
    # rule still requires login rather than being public by accident.

    def get_permissions(self):
        # DRF calls this on every request and sets self.action to which
        # kind of request it is: 'list' (GET /core/amenities/),
        # 'retrieve' (GET /core/amenities/<id>/), 'create' (POST),
        # 'update' (PUT), 'partial_update' (PATCH) or 'destroy' (DELETE).
        if self.action in ('list', 'retrieve'):
            return [AllowAny()]
            # READS STAY PUBLIC — the Discovery Hub shows amenity filter
            # chips to anonymous visitors, so reading the list must never
            # need a login. Same pattern ListingViewSet uses for
            # list/retrieve (browsing is free; only writes are gated).
        if self.action == 'create':
            return [CanCreateAmenity()]
        if self.action in ('update', 'partial_update', 'destroy'):
            return [CanEditAmenity()]
            # Before this fix, these three fell through to plain
            # IsAuthenticated — meaning any logged-in user, renters
            # included, could PATCH an amenity's name or DELETE it.
        return super().get_permissions()

    def create(self, request, *args, **kwargs):
        # Overriding create() ENTIRELY, not perform_create() —
        # perform_create() only controls what happens to an
        # already-validated new instance; here we need to intercept
        # BEFORE that, to decide whether to create anything at all

        name = request.data.get('name', '').strip()

        if not name:
            return Response(
                {'name': ['This field is required.']},
                status=status.HTTP_400_BAD_REQUEST
            )

        existing = Amenity.objects.filter(name__iexact=name).first()
        # name__iexact — the SAME case-insensitive lookup style you've
        # already used elsewhere (ListingViewSet's city__iexact filter)
        # — "wifi" and "WiFi" and "WIFI" all match the same existing row

        if existing:
            serializer = self.get_serializer(existing)
            return Response(serializer.data, status=status.HTTP_200_OK)
            # 200, not 201 — this is the real signal to the frontend
            # that nothing new was created, an existing amenity was
            # simply returned. The frontend can use this status code
            # to decide whether to show "created" vs "already exists"
            # feedback, though it doesn't strictly need to act
            # differently either way — either response gives back a
            # real Amenity id ready to attach to a listing

        slug = slugify(name).replace('-', '_')
        # .replace('-', '_') — the canonical form. slugify() alone
        # produces HYPHENS ("Swimming Pool" → "swimming-pool"), but the
        # canonical amenity slugs everywhere else use UNDERSCORES
        # (see core/choices.py: water_storage, swimming_pool, ...), and
        # both the frontend filter and ListingViewSet's
        # amenities__slug__in lookup match on those underscore slugs.
        # A hyphen-slugged row created here would silently never match
        # a frontend filter for the same amenity — so every slug minted
        # here is normalized to underscores up front. (Rows seeded
        # before this fix may still carry hyphen slugs — see the PR
        # notes for the re-seed/cleanup follow-up.)

        existing_slug = Amenity.objects.filter(slug__iexact=slug).first()
        if existing_slug:
            serializer = self.get_serializer(existing_slug)
            return Response(serializer.data, status=status.HTTP_200_OK)
            # Same 200-means-already-exists signal as the name match
            # above: a different-spelled name mapping to an existing
            # slug ("Swimming-Pool" vs "Swimming Pool") returns the
            # existing row instead of blowing up on the slug's
            # unique=True constraint (which would otherwise 500).

        amenity = Amenity.objects.create(name=name, slug=slug)
        serializer = self.get_serializer(amenity)
        return Response(serializer.data, status=status.HTTP_201_CREATED)
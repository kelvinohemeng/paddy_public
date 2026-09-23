from django.utils.text import slugify
# Django's built-in helper — turns "Swimming Pool" into "swimming-pool"
# automatically (lowercases, replaces spaces with hyphens, strips
# anything not URL-safe). No need to hand-write this logic yourself.

from rest_framework import viewsets, status
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response

from .models import Amenity
from .serializers import AmenitySerializer


class AmenityViewSet(viewsets.ModelViewSet):
    queryset = Amenity.objects.all()
    serializer_class = AmenitySerializer
    permission_classes = [IsAuthenticated]
    # Default for writes (create/update/delete) — stays login-gated.
    # Reads are opened to everyone via get_permissions() below, so the
    # public Discovery Hub can load the amenity list for its filter UI
    # without logging in. Same pattern ListingViewSet already uses for
    # list/retrieve (browsing is free; only writes stay gated).

    def get_permissions(self):
        if self.action in ('list', 'retrieve'):
            return [AllowAny()]
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
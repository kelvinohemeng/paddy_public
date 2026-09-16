from django.utils.text import slugify
# Django's built-in helper — turns "Swimming Pool" into "swimming-pool"
# automatically (lowercases, replaces spaces with hyphens, strips
# anything not URL-safe). No need to hand-write this logic yourself.

from rest_framework import viewsets, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import Amenity
from .serializers import AmenitySerializer


class AmenityViewSet(viewsets.ModelViewSet):
    queryset = Amenity.objects.all()
    serializer_class = AmenitySerializer
    permission_classes = [IsAuthenticated]
    # Any authenticated user (any role) can hit GET /amenities/ to
    # browse — matches "all landlords have access to that table," and
    # there's no reason to restrict browsing further than that; a
    # renter or staff member seeing the amenity list is harmless

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

        slug = slugify(name)
        amenity = Amenity.objects.create(name=name, slug=slug)
        serializer = self.get_serializer(amenity)
        return Response(serializer.data, status=status.HTTP_201_CREATED)
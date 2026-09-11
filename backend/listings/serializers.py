from rest_framework import serializers
from .models import Listing, ListingPhoto


class ListingSerializer(serializers.ModelSerializer):
    class Meta:
        model = Listing
        exclude = ['landlord_profile', 'status', 'verified_at', 'published_at', 'verified_by_staff']
        # exclude = "every field on the model EXCEPT these" — the
        # opposite of listing fields one by one, useful here since
        # Listing has many fields and we only need to block a few
        #
        # landlord_profile excluded because the VIEW sets it explicitly
        # (from request.user) — never trust the client to say who owns this
        #
        # status/verified_at/published_at/verified_by_staff excluded —
        # these are staff-controlled fields. A landlord submitting a new
        # listing has no business setting these directly; the model's
        # own defaults handle it (status defaults to 'draft', the others
        # default to empty) until staff review happens


class ListingPhotoSerializer(serializers.ModelSerializer):
    class Meta:
        model = ListingPhoto
        fields = ['id', 'image', 'order', 'is_cover']
        # Simple include-list — every field here is safe to both accept
        # and return, no sensitive/staff-only fields on this model at all

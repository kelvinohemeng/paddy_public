from django.utils import timezone
from rest_framework import serializers
from .models import Viewing


class ViewingSerializer(serializers.ModelSerializer):
    class Meta:
        model = Viewing
        fields = '__all__'
        # '__all__' = expose every field on the model in the API response —
        # different from ListingSerializer's exclude=[...] approach, but
        # equally valid; which one you pick usually just depends on whether
        # more fields need hiding (exclude) or more need exposing (__all__)

        read_only_fields = ['renter_profile', 'staff_profile', 'status']
        # read_only_fields — these three still SHOW UP in the JSON when
        # reading a viewing (e.g. staff_profile will show `null` until
        # someone's assigned, then show the real assignment once they are),
        # but if a client includes them in a POST/PATCH body, DRF silently
        # ignores them — same "declared but not writable" idea as
        # UserUpdateSerializer's fields list, just phrased the other way
        # around here since we want these VISIBLE, just not settable
        #
        # renter_profile — always set from request.user in the view,
        # never trusted from the request body (same pattern as
        # landlord_profile on ListingSerializer)
        # staff_profile — starts null, only ever set by a dedicated
        # staff-assignment action later, never by whoever's creating the
        # viewing
        # status — transitions (requested -> scheduled -> completed/
        # cancelled_no_show) are controlled by specific view actions, not
        # a free-form field any client can set to anything

    def validate_scheduled_at(self, value):
        # The frontend date picker already blocks past dates, but the API
        # must not trust the client — a direct POST could otherwise book
        # a viewing in the past
        if value <= timezone.now():
            raise serializers.ValidationError('Viewing must be scheduled in the future.')
        return value

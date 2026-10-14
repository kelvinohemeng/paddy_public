from rest_framework import serializers
from listings.serializers import ListingSerializer
from .models import LandlordSubscription, ListingUnlock


class LandlordSubscriptionSerializer(serializers.ModelSerializer):
    class Meta:
        model = LandlordSubscription
        fields = ['id', 'tier', 'status', 'current_period_end', 'cancel_at_period_end', 'created_at']
        # cancel_at_period_end — lets the card say "Cancelled — ends on
        # <date>" instead of offering to cancel again.
        # Deliberately NOT exposing paystack_customer_code/
        # paystack_subscription_code — these are internal identifiers a
        # landlord never needs to see or set, same "why expose it if
        # nothing legitimate is done with it client-side" reasoning as
        # excluding password on UserSerializer


class ListingUnlockSerializer(serializers.ModelSerializer):
    listing_detail = ListingSerializer(source='listing', read_only=True)
    # The whole listing, nested, so the Unlocked Listings page and the
    # receipts table render from this one response. Address and landlord
    # contact come through ListingSerializer's own _has_access() gate,
    # which says yes because this user has an unlock row. The access rule
    # stays in one place; nothing here re-decides it. Same pattern as
    # SavedListingSerializer in listings/serializers.py.

    class Meta:
        model = ListingUnlock
        fields = [
            'id', 'listing', 'listing_detail',
            'paystack_reference', 'amount_pesewas', 'created_at',
        ]
        # No `user`: the view only ever returns the requester's own
        # unlocks, so it would always be "you".

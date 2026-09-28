from rest_framework import serializers
from .models import LandlordSubscription


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

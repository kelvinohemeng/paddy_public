from rest_framework import serializers

from .models import Lease, LeaseRecord


class LeaseRecordSerializer(serializers.ModelSerializer):
    class Meta:
        model = LeaseRecord
        fields = [
            'id', 'lease', 'record_type', 'method', 'amount', 'reference',
            'occurred_at', 'notes', 'created_at',
        ]
        # created_by deliberately not exposed — set by the view from
        # whoever's logged in, same non-negotiable pattern as
        # landlord_profile on ListingSerializer

    def create(self, validated_data):
        request = self.context.get('request')
        if request is not None and request.user.is_authenticated:
            validated_data['created_by'] = request.user
        return super().create(validated_data)


class LeaseSerializer(serializers.ModelSerializer):
    records = LeaseRecordSerializer(many=True, read_only=True)
    listing_title = serializers.CharField(source='listing.title', read_only=True)
    renter_name = serializers.CharField(source='renter_profile.full_name', read_only=True)
    landlord_name = serializers.CharField(source='landlord_profile.full_name', read_only=True)
    # Small read-only convenience fields — save the frontend an extra
    # round trip to resolve names for a dashboard list view, same
    # reasoning as is_unlocked/landlord_contact on ListingSerializer
    # being computed rather than requiring a second fetch

    class Meta:
        model = Lease
        fields = [
            'id', 'listing', 'listing_title', 'renter_profile', 'renter_name',
            'landlord_profile', 'landlord_name', 'rent_amount_monthly',
            'deposit_amount', 'advance_rent_period', 'start_date', 'end_date',
            'status', 'records', 'created_at', 'updated_at',
        ]
        # created_by not exposed here either, same reasoning as above

    def create(self, validated_data):
        request = self.context.get('request')
        if request is not None and request.user.is_authenticated:
            validated_data['created_by'] = request.user
        return super().create(validated_data)

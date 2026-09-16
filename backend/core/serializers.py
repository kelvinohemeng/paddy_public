from rest_framework import serializers
from .models import Amenity


class AmenitySerializer(serializers.ModelSerializer):
    class Meta:
        model = Amenity
        fields = ['id', 'name', 'slug']
        # id is genuinely needed here (unlike some of your other
        # serializers that exclude it) — the frontend's amenities
        # picker needs a real, stable value to send back when
        # attaching amenities to a Listing's M2M field

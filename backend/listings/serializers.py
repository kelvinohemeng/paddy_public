from rest_framework import serializers
from .models import Listing, ListingPhoto


class ListingSerializer(serializers.ModelSerializer):
    is_unlocked = serializers.SerializerMethodField()
    # A COMPUTED field — doesn't exist on the Listing model at all,
    # calculated fresh on every serialization instead. Lets the
    # frontend show a clear "unlock this listing" prompt vs. already-
    # unlocked state, without needing to guess from whether
    # address_precise/landlord_contact happen to be null or missing

    landlord_contact = serializers.SerializerMethodField()
    # Also computed, not a real model field — "contact info" isn't one
    # single field on Listing OR LandlordProfile, it's assembled here
    # from the landlord's User (phone, email) at serialization time,
    # and only included at all when access is actually earned

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

    def _has_access(self, listing):
        # THE actual security boundary for this whole feature — every
        # other method below (address gating, contact gating,
        # is_unlocked) all just call this ONE method, so the access
        # rule only needs to be correct in exactly one place

        request = self.context.get('request')
        if request is None or not request.user or not request.user.is_authenticated:
            return False
            # No logged-in user at all (e.g. this serializer used
            # somewhere without a request in context) — never grant
            # access by default; fail closed, not open

        user = request.user

        if user.role == user.Role.STAFF:
            return True
            # Staff always see everything — matches every other
            # visibility rule in this codebase (get_queryset, etc.)

        if listing.landlord_profile.user == user:
            return True
            # A landlord always sees their OWN listing's full details —
            # they wrote the address themselves, paying to see it again
            # would be absurd

        if user.role == user.Role.LANDLORD:
            from payments.models import LandlordSubscription
            # Imported here, not at the top of the file — same
            # deliberate scoping reason as listings/views.py's
            # perform_create: avoids a circular import risk between
            # listings and payments, which already reference each
            # other in both directions (ListingUnlock.listing is a
            # string reference to Listing for the same reason)

            subscription = LandlordSubscription.objects.filter(
                landlord_profile=user.landlordprofile
            ).first()

            if subscription is not None and subscription.is_active():
                return True
            # A landlord with an ACTIVE paid subscription (any tier) —
            # per the actual product decision, this is a genuine perk
            # of paying for a subscription at all, not just a higher
            # listing cap. A FREE-tier landlord (no active subscription)
            # does NOT get a free pass here — they pay per-listing like
            # anyone else, same as a renter would

        return listing.unlocks.filter(user=user).exists()
        # The fallback for everyone else (renters, and landlords without
        # an active subscription): have THEY specifically paid to
        # unlock THIS listing? .exists() rather than .first() — we only
        # need a yes/no, no need to fetch the actual row's data here

    def get_is_unlocked(self, listing):
        return self._has_access(listing)

    def get_landlord_contact(self, listing):
        if not self._has_access(listing):
            return None
            # Returning None (not omitting the key) means the frontend
            # can always safely check `listing.landlord_contact`
            # without a KeyError, and cleanly distinguish "locked" (None)
            # from "unlocked but genuinely has no phone on file" (would
            # be a different case entirely, not something we handle yet)

        landlord_user = listing.landlord_profile.user
        return {
            'phone': landlord_user.phone,
            'email': landlord_user.email,
        }

    def to_representation(self, instance):
        # Runs AFTER all the normal field serialization above — this is
        # our chance to REMOVE something that's already been included,
        # specifically address_precise. Unlike landlord_contact (which
        # we control entirely via SerializerMethodField and never touch
        # the real model field), address_precise IS a real field on
        # Listing, included automatically by `exclude` in Meta above —
        # so we let it serialize normally, then strip it out here if
        # access hasn't been earned. This ordering matters: reversing
        # it (checking access first) would mean re-implementing every
        # other field's serialization by hand instead of reusing DRF's
        # default behavior for everything else

        data = super().to_representation(instance)

        if not self._has_access(instance):
            data['address_precise'] = None
            # Same None-not-omitted reasoning as landlord_contact above —
            # consistent shape for the frontend regardless of lock state

        return data


class ListingPhotoSerializer(serializers.ModelSerializer):
    class Meta:
        model = ListingPhoto
        fields = ['id', 'image', 'order', 'is_cover']
        # Simple include-list — every field here is safe to both accept
        # and return, no sensitive/staff-only fields on this model at all

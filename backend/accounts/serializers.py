from rest_framework import serializers
# Import DRF's serializers module — same pattern as importing `models` from django.db,
# just a different toolbox, this one specifically for validation + JSON conversion

from .models import User, RenterProfile, LandlordProfile
# Import the models this serializer needs to know about
# (StaffProfile left out on purpose — staff accounts won't be created through
# public signup, that's an internal/admin-only action, not a public endpoint)


class RegisterSerializer(serializers.ModelSerializer):
    # ModelSerializer = a serializer that already knows how to map to a specific
    # model's fields, saving us from manually declaring every field by hand
    # (there's also a plain serializers.Serializer for cases with no direct model —
    # we don't need that here)

    password = serializers.CharField(write_only=True, min_length=8)
    # write_only=True = accept this field when data comes IN, but never include
    # it when sending data back OUT as JSON (we never want to expose a password,
    # even hashed, in an API response)
    # min_length=8 = basic validation rule, rejects short passwords automatically

    class Meta:
        # Meta = a special nested class ModelSerializer looks for, to know which
        # model this serializer is based on and which fields to expose
        model = User
        fields = ['email', 'password', 'phone', 'role']
        # Only these four fields are accepted from incoming signup requests —
        # anything else in the request body gets ignored (e.g. is_staff, is_superuser
        # can't be set this way, protecting against someone trying to self-promote)

    def create(self, validated_data):
        # Overriding the default create() behavior — ModelSerializer normally
        # knows how to create a plain model instance, but we need EXTRA logic:
        # hashing the password correctly, and creating the matching profile row

        role = validated_data.get('role')
        # Pull the role out of the already-validated incoming data

        user = User.objects.create_user(
            email=validated_data['email'],
            password=validated_data['password'],
            phone=validated_data.get('phone', ''),
            role=role,
        )
        # Calls OUR custom create_user (the manager we wrote earlier) —
        # this is what correctly hashes the password via set_password,
        # instead of accidentally storing it as plain text

        if role == User.Role.RENTER:
            RenterProfile.objects.create(user=user, full_name='')
        elif role == User.Role.LANDLORD:
            LandlordProfile.objects.create(user=user, full_name='')
        # This is the actual missing piece from our earlier conversation —
        # immediately after creating the User, we also create the matching
        # profile row, linked via user=user (Django resolves this to the
        # right user_id automatically)
        # full_name='' as a placeholder for now — the real name can be
        # filled in later via a "complete your profile" step, not required
        # at signup itself

        return user
        # Return the created user — DRF uses this to build the response

    def validate_role(self, value):
        # DRF automatically calls any method named validate_<fieldname> —
        # this one runs specifically for the `role` field, after the basic
        # type/choices validation already passed

        if value in [User.Role.ADMIN, User.Role.STAFF]:
            # Block these two values specifically — admin and staff accounts
            # must never be creatable through the public signup endpoint,
            # only renter/landlord are allowed to self-register

            raise serializers.ValidationError(
                'You cannot register with this role.'
            )
            # Raising this stops validation immediately — is_valid() in the
            # View will return False, and this message will show up in
            # serializer.errors, e.g. {"role": ["You cannot register with this role."]}

        return value
        # If it passed the check, return the value unchanged so it can
        # continue on to be saved normally


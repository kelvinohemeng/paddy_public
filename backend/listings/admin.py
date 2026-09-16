from django import forms
# Django's plain forms module — needed to build a custom ModelForm,
# same base class Django admin uses internally by default anyway. We're
# just intercepting it to swap out ONE field's widget

from django.contrib import admin
from unfold.admin import ModelAdmin
# Same Unfold pattern as accounts/admin.py — themed admin interface

from location_field.forms.spatial import LocationField as LocationFormField
# The full FORM FIELD class (not just the widget) — this is the actual
# fix for the "Invalid geometry value" bug. My earlier version only
# swapped the WIDGET (LocationWidget, which renders the Leaflet map and
# writes plain "lat,lng" text into a hidden input) but left Django's
# default PointField form field in charge of validating/parsing that
# submitted text — and the default PointField form field expects
# WKT/GeoJSON, not "lat,lng", so it rejected the widget's own output.
# Widget and field were mismatched — swapping the WHOLE field (which
# builds its own matching widget internally, see location_field/forms/
# plain.py) fixes both halves together: LocationField.clean() parses
# "lat,lng" into a real Point object correctly.

from .models import Listing, ListingPhoto


class ListingAdminForm(forms.ModelForm):
    # A custom ModelForm, ONLY so we can override one field's widget —
    # everything else about the form (which fields appear, validation,
    # required-ness) still comes from Listing's real model definition,
    # completely untouched. This is the same "override just one thing,
    # inherit everything else" pattern as ListingSerializer's `exclude`

    class Meta:
        model = Listing
        fields = '__all__'
        # Must list fields here (or '__all__') even though we're not
        # customizing most of them — ModelForm requires this explicitly,
        # it won't infer "every field" without being told to

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # Let the normal ModelForm set itself up first (builds every
        # field/widget from the model as usual) — THEN we override just
        # the one we care about, below

        self.fields['location'] = LocationFormField(
            based_fields=[],
            # Required kwarg — LocationWidget's __init__ (built
            # internally by this form field) does
            # kwargs.pop("based_fields") with no default, so it MUST be
            # passed even when unused. based_fields would let you
            # auto-derive a search query from OTHER form fields (e.g.
            # combine address_precise + city into a search string) —
            # not wired up here, so an empty list, but this stays a
            # design TODO worth revisiting: real UX win to make.

            zoom=12,
            # How zoomed-in the map starts — 12 is roughly "whole city
            # visible", reasonable default for pinning a single Accra/
            # Kumasi listing without needing to scroll/zoom in manually
            # every time staff open this form

            required=False,
            # Matches the model's own null=True/blank=True — location
            # is genuinely optional (a listing might exist before it's
            # been pinned on a map). Without this, LocationField's
            # PlainLocationField base defaults required=True, which
            # would block saving ANY listing with an empty location —
            # a second, separate bug from the "Invalid geometry value"
            # one, worth fixing in the same pass since it's the same
            # field.

            initial=self.instance.location if self.instance.pk else None,
            # When editing an EXISTING listing, pre-fill the field with
            # its current Point value so the widget shows the correct
            # already-saved pin instead of defaulting to 0,0 — ModelForm
            # normally handles this automatically via the model field,
            # but since we're REPLACING the form field entirely here
            # (not just its widget), that automatic wiring is lost and
            # needs re-doing by hand. self.instance.pk check: a
            # brand-new "Add listing" form has no pk yet, so there's no
            # existing value to pre-fill.
        )


@admin.register(Listing)
class ListingAdmin(ModelAdmin):
    form = ListingAdminForm
    # Tells Django admin to build its add/edit form from OUR custom
    # form class above, instead of auto-generating a default one —
    # this is the actual wiring that makes the widget override apply

    list_display = ['title', 'city', 'neighborhood', 'status', 'landlord_profile', 'price_monthly']
    # Also adding this now while we're in here — same reasoning as
    # payments/admin.py's LandlordSubscriptionAdmin: without
    # list_display, admin's list view only shows Listing's __str__
    # (probably just the title or a generic "Listing object (id)"),
    # making it hard to actually find/verify listings, e.g. the ones
    # just seeded, by eye

    list_filter = ['status', 'city', 'listing_type']
    search_fields = ['title', 'neighborhood', 'city']


@admin.register(ListingPhoto)
class ListingPhotoAdmin(ModelAdmin):
    pass

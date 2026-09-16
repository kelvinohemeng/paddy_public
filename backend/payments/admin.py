from datetime import timedelta

from django.contrib import admin
# Still need this — admin.site is the actual registry Django admin uses
# to know which models to display at all
from django.utils import timezone

from unfold.admin import ModelAdmin
# Unfold's themed base class — same pattern as accounts/admin.py,
# what actually applies the new visual styling

from .models import LandlordSubscription, ListingUnlock


@admin.register(LandlordSubscription)
class LandlordSubscriptionAdmin(ModelAdmin):
    list_display = ['landlord_profile', 'tier', 'status', 'current_period_end']
    # list_display = which columns show in the admin's list view —
    # without this, Django admin just shows one column: whatever
    # __str__() returns for each row. Showing tier/status/
    # current_period_end directly here means you can see (and edit,
    # via the change form) a landlord's subscription state without
    # needing raw SQL or a Django shell for routine account admin
    # work like this one.

    list_filter = ['tier', 'status']
    # Adds a sidebar filter — useful once there are many landlords,
    # to quickly find e.g. "everyone currently past_due"

    search_fields = ['landlord_profile__full_name', 'landlord_profile__user__email']
    # __ traversal, same double-underscore relationship-crossing
    # pattern used elsewhere in this codebase (e.g. ListingViewSet's
    # landlord_profile__user filter) — lets admin's search box find a
    # subscription by the landlord's name OR email, not just this
    # table's own fields

    def save_model(self, request, obj, form, change):
        # Staff marking a row ACTIVE with no period end almost always
        # means "grant paid status manually" (comped account, testing)
        # — but is_active() deliberately treats dateless-ACTIVE as
        # INACTIVE (fail-safe, pinned by tests), so without this the
        # grant would silently do nothing and listing creation would
        # stay gated at the free cap. Defaulting to 30 days makes the
        # admin action do what staff obviously meant; edit the date
        # afterwards for any other duration. Model-layer semantics are
        # untouched — only this admin form fills the blank.
        if (
            obj.status == LandlordSubscription.Status.ACTIVE
            and obj.current_period_end is None
        ):
            obj.current_period_end = timezone.now() + timedelta(days=30)
        super().save_model(request, obj, form, change)


@admin.register(ListingUnlock)
class ListingUnlockAdmin(ModelAdmin):
    list_display = ['user', 'listing', 'created_at']
    search_fields = ['user__email', 'listing__title']

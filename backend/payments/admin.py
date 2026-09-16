from django.contrib import admin
# Still need this — admin.site is the actual registry Django admin uses
# to know which models to display at all

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


@admin.register(ListingUnlock)
class ListingUnlockAdmin(ModelAdmin):
    list_display = ['user', 'listing', 'created_at']
    search_fields = ['user__email', 'listing__title']

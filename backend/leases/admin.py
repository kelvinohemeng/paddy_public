from django.contrib import admin
from unfold.admin import ModelAdmin, TabularInline
# Same Unfold pattern as viewings/admin.py. TabularInline lets staff see/
# add a lease's LeaseRecord entries directly on the Lease admin page,
# instead of needing a second admin screen for every receipt/contract row

from .models import Lease, LeaseRecord


class LeaseRecordInline(TabularInline):
    model = LeaseRecord
    extra = 0
    fields = ['record_type', 'method', 'amount', 'reference', 'occurred_at', 'notes']


@admin.register(Lease)
class LeaseAdmin(ModelAdmin):
    list_display = ['listing', 'renter_profile', 'landlord_profile', 'status', 'start_date', 'end_date']
    list_filter = ['status', 'advance_rent_period']
    search_fields = ['listing__title', 'renter_profile__full_name', 'landlord_profile__full_name']
    inlines = [LeaseRecordInline]


@admin.register(LeaseRecord)
class LeaseRecordAdmin(ModelAdmin):
    list_display = ['lease', 'record_type', 'amount', 'occurred_at']
    list_filter = ['record_type', 'method']

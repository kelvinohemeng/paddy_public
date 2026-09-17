from django.db import models

from accounts.models import LandlordProfile, RenterProfile
from listings.models import Listing


class Lease(models.Model):
    # One row = one renter's actual tenancy on one listing. Deliberately
    # created MANUALLY by staff/landlord once a deal closes off-platform —
    # per the current business model, paddy never holds or moves rent/
    # deposit money itself (see AGENTS.md), so there is no automatic
    # "payment succeeded -> lease created" trigger anywhere. A Lease here
    # is a record-keeping/dashboard feature, not a payment flow.

    listing = models.ForeignKey(
        Listing, on_delete=models.CASCADE, related_name='leases'
    )
    renter_profile = models.ForeignKey(
        RenterProfile, on_delete=models.CASCADE, related_name='leases'
    )
    landlord_profile = models.ForeignKey(
        LandlordProfile, on_delete=models.CASCADE, related_name='leases'
    )
    # Denormalized onto the Lease directly, rather than always reached via
    # listing.landlord_profile — a listing could theoretically change hands
    # or be edited later; freezing who the landlord was AT LEASE TIME here
    # keeps the historical record accurate regardless of later edits, and
    # makes the landlord-facing query (leases for MY listings) a single
    # flat filter instead of a join through listing every time

    rent_amount_monthly = models.DecimalField(max_digits=10, decimal_places=2)
    deposit_amount = models.DecimalField(max_digits=10, decimal_places=2)

    advance_rent_period = models.CharField(
        max_length=10, choices=Listing.AdvanceRentPeriod.choices
    )
    # Snapshot of the terms actually agreed, independent of whatever the
    # listing's own advance_rent_period says NOW (a listing could be
    # re-published later under different terms for the next tenant)

    start_date = models.DateField()
    end_date = models.DateField()

    class Status(models.TextChoices):
        ACTIVE = 'active', 'Active'
        ENDED = 'ended', 'Ended'
        TERMINATED = 'terminated', 'Terminated'
        # TERMINATED kept separate from ENDED — ENDED means the lease ran
        # its natural full term, TERMINATED means it stopped early
        # (eviction, early move-out, etc.) — worth distinguishing for
        # any future reporting, even though nothing branches on it yet

    status = models.CharField(max_length=20, choices=Status.choices, default=Status.ACTIVE)

    created_by = models.ForeignKey(
        'accounts.User', on_delete=models.SET_NULL, null=True, blank=True,
        related_name='leases_created'
    )
    # Which staff/landlord account actually entered this record — an
    # audit trail field, not part of the lease's real-world terms.
    # SET_NULL (not CASCADE) for the same reason StaffProfile uses it on
    # Listing.verified_by_staff: losing the creator's account should
    # never delete real lease data

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.renter_profile} - {self.listing} ({self.status})"


class LeaseRecord(models.Model):
    # A single payment/contract entry tied to a Lease — covers BOTH
    # "Contract downloads" and "receipts" from the roadmap (item 4) as one
    # structured model, rather than two near-identical tables. No file
    # upload for either kind yet (MVP scope, per the actual product
    # decision) — record_type distinguishes contract-signing events from
    # actual money-movement receipts

    lease = models.ForeignKey(Lease, on_delete=models.CASCADE, related_name='records')

    class RecordType(models.TextChoices):
        CONTRACT = 'contract', 'Contract'
        RECEIPT = 'receipt', 'Receipt'

    record_type = models.CharField(max_length=20, choices=RecordType.choices)

    class Method(models.TextChoices):
        MOMO = 'momo', 'Mobile Money'
        CASH = 'cash', 'Cash'
        BANK_TRANSFER = 'bank_transfer', 'Bank Transfer'
        OTHER = 'other', 'Other'
        # Deliberately NOT Paystack-specific — this money moves entirely
        # off-platform between landlord and renter, so there's no Paystack
        # reference/webhook backing this the way ListingUnlock/
        # LandlordSubscription have. blank=True below since a CONTRACT
        # record has no payment method at all

    method = models.CharField(max_length=20, choices=Method.choices, blank=True)

    amount = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    # Optional — a CONTRACT record (e.g. "lease signed") has no amount;
    # only RECEIPT records genuinely need one

    reference = models.CharField(max_length=100, blank=True)
    # A free-text reference staff/landlord can note by hand (e.g. a MoMo
    # transaction ID, a bank slip number) — purely informational, not
    # verified against anything, since the money movement itself happens
    # entirely outside paddy's systems

    occurred_at = models.DateField()
    # When the underlying event actually happened (signed / paid) — kept
    # separate from created_at below, which is just when the RECORD was
    # entered into paddy, possibly after the fact

    notes = models.TextField(blank=True)

    created_by = models.ForeignKey(
        'accounts.User', on_delete=models.SET_NULL, null=True, blank=True,
        related_name='lease_records_created'
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-occurred_at']

    def __str__(self):
        return f"{self.get_record_type_display()} - {self.lease} - {self.occurred_at}"

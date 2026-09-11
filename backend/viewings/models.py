from django.db import models
from accounts.models import RenterProfile, StaffProfile
from listings.models import Listing


class Viewing(models.Model):
    listing = models.ForeignKey(Listing, on_delete=models.CASCADE, related_name='viewings')
    renter_profile = models.ForeignKey(RenterProfile, on_delete=models.CASCADE, related_name='viewings')
    staff_profile = models.ForeignKey(StaffProfile, on_delete=models.SET_NULL, null=True, blank=True, related_name='viewings')
    
    
    class Status(models.TextChoices):
        REQUESTED = 'requested', 'Requested'
        SCHEDULED = 'scheduled', 'Scheduled'
        COMPLETED = 'completed', 'Completed'
        CANCELLED_NO_SHOW = 'cancelled_no_show', 'Cancelled / No-show'
    
    scheduled_at = models.DateTimeField()
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.REQUESTED)
    created_at = models.DateTimeField(auto_now_add=True)
    
    def __str__(self):
        return f"{self.renter_profile} viewing {self.listing} at {self.scheduled_at}"
    
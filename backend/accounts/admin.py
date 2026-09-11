from django.contrib import admin
# Still need this — admin.site is the actual registry Django admin uses
# to know which models to display at all

from unfold.admin import ModelAdmin
# Unfold's themed base class — what actually applies the new visual styling

from .models import User, RenterProfile, LandlordProfile, StaffProfile


@admin.register(User)
# @admin.register(...) is a decorator — a shorthand equivalent to calling
# admin.site.register(User, UserAdmin) after defining the class below.
# This is the standard modern Django pattern (cleaner than plain
# admin.site.register on its own), and it's what lets us also customize
# each model's specific admin class if needed

class UserAdmin(ModelAdmin):
    # Inherits from Unfold's ModelAdmin instead of the plain default —
    # this is the actual thing that makes User's admin page themed
    pass
    # pass = "nothing extra to configure right now, just use Unfold's
    # defaults" — you could add things here later (which columns show
    # in the list view, search fields, etc.)


@admin.register(RenterProfile)
class RenterProfileAdmin(ModelAdmin):
    pass


@admin.register(LandlordProfile)
class LandlordProfileAdmin(ModelAdmin):
    pass


@admin.register(StaffProfile)
class StaffProfileAdmin(ModelAdmin):
    pass

from django.contrib import admin
from unfold.admin import ModelAdmin
from .models import Amenity



@admin.register(Amenity)
# @admin.register(...) is a decorator — a shorthand equivalent to calling
# admin.site.register(User, UserAdmin) after defining the class below.
# This is the standard modern Django pattern (cleaner than plain
# admin.site.register on its own), and it's what lets us also customize
# each model's specific admin class if needed

class Amenity(ModelAdmin):
    # Inherits from Unfold's ModelAdmin instead of the plain default —
    # this is the actual thing that makes User's admin page themed
    pass
    # pass = "nothing extra to configure right now, just use Unfold's
    # defaults" — you could add things here later (which columns show
    # in the list view, search fields, etc.)


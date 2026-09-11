from django.contrib import admin
from unfold.admin import ModelAdmin
# Same Unfold pattern as accounts/admin.py — themed admin interface

from .models import Viewing


@admin.register(Viewing)
class ViewingAdmin(ModelAdmin):
    pass
    # Empty for now, same as our accounts admin classes — can customize
    # later (e.g. list_display to show specific columns, search_fields
    # for a search box, list_filter for status/city filtering)


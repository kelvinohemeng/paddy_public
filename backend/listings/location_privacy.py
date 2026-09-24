import math

from django.contrib.gis.geos import Point, Polygon


LOCATION_GRID_DEGREES = 0.005
# Size of one grid cell, in degrees, for the coarsened location shown
# to viewers who haven't unlocked a listing. 0.005° ≈ 555m of latitude,
# and ≈ 553m of longitude at Accra/Kumasi's ~5-7°N — so a locked
# listing's pin only ever tells you "somewhere in this ~550m square".
# The cell CENTRE is at most ~390m (half the diagonal) from the real
# point, which keeps it inside the ~600m "approximate area" circle the
# frontend's property-map.tsx draws around a locked listing.
#
# Changing this value changes every locked pin on the map at once —
# fine to do, but keep snap_point and snap_bbox below using the SAME
# constant, or the bbox filter stops lining up with the pins again.


def _cell_index(coordinate):
    return math.floor(coordinate / LOCATION_GRID_DEGREES)
    # Which grid cell a single coordinate falls into. math.floor (not
    # int(), not round()) — int() truncates toward zero, which would
    # make the cell straddling 0° longitude (Greenwich runs right
    # through Accra's west side, around -0.2°) twice as wide as every
    # other cell. floor gives every cell the same width on both sides.


def snap_point(point):
    # The coarsened stand-in for a listing's real location — the centre
    # of the grid cell the real point sits in.
    #
    # Deterministic on purpose: the same real point ALWAYS maps to the
    # same coarse point, on every request. Random jitter would be worse
    # than useless here — anyone could fetch the listing a few hundred
    # times and average the noise back out to the real location. A cell
    # centre gives away nothing but the cell, no matter how many times
    # it's asked for.

    half = LOCATION_GRID_DEGREES / 2
    lng = _cell_index(point.x) * LOCATION_GRID_DEGREES + half
    lat = _cell_index(point.y) * LOCATION_GRID_DEGREES + half
    return Point(round(lng, 6), round(lat, 6), srid=point.srid)
    # round(..., 6) only tidies float noise (-0.18250000000000002 →
    # -0.1825) so the WKT string stays clean; it's far finer than the
    # grid itself, so it never moves the point into a different cell.
    # Same SRID as the input so the serialized "SRID=4326;POINT (...)"
    # string keeps the exact shape the frontend's parseWktPoint expects.


def snap_bbox(west, south, east, north):
    # Widens a map-viewport rectangle OUTWARD to the nearest grid lines
    # before it's used to filter listings on their REAL location.
    #
    # Why this exists at all: coarsening only the serialized point isn't
    # enough on its own. The bbox filter still runs against the real,
    # exact DB column — so without this, anyone could shrink the box
    # around a listing step by step (is it still returned? halve the box
    # again) and binary-search their way to the exact coordinates the
    # unlock fee is meant to protect, without ever seeing a raw point.
    # Once the box always covers whole grid cells, whether a listing is
    # returned depends only on WHICH CELL it's in — the same information
    # the coarsened pin already gives away, nothing more.
    #
    # Applied to everyone (owners/staff included) rather than per-role:
    # the only cost is a map fetch returning listings up to one cell
    # (~550m) past the visible edge, which is harmless, and it keeps the
    # queryset free of any per-viewer location logic.

    return Polygon.from_bbox((
        math.floor(west / LOCATION_GRID_DEGREES) * LOCATION_GRID_DEGREES,
        math.floor(south / LOCATION_GRID_DEGREES) * LOCATION_GRID_DEGREES,
        math.ceil(east / LOCATION_GRID_DEGREES) * LOCATION_GRID_DEGREES,
        math.ceil(north / LOCATION_GRID_DEGREES) * LOCATION_GRID_DEGREES,
    ))
    # floor on the west/south edges, ceil on the east/north edges —
    # always rounding AWAY from the box's middle, so the snapped box is
    # never smaller than what was asked for (no listing that the real
    # viewport contains can drop out of the results).

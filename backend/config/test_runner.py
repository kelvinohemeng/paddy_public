import unittest

from django.core.cache import cache
from django.test.runner import DiscoverRunner


class CacheClearingResult(unittest.TextTestResult):
    def startTest(self, test):
        cache.clear()
        # Every test starts with an empty cache. DRF keeps its rate-limit
        # counters there (the in-memory default cache), and that cache
        # outlives a single test: without this, anonymous requests from
        # earlier tests count against the 30/min "anon" limit, and a later
        # test randomly gets "429 throttled" depending on how fast the
        # machine runs the suite (CI is fast enough to hit it).
        super().startTest(test)


class CacheClearingTestRunner(DiscoverRunner):
    # Django's normal test runner, plus the clean cache per test above.
    # Wired up by TEST_RUNNER in settings.py.

    def get_resultclass(self):
        return super().get_resultclass() or CacheClearingResult
        # --debug-sql and --pdb bring their own result classes; those
        # debugging runs keep Django's behaviour unchanged.

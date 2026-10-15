"""Retain rc1 regression coverage; 404 now denotes missing fixture, not hardware FAIL.
Shared fixture infrastructure is in cases_base.py; all inherited tests still execute.
"""
import unittest
import cases_base as base

CommonTests = base.CommonTests
NativeTests = base.NativeTests
WiringTests = base.WiringTests

class NetworkTests(base.NetworkTests):
    def test_http_404(self):
        p = self.check('/404')
        self.assertEqual(p.returncode, 3, p.stdout)
        self.assertIn('REMOTE_ASSET_UNAVAILABLE', p.stdout)

if __name__ == '__main__':
    unittest.main()

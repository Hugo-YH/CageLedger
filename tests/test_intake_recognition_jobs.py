import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import Mock, patch

from server_app.domains.intake.recognition_jobs import RecognitionJobs
from server_app.domains.intake.recognition_uploads import RecognitionBusy
from server_app.web import intake_ai


def wait_until(predicate):
    deadline = time.monotonic() + 2
    while not predicate():
        if time.monotonic() > deadline:
            raise AssertionError("worker did not enter the expected phase")
        threading.Event().wait(0.005)


class RecognitionJobTests(unittest.TestCase):
    def test_only_running_equal_requests_merge_and_admission_is_bounded(self):
        jobs = RecognitionJobs(capacity=2, max_waiters=1)
        started, release = threading.Event(), threading.Event()
        calls = []

        def operation():
            calls.append(True)
            started.set()
            if not release.wait(3):
                raise AssertionError("test worker was not released")
            return {"item": {"quantity": 30}}

        with ThreadPoolExecutor(max_workers=3) as pool:
            owner = pool.submit(jobs.run, "same-input", operation)
            self.assertTrue(started.wait(2))
            follower = pool.submit(jobs.run, "same-input", operation)
            wait_until(lambda: jobs.waiters == 1)
            other = pool.submit(jobs.run, "different-input", operation)
            wait_until(lambda: len(calls) == 2)
            try:
                with self.assertRaises(RecognitionBusy):
                    jobs.run("third-input", operation)
                with self.assertRaises(RecognitionBusy):
                    jobs.run("same-input", operation)
            finally:
                release.set()
            a, b = owner.result(), follower.result()
            other.result()
        a["item"]["quantity"] = 999
        self.assertEqual(b["item"]["quantity"], 30)
        self.assertEqual((jobs.flights, jobs.waiters), ({}, 0))
        jobs.run("same-input", operation)
        self.assertEqual(len(calls), 3)  # Explicit retry after completion is a fresh inference.

    def test_failures_release_capacity_and_are_never_cached(self):
        jobs = RecognitionJobs(capacity=1)
        with self.assertRaisesRegex(ValueError, "upstream failed"):
            jobs.run("input", lambda: (_ for _ in ()).throw(ValueError("upstream failed")))
        self.assertEqual(jobs.run("input", lambda: {"ok": True}), {"ok": True})
        self.assertEqual(jobs.flights, {})

    def test_http_coalescing_is_account_scoped_and_busy_is_explicit(self):
        jobs = RecognitionJobs(capacity=2)
        release = threading.Event()
        calls = []

        def parse(*_):
            calls.append(True)
            if not release.wait(3):
                raise AssertionError("test worker was not released")
            return {"quantity": 30}, {}

        def handler(account):
            value = Mock()
            value.current_user.return_value = {"id": account}
            value.read_json_body.return_value = {"rawMessage": "same message"}
            return value

        with (
            patch.object(intake_ai, "JOBS", jobs),
            patch.object(intake_ai, "ai_parse_intake_message", side_effect=parse),
        ):
            with ThreadPoolExecutor(max_workers=2) as pool:
                a = pool.submit(intake_ai.intake_ai_parse_handler, handler("a"), {})
                b = pool.submit(intake_ai.intake_ai_parse_handler, handler("b"), {})
                try:
                    wait_until(lambda: len(calls) == 2)
                    self.assertEqual(intake_ai.intake_ai_parse_handler(handler("c"), {}).status, 503)
                finally:
                    release.set()
                self.assertEqual((a.result().status, b.result().status), (200, 200))

import unittest
from threading import Event
from unittest.mock import Mock, patch

from server_app.pdf.cache import PdfQueueFull
from server_app.pdf.renderer import PersistentChromiumRenderer, RenderJob
from server_app.web.pdf_exports import schedule_pdf_cache_refresh


class PdfAdmissionTests(unittest.TestCase):
    def test_renderer_queue_is_bounded_and_reserves_shutdown_capacity(self):
        renderer = PersistentChromiumRenderer(max_pending=1)
        renderer._thread = Mock()
        renderer._thread.is_alive.return_value = True
        first = RenderJob(markup="<html>first</html>", completed=Event())
        renderer._enqueue(first, 0)
        with self.assertRaisesRegex(RuntimeError, "队列繁忙"):
            renderer._enqueue(RenderJob(markup="must not queue", completed=Event()), 0)
        self.assertEqual(renderer.snapshot()["queueDepth"], 1)
        renderer.shutdown(timeout=0)
        self.assertEqual(renderer._jobs.qsize(), 2)
        renderer._fail_pending(RuntimeError("renderer stopping"))
        self.assertTrue(first.completed.is_set())

    def test_background_backpressure_or_failure_never_changes_a_committed_save_result(self):
        sheet = {"id": "sheet", "month": "2026-10", "pi": "PI"}
        for error in (PdfQueueFull(), OSError("private local path")):
            with (
                self.subTest(error=type(error).__name__),
                patch("server_app.web.pdf_exports._enqueue_quantity_pdf", side_effect=error),
                patch("server_app.web.pdf_exports.emit_event") as log,
            ):
                schedule_pdf_cache_refresh([sheet], connect_db=Mock(), generate_statement=Mock())
                self.assertTrue(log.called)
                self.assertNotIn("private local path", str(log.call_args.kwargs.get("message", "")))


if __name__ == "__main__":
    unittest.main()

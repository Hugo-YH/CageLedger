import signal
import unittest
from contextlib import ExitStack
from unittest.mock import Mock, patch

from server_app import runtime


class RuntimeShutdownTests(unittest.TestCase):
    def run_service(self, *, bind_error=None, signal_during_prewarm=False, repeat_during_cleanup=False):
        events, handlers, originals = [], {}, {}
        server = Mock()

        def install(name, handler):
            previous = handlers.get(name)
            if previous is None:
                previous = object()
                originals[name] = previous
            handlers[name] = handler
            return previous

        def prewarm():
            events.append("prewarm")
            if signal_during_prewarm:
                handlers[signal.SIGTERM](signal.SIGTERM, None)

        def render_stop():
            events.append("renderer-stop")
            if repeat_during_cleanup:
                handlers[signal.SIGTERM](signal.SIGTERM, None)

        def serve_forever():
            events.append("serving")
            handlers[signal.SIGTERM](signal.SIGTERM, None)

        server.serve_forever.side_effect = serve_forever
        server.server_close.side_effect = lambda: events.append("server-close")
        with ExitStack() as stack:
            for name in [
                "configure_runtime_logging",
                "ensure_database_ready",
                "start_auto_import_watcher",
                "start_performance_history_sampler",
                "emit_event",
            ]:
                stack.enter_context(patch.object(runtime, name))
            stack.enter_context(patch.object(runtime.signal, "signal", side_effect=install))
            stack.enter_context(patch.object(runtime, "prewarm_pdf_renderer", side_effect=prewarm))
            stack.enter_context(patch.object(runtime, "shutdown_pdf_renderer", side_effect=render_stop))
            stack.enter_context(
                patch.object(runtime.feedback_worker, "start", side_effect=lambda: events.append("feedback-start"))
            )
            stack.enter_context(
                patch.object(runtime.feedback_worker, "stop", side_effect=lambda: events.append("feedback-stop"))
            )
            stack.enter_context(
                patch.object(runtime, "ThreadingHTTPServer", side_effect=bind_error, return_value=server)
            )
            if bind_error:
                with self.assertRaisesRegex(OSError, "bind failed"):
                    runtime.serve(object)
            else:
                runtime.serve(object)
        self.assertEqual(handlers, originals)
        return events

    def test_sigterm_closes_server_and_renderer_and_restores_signal_handlers(self):
        self.assertEqual(
            self.run_service(),
            ["prewarm", "feedback-start", "serving", "feedback-stop", "server-close", "renderer-stop"],
        )

    def test_bind_failure_after_prewarm_still_closes_owned_renderer(self):
        self.assertEqual(
            self.run_service(bind_error=OSError("bind failed")),
            ["prewarm", "feedback-start", "feedback-stop", "renderer-stop"],
        )

    def test_shutdown_during_initialization_closes_renderer_without_assuming_server_exists(self):
        self.assertEqual(self.run_service(signal_during_prewarm=True), ["prewarm", "renderer-stop"])

    def test_second_sigterm_during_cleanup_does_not_interrupt_owner_cleanup(self):
        self.assertEqual(self.run_service(repeat_during_cleanup=True)[-2:], ["server-close", "renderer-stop"])

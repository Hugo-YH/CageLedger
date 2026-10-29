import http.client
import threading
import unittest
from http.server import BaseHTTPRequestHandler

from server_app.web.server import BoundedThreadingHTTPServer


class HttpAdmissionTests(unittest.TestCase):
    def test_capacity_rejects_before_handler_and_recovers_when_slot_is_released(self):
        entered = threading.Event()
        release = threading.Event()
        calls = []

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                calls.append(self.path)
                if self.path == "/hold":
                    entered.set()
                    release.wait(3)
                self.send_response(200)
                self.send_header("Content-Length", "2")
                self.end_headers()
                self.wfile.write(b"ok")

            def log_message(self, *args):
                pass

        server = BoundedThreadingHTTPServer(("127.0.0.1", 0), Handler, max_workers=1)
        thread = threading.Thread(target=server.serve_forever)
        thread.start()
        holding = http.client.HTTPConnection(*server.server_address, timeout=4)
        try:
            holding.request("GET", "/hold")
            self.assertTrue(entered.wait(1))
            rejected = http.client.HTTPConnection(*server.server_address, timeout=2)
            try:
                rejected.request("POST", "/must-not-run")
                response = rejected.getresponse()
                self.assertEqual(response.status, 503)
                self.assertEqual(response.getheader("Retry-After"), "1")
                self.assertIn("繁忙", response.read().decode())
                self.assertEqual(calls, ["/hold"])
            finally:
                rejected.close()
            release.set()
            self.assertEqual(holding.getresponse().read(), b"ok")
            # Wait for cleanup to return the slot without polling network requests.
            self.assertTrue(server._admission.acquire(timeout=1))
            server._admission.release()
            accepted = http.client.HTTPConnection(*server.server_address, timeout=2)
            try:
                accepted.request("GET", "/next")
                response = accepted.getresponse()
                self.assertEqual(response.status, 200)
                self.assertEqual(response.read(), b"ok")
            finally:
                accepted.close()
        finally:
            release.set()
            holding.close()
            server.shutdown()
            thread.join(2)
            server.server_close()


if __name__ == "__main__":
    unittest.main()

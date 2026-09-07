"""Forward Polar CLI requests from WSL loopback to Windows loopback."""

from http.server import BaseHTTPRequestHandler, HTTPServer
import subprocess


class PolarRelay(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path != "/api/auth/polar/webhooks":
            self.send_error(404)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self.send_error(400)
            return
        if length <= 0 or length > 1_048_576:
            self.send_error(413)
            return
        command = [
            "/mnt/c/Windows/System32/curl.exe",
            "--silent", "--show-error", "--max-time", "30",
            "--request", "POST", "--data-binary", "@-",
            "--header", "Content-Type: application/json",
            "--write-out", "\n%{http_code}",
            "http://localhost:3000/api/auth/polar/webhooks",
        ]
        for name in ("webhook-id", "webhook-timestamp", "webhook-signature"):
            value = self.headers.get(name)
            if value:
                command.extend(["--header", f"{name}: {value}"])
        try:
            result = subprocess.run(
                command, input=self.rfile.read(length),
                capture_output=True, timeout=35, check=False,
            )
            body, status = result.stdout.rsplit(b"\n", 1)
            if result.returncode or not 100 <= int(status) <= 599:
                raise ValueError("Windows app unavailable")
        except (OSError, subprocess.TimeoutExpired, ValueError):
            self.send_error(502, "Windows development app unavailable")
            return
        self.send_response(int(status))
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, _format, *_args):
        pass


print("Polar WSL relay on 127.0.0.1:4300, webhook route only", flush=True)
HTTPServer(("127.0.0.1", 4300), PolarRelay).serve_forever()

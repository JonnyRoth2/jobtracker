#!/usr/bin/env python3
"""
Local job-application tracker server.

Receives a POST from the browser extension every time you click "Apply" on
LinkedIn, Indeed, or Handshake, dedups by job URL, and appends a row to
applications.csv right next to this file.

No third-party dependencies. Just run it:

    python3 server.py

Then load the extension/ folder in Chrome (see README.md) and browse normally.
"""

import csv
import json
import os
import threading
from datetime import date
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# 127.0.0.1 is reachable from Windows Chrome through WSL2's localhost forwarding.
# If the extension can't reach the server, change HOST to "0.0.0.0" (see README).
HOST = "127.0.0.1"
PORT = 5000

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CSV_PATH = os.path.join(BASE_DIR, "applications.csv")

FIELDS = ["date", "company", "title", "location", "source", "url", "description"]
MAX_DESCRIPTION = 8000

_lock = threading.Lock()


def existing_urls():
    """URLs already in the CSV, so we never log the same job twice."""
    if not os.path.exists(CSV_PATH):
        return set()
    with open(CSV_PATH, newline="", encoding="utf-8") as f:
        return {(row.get("url") or "") for row in csv.DictReader(f)}


def append_row(row):
    file_exists = os.path.exists(CSV_PATH)
    with open(CSV_PATH, "a", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDS)
        if not file_exists:
            writer.writeheader()
        writer.writerow(row)


def save_application(data):
    """Persist one application. Returns 'saved' | 'duplicate' | 'ignored'."""
    url = (data.get("url") or "").strip()
    title = (data.get("title") or "").strip()
    company = (data.get("company") or "").strip()

    # A bare URL with no title/company is almost always a misfire, skip it.
    if not url or not (title or company):
        return "ignored", None

    with _lock:
        if url in existing_urls():
            return "duplicate", None

        row = {
            "date": date.today().isoformat(),
            "company": company,
            "title": title,
            "location": (data.get("location") or "").strip(),
            "source": (data.get("source") or "").strip(),
            "url": url,
            "description": (data.get("description") or "").strip()[:MAX_DESCRIPTION],
        }
        append_row(row)
    return "saved", row


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _json(self, code, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self._cors()
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):  # CORS preflight from the extension
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):  # quick sanity check in the browser at http://localhost:5000
        self._json(200, {"status": "ok", "tracked": len(existing_urls()), "csv": CSV_PATH})

    def do_POST(self):
        if self.path.rstrip("/") not in ("/track", ""):
            self._json(404, {"error": "not found"})
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
            data = json.loads(self.rfile.read(length) or b"{}")
        except (ValueError, json.JSONDecodeError):
            self._json(400, {"error": "invalid JSON"})
            return

        status, row = save_application(data)
        if status == "saved":
            print(f"[saved] {row['company']} — {row['title']} ({row['source']})")
        elif status == "duplicate":
            print(f"[dup]   {data.get('url')}")
        else:
            print(f"[skip]  missing url/title/company")
        self._json(200, {"status": status})

    def log_message(self, *args):
        pass  # silence default per-request logging; we print our own lines


def main():
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"Job tracker listening on http://{HOST}:{PORT}")
    print(f"Saving applications to {CSV_PATH}")
    print("Leave this running, browse + click Apply as normal. Ctrl-C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()

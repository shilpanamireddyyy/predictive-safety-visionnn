from __future__ import annotations

import mimetypes
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


ROOT = Path(__file__).resolve().parent
LOCAL_VIDEO = Path(os.environ.get("TRAFFIC_VIDEO_PATH", ROOT / "local-traffic.mp4"))


class DemoHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self) -> None:
        if self.path.split("?", 1)[0] == "/local-traffic.mp4":
            self.serve_video()
            return
        super().do_GET()

    def serve_video(self) -> None:
        if not LOCAL_VIDEO.exists():
            self.send_error(404, "Local traffic video not found")
            return

        file_size = LOCAL_VIDEO.stat().st_size
        range_header = self.headers.get("Range")
        start = 0
        end = file_size - 1

        if range_header:
            try:
                units, value = range_header.split("=", 1)
                if units == "bytes":
                    start_text, end_text = value.split("-", 1)
                    start = int(start_text) if start_text else 0
                    end = int(end_text) if end_text else file_size - 1
            except ValueError:
                start = 0
                end = file_size - 1

        start = max(0, min(start, file_size - 1))
        end = max(start, min(end, file_size - 1))
        length = end - start + 1

        self.send_response(206 if range_header else 200)
        self.send_header("Content-Type", mimetypes.guess_type(LOCAL_VIDEO.name)[0] or "video/mp4")
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(length))
        if range_header:
            self.send_header("Content-Range", f"bytes {start}-{end}/{file_size}")
        self.end_headers()

        with LOCAL_VIDEO.open("rb") as video:
            video.seek(start)
            remaining = length
            while remaining > 0:
                chunk = video.read(min(1024 * 1024, remaining))
                if not chunk:
                    break
                self.wfile.write(chunk)
                remaining -= len(chunk)


def main() -> None:
    server = ThreadingHTTPServer(("127.0.0.1", 8765), DemoHandler)
    print("Predictive safety demo running at http://127.0.0.1:8765/real-video-demo.html")
    server.serve_forever()


if __name__ == "__main__":
    main()

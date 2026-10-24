"""캐시를 끈 로컬 서버. 파일을 고친 뒤 새로고침하면 항상 최신 JS 모듈을 받는다.

실행:  python scripts/serve.py [포트=8731]
"""
import http.server
import sys
from functools import partial
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8731
    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), partial(NoCacheHandler, directory=str(ROOT)))
    print(f"http://localhost:{port}")
    server.serve_forever()

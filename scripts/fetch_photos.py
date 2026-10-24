"""위키미디어 공용(Commons)의 아주대학교 사진을 reference-photos/ 에 내려받고 출처를 credits.json 에 기록한다.

실행:  python scripts/fetch_photos.py
"""
import json
import re
import time
import urllib.parse
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "reference-photos"
UA = "ajou-3d-campus/1.0 (student project)"
API = "https://commons.wikimedia.org/w/api.php"

TITLES = [
    "File:0-campus-sm-Ajou.jpg",
    "File:0-ss-ajou-symbol.jpg",
    "File:0-ss-research3.jpg",
    "File:Ajou Library.jpg",
    "File:Ajou media.jpg",
    "File:AjouUniv.jpg",
    "File:Fall at Ajou.jpg",
    "File:아주대 의대.jpg",
    "File:아주대학교 산학협력원.jpg",
]


def get(url, tries=5):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    for n in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code != 429 or n == tries - 1:
                raise
            time.sleep(5 * 2 ** n)  # 요청 제한 — 점점 길게 기다렸다 재시도


def clean(html):
    return re.sub(r"<[^>]+>", "", html or "").strip()


def main():
    OUT.mkdir(exist_ok=True)
    params = {
        "action": "query", "prop": "imageinfo", "format": "json",
        "iiprop": "url|extmetadata|size", "iiurlwidth": "1280",
        "titles": "|".join(TITLES),
    }
    data = json.loads(get(API + "?" + urllib.parse.urlencode(params)))
    credits = []
    for i, page in enumerate(sorted(data["query"]["pages"].values(), key=lambda p: p["title"]), 1):
        if "imageinfo" not in page:
            print("없음:", page.get("title"))
            continue
        ii = page["imageinfo"][0]
        meta = ii["extmetadata"]
        m = lambda k: clean(meta.get(k, {}).get("value"))
        fname = f"{i:02d}.jpg"
        if not (OUT / fname).exists():
            (OUT / fname).write_bytes(get(ii["thumburl"]))
            time.sleep(3)
        credits.append({
            "file": fname, "title": page["title"], "source": ii["descriptionurl"],
            "license": m("LicenseShortName"), "author": m("Artist"),
            "date": m("DateTimeOriginal"), "description": m("ImageDescription")[:300],
        })
        print(fname, page["title"], "|", m("LicenseShortName"), "|", m("Artist"))
    (OUT / "credits.json").write_text(json.dumps(credits, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()

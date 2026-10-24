"""아주대 공식 캠퍼스맵(ajou.ac.kr/kr/intro/way01.do)의 건물 정보를 받아 OSM 건물과 맞춘다.

  - mode=buildList : 건물 번호 · 이름 · 좌표
  - mode=buildInfo : 설명문 (지하/지상 층수, 층별 안내, 준공 연도)
결과: data/official_buildings.json  {osm id: {...}} + "unmatched": [OSM 외곽선이 없는 공식 시설]

실행:  python scripts/fetch_official.py   (그다음 python scripts/process_osm.py)
"""
import json
import math
import re
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BASE = "https://www.ajou.ac.kr/kr/intro/way01.do"
UA = {"User-Agent": "Mozilla/5.0 (ajou-3d-campus student project)"}


def get_json(url):
    return json.loads(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40).read().decode("utf-8"))


def parse(text):
    """설명문에서 층수 · 준공 연도 · 층별 안내를 뽑는다."""
    text = (text or "").replace("\r", "")
    above = re.search(r"지상\s*(\d+)\s*층", text)
    below = re.search(r"지하\s*(\d+)\s*층", text)
    year = re.search(r"((?:19|20)\d\d)\s*년(?:\s*\d+\s*월)?[^.\n]{0,15}(?:준공|완공|건립|신축|개관)", text)
    top, base = 0, 0
    floors = []
    # "- 3F~5F ...", "- 6F/7F/8F 병동", "- B3/B2 주차장" 처럼 묶인 층도 모두 센다
    tok = r"(?:B\d+|\d+F)"
    for m in re.finditer(rf"^-\s*({tok}(?:\s*[/~∼,\-]\s*{tok}|\s*[/~∼]\s*\d+F?)*)\s*:?\s*(.*)$", text, re.M):
        span, what = m.groups()
        floors.append({"floor": re.sub(r"\s+", "", span), "use": what.strip()})
        for b in re.findall(r"B(\d+)", span):
            base = max(base, int(b))
        nums = [int(n) for n in re.findall(r"(?<!B)(\d+)F?", re.sub(r"B\d+", "", span))]
        if nums:
            top = max(top, *nums)
    t_above = int(above.group(1)) if above else None
    t_below = int(below.group(1)) if below else None
    # 본문 숫자와 층별 목록이 다르면 큰 값을 쓰고(목록이 일부 층을 빼거나 본문이 한 동만 말하는 경우) 신뢰도를 낮춘다
    cands = [v for v in (t_above, top or None) if v]
    fa = max(cands) if cands else None
    fb = max([v for v in (t_below, base or None) if v], default=None)
    agree = bool(t_above and top and t_above == top) or (bool(cands) and len(cands) == 1)
    summary = text.split("\n\n")[0].strip()
    return {"floors_above": fa, "floors_below": fb, "floors_agree": agree, "text_above": t_above, "list_top": top or None,
            "year": int(year.group(1)) if year else None, "floor_guide": floors, "summary": summary}


def main():
    s = (ROOT / "campus-data.js").read_text(encoding="utf-8")
    data = json.loads(s[s.index("=") + 1:].rstrip().rstrip(";"))
    lat0, lon0 = data["origin"]["lat"], data["origin"]["lon"]
    kx, ky = 111_320 * math.cos(math.radians(lat0)), 110_540

    def dist_to(pt, poly):
        x, y = pt
        inside, j = False, len(poly) - 1
        for i in range(len(poly)):
            xi, yi = poly[i]
            xj, yj = poly[j]
            if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
                inside = not inside
            j = i
        if inside:
            return 0.0
        best = 1e9
        for i in range(len(poly)):
            (ax, ay), (bx, by) = poly[i], poly[(i + 1) % len(poly)]
            dx, dy = bx - ax, by - ay
            t = max(0, min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy or 1)))
            best = min(best, math.hypot(x - ax - dx * t, y - ay - dy * t))
        return best

    items = get_json(BASE + "?mode=buildList")["items"]
    matched, unmatched = {}, []
    for it in items:
        info = get_json(f"{BASE}?mode=buildInfo&id={it['buildNo']}").get("item") or {}
        time.sleep(0.2)
        x = (float(it["longtitude"]) - lon0) * kx
        y = (float(it["latitude"]) - lat0) * ky
        rec = {"buildNo": it["buildNo"], "name": re.sub(r"\(기숙사\)", "", it["koBuildNm"]).strip(), "nameEn": it["enBuildNm"],
               "point": [round(x, 1), round(y, 1)], **parse(info.get("koText")),
               "photo": ("https://www.ajou.ac.kr" + info["attach"][0]["filePath"] + info["attach"][0]["encodeNm"]) if info.get("attach") else None,
               "source": f"{BASE}?mode=buildInfo&id={it['buildNo']}"}
        d, b = min(((dist_to((x, y), b["outer"]), b) for b in data["buildings"] if not str(b["id"]).startswith("extra")),
                   key=lambda t: t[0])
        if d < 12:
            matched[str(b["id"])] = rec
        else:
            unmatched.append(rec)
    out = {**matched, "unmatched": unmatched}
    (ROOT / "data" / "official_buildings.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"official: matched {len(matched)}, unmatched {len(unmatched)}")


if __name__ == "__main__":
    main()

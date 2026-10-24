"""VWorld 위성영상(줌 19, 약 0.24m/px)으로 건물 분석 자료를 만든다.

  1) 캠퍼스 영상 모자이크 (캐시 폴더에 저장 — 영상 자체는 프로젝트에 넣지 않음)
  2) 건물별 분석 이미지: OSM 외곽선(빨강) + 10m 로컬 좌표 격자 → 지붕 단차/형태 판독용
  3) 지붕 실측 색상: 외곽선 안쪽 픽셀 중 그림자·나무를 뺀 중앙값 → data/roof_colors.json

실행:  python scripts/analyze_imagery.py <캐시 폴더>
"""
import json
import math
import sys
import time
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
Z = 19
TILE = 256
UA = "ajou-3d-campus/1.0 (student project)"
URL = "https://xdworld.vworld.kr/2d/Satellite/service/{z}/{x}/{y}.jpeg"


def load_data():
    s = (ROOT / "campus-data.js").read_text(encoding="utf-8")
    return json.loads(s[s.index("=") + 1:].rstrip().rstrip(";"))


def main(cache):
    cache = Path(cache)
    (cache / "tiles").mkdir(parents=True, exist_ok=True)
    (cache / "buildings").mkdir(exist_ok=True)
    data = load_data()
    lat0, lon0 = data["origin"]["lat"], data["origin"]["lon"]
    kx, ky = 111_320 * math.cos(math.radians(lat0)), 110_540
    n = 2 ** Z

    def to_px(x, y):  # 로컬(m) → 전역 픽셀
        lat, lon = lat0 + y / ky, lon0 + x / kx
        px = (lon + 180) / 360 * n * TILE
        py = (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n * TILE
        return px, py

    allpts = [p for bd in data.get("boundaries", [{"pts": data["boundary"]}]) for p in bd["pts"]]
    xs = [p[0] for p in allpts]
    ys = [p[1] for p in allpts]
    M = 40
    gx0, gy0 = to_px(min(xs) - M, max(ys) + M)
    gx1, gy1 = to_px(max(xs) + M, min(ys) - M)
    tx0, ty0, tx1, ty1 = int(gx0 // TILE), int(gy0 // TILE), int(gx1 // TILE), int(gy1 // TILE)
    mosaic = Image.new("RGB", ((tx1 - tx0 + 1) * TILE, (ty1 - ty0 + 1) * TILE))
    for tx in range(tx0, tx1 + 1):
        for ty in range(ty0, ty1 + 1):
            f = cache / "tiles" / f"{Z}_{tx}_{ty}.jpg"
            if not f.exists():
                req = urllib.request.Request(URL.format(z=Z, x=tx, y=ty), headers={"User-Agent": UA})
                f.write_bytes(urllib.request.urlopen(req, timeout=30).read())
                time.sleep(0.05)
            mosaic.paste(Image.open(f).convert("RGB"), ((tx - tx0) * TILE, (ty - ty0) * TILE))
    mosaic.save(cache / "mosaic.jpg", quality=92)
    ox, oy = tx0 * TILE, ty0 * TILE
    (cache / "transform.json").write_text(json.dumps(
        {"z": Z, "tile": TILE, "ox": ox, "oy": oy, "lat0": lat0, "lon0": lon0, "kx": kx, "ky": ky}), encoding="utf-8")
    loc = lambda x, y: (to_px(x, y)[0] - ox, to_px(x, y)[1] - oy)   # 로컬(m) → 모자이크 픽셀
    m_per_px = 1 / (loc(1, 0)[0] - loc(0, 0)[0])
    print(f"mosaic {mosaic.size}, {m_per_px:.3f} m/px")

    # 캠퍼스 전체 개요 (외곽선 + 건물 이름)
    ov = mosaic.copy()
    d = ImageDraw.Draw(ov)
    font = ImageFont.truetype("malgun.ttf", 28) if Path("C:/Windows/Fonts/malgun.ttf").exists() else None
    for b in data["buildings"]:
        d.polygon([loc(*p) for p in b["outer"]], outline=(255, 40, 40), width=4)
        if b["name"]:
            cx = sum(p[0] for p in b["outer"]) / len(b["outer"])
            cy = sum(p[1] for p in b["outer"]) / len(b["outer"])
            d.text(loc(cx, cy), b["name"], fill=(255, 255, 0), font=font, anchor="mm", stroke_width=3, stroke_fill=(0, 0, 0))
    # 50m 로컬 좌표 격자 (위치를 좌표로 말할 수 있도록)
    gfont = ImageFont.truetype("malgun.ttf", 30) if font else None
    for gx in range(int(math.ceil((min(xs) - M) / 50) * 50), int(max(xs) + M) + 1, 50):
        d.line([loc(gx, max(ys) + M), loc(gx, min(ys) - M)], fill=(0, 255, 255), width=1)
        d.text((loc(gx, 0)[0] + 4, 6), str(gx), fill=(0, 255, 255), font=gfont, stroke_width=3, stroke_fill=(0, 0, 0))
    for gy in range(int(math.ceil((min(ys) - M) / 50) * 50), int(max(ys) + M) + 1, 50):
        d.line([loc(min(xs) - M, gy), loc(max(xs) + M, gy)], fill=(0, 255, 255), width=1)
        d.text((6, loc(0, gy)[1] + 4), str(gy), fill=(0, 255, 255), font=gfont, stroke_width=3, stroke_fill=(0, 0, 0))
    ov.resize((ov.width // 3, ov.height // 3), Image.LANCZOS).save(cache / "overview.jpg", quality=88)
    # 4분할 상세 개요 (북서/북동/남서/남동)
    w2, h2 = ov.width // 2, ov.height // 2
    for name, box in {"NW": (0, 0, w2, h2), "NE": (w2, 0, ov.width, h2), "SW": (0, h2, w2, ov.height), "SE": (w2, h2, ov.width, ov.height)}.items():
        q = ov.crop(box)
        q.resize((q.width * 2 // 3, q.height * 2 // 3), Image.LANCZOS).save(cache / f"overview_{name}.jpg", quality=88)

    arr = np.asarray(mosaic).astype(np.int16)
    roof = {}
    small = ImageFont.truetype("malgun.ttf", 16) if font else None
    for b in data["buildings"]:
        bid = str(b["id"])
        pts = [loc(*p) for p in b["outer"]]
        # 지붕 색: 외곽선 2m 안쪽, 그림자(어두움)·식생(녹색 우세) 제외 중앙값
        mask_img = Image.new("L", mosaic.size, 0)
        md = ImageDraw.Draw(mask_img)
        md.polygon(pts, fill=255)
        for h in b["holes"]:
            md.polygon([loc(*p) for p in h], fill=0)
        md.line(pts + [pts[0]], fill=0, width=max(1, int(4 / m_per_px)))
        mask = np.asarray(mask_img) > 0
        px = arr[mask]
        if len(px):
            lum = px.mean(axis=1)
            veg = (px[:, 1] > px[:, 0] + 12) & (px[:, 1] > px[:, 2] + 12)
            good = px[(lum > 70) & ~veg]
            if len(good) < 30:
                good = px
            med = np.median(good, axis=0).astype(int)
            roof[bid] = {"name": b["name"], "hex": "#%02x%02x%02x" % tuple(med), "samples": int(len(good))}

        # 분석용 크롭: 외곽선 + 10m 격자(로컬 좌표 라벨)
        bx = [p[0] for p in b["outer"]]
        by = [p[1] for p in b["outer"]]
        pad = 14
        x0, x1, y0, y1 = min(bx) - pad, max(bx) + pad, min(by) - pad, max(by) + pad
        (cx0, cy0), (cx1, cy1) = loc(x0, y1), loc(x1, y0)
        crop = mosaic.crop((int(cx0), int(cy0), int(cx1), int(cy1)))
        scale = max(1, min(3, 900 / max(crop.size)))
        crop = crop.resize((int(crop.width * scale), int(crop.height * scale)), Image.LANCZOS)
        d = ImageDraw.Draw(crop, "RGBA")
        tr = lambda x, y: ((loc(x, y)[0] - int(cx0)) * scale, (loc(x, y)[1] - int(cy0)) * scale)
        for gx in range(int(math.ceil(x0 / 10) * 10), int(x1) + 1, 10):
            d.line([tr(gx, y0), tr(gx, y1)], fill=(0, 255, 255, 90), width=1)
            d.text((tr(gx, y1)[0] + 2, 2), str(gx), fill=(0, 255, 255, 255), font=small, stroke_width=2, stroke_fill=(0, 0, 0))
        for gy in range(int(math.ceil(y0 / 10) * 10), int(y1) + 1, 10):
            d.line([tr(x0, gy), tr(x1, gy)], fill=(0, 255, 255, 90), width=1)
            d.text((2, tr(x0, gy)[1] + 2), str(gy), fill=(0, 255, 255, 255), font=small, stroke_width=2, stroke_fill=(0, 0, 0))
        d.polygon([tr(*p) for p in b["outer"]], outline=(255, 40, 40, 255), width=2)
        for h in b["holes"]:
            d.polygon([tr(*p) for p in h], outline=(255, 160, 40, 255), width=2)
        crop.save(cache / "buildings" / f"{bid}.jpg", quality=90)

    out = ROOT / "data" / "roof_colors.json"
    out.write_text(json.dumps(roof, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"roof colors: {len(roof)} -> {out}")


if __name__ == "__main__":
    main(sys.argv[1])

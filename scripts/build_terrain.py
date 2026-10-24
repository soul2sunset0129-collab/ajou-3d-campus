"""실제 지형 → 캠퍼스 지형 격자(terrain-data.js).

  1) 고도 원본: Copernicus GLO-30 DEM (ESA, 1초 ≈ 30 m 간격, AWS 공개 데이터 — 키 불필요)
     필요한 1024×1024 타일만 HTTP Range 로 받아 DEFLATE + 부동소수 예측자(predictor 3)를 직접 해제한다.
  2) 맨땅 추정: Copernicus 는 건물 지붕 · 나무 꼭대기가 섞인 표면 모델(DSM)이다. 약 68 m 창의 형태학적 열림
     (최솟값 → 최댓값 필터)으로 그보다 좁은 돌출(건물, 나무 무리)을 깎아 맨땅(DTM)을 추정한다.
     평평한 경사면은 열림 연산에서 그대로 보존된다. 그다음 가우시안 평활로 30 m 자료의 계단을 없앤다.
  3) 숲 보정: 열림으로도 남는 넓은 숲(캠퍼스 밖 산)은 위성영상 수관 비율만큼 수관 높이를 뺀다.
  4) 정지(整地): 차로는 길게 평활한 종단면으로, 운동장 · 주차장 · 광장은 평평하게 깎고 둘레를 완만하게 잇는다.
     건물은 평탄화하지 않는다(경사지 건물은 자연 지형에 앉아 낮은 쪽 기단이 드러남).

실행:  python scripts/build_terrain.py [위성영상 캐시 폴더]   (process_osm.py 다음에)
      위성영상 캐시 폴더 = scripts/analyze_imagery.py 에 준 폴더(mosaic.jpg, transform.json). 있으면 실제 수관 위치로 숲 보정.
"""
import base64
import json
import sys
import math
import struct
import tempfile
import urllib.request
import zlib
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "terrain-data.js"
CACHE = Path(tempfile.gettempdir()) / "ajou-3d-campus-dem"
DEM_URL = ("https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_N37_00_E127_00_DEM/"
           "Copernicus_DSM_COG_10_N37_00_E127_00_DEM.tif")
DEM_LON0, DEM_LAT0, DEM_RES = 127.0, 38.0, 1 / 3600     # PixelIsPoint
STEP = 4.0          # m — 지형 격자 간격
MARGIN = 330.0      # m — 캠퍼스 경계 밖으로 지형을 만들 폭
SMOOTH = 9.0        # m — 가우시안 평활 표준편차
OPEN_R = 8          # 칸 — 형태학적 열림 반경(8칸 × 4 m → 창 68 m)
CANOPY = 9.0        # m — 숲 수관 보정 최대값(캠퍼스 밖 숲)
UA = {"User-Agent": "ajou-3d-campus/1.0 (student project)"}


# ---------------------------------------------------------------- DEM 읽기
def http_range(url, start, length):
    req = urllib.request.Request(url, headers={**UA, "Range": f"bytes={start}-{start + length - 1}"})
    return urllib.request.urlopen(req, timeout=60).read()


def read_ifd(head):
    bo = "<" if head[:2] == b"II" else ">"
    off = struct.unpack(bo + "I", head[4:8])[0]
    n = struct.unpack(bo + "H", head[off:off + 2])[0]
    tags = {}
    sizes = {3: 2, 4: 4, 12: 8, 16: 8}
    for i in range(n):
        e = head[off + 2 + i * 12: off + 14 + i * 12]
        tag, typ, cnt = struct.unpack(bo + "HHI", e[:8])
        sz = sizes.get(typ, 1)
        fmt = {3: "H", 4: "I", 12: "d", 16: "Q"}.get(typ)
        if not fmt:
            continue
        raw = e[8:8 + sz * cnt] if sz * cnt <= 4 else head[struct.unpack(bo + "I", e[8:12])[0]:][:sz * cnt]
        tags[tag] = struct.unpack(bo + fmt * cnt, raw)
    return bo, tags


def decode_tile(data, tw, th, bo):
    """DEFLATE + predictor 3 (Adobe TN3 floating point predictor) 해제."""
    raw = np.frombuffer(zlib.decompress(data), dtype=np.uint8).reshape(th, tw * 4)
    raw = np.cumsum(raw, axis=1, dtype=np.uint8)               # 행 방향 차분 복원 (mod 256)
    planes = raw.reshape(th, 4, tw)                              # [최상위 바이트들][…][최하위 바이트들]
    be = np.stack([planes[:, k, :] for k in range(4)], axis=-1)  # 빅엔디안 순서
    return be.reshape(th, tw * 4).view(">f4").astype(np.float32)


def load_dem_window(r0, r1, c0, c1):
    CACHE.mkdir(exist_ok=True)
    head_f = CACHE / "head.bin"
    if not head_f.exists():
        head_f.write_bytes(http_range(DEM_URL, 0, 65536))
    bo, tags = read_ifd(head_f.read_bytes())
    W, H, tw, th = tags[256][0], tags[257][0], tags[322][0], tags[323][0]
    offs, cnts = tags[324], tags[325]
    tiles_x = math.ceil(W / tw)
    out = np.zeros((r1 - r0, c1 - c0), np.float32)
    for ty in range(r0 // th, (r1 - 1) // th + 1):
        for tx in range(c0 // tw, (c1 - 1) // tw + 1):
            k = ty * tiles_x + tx
            f = CACHE / f"tile_{k}.bin"
            if not f.exists():
                f.write_bytes(http_range(DEM_URL, offs[k], cnts[k]))
            tile = decode_tile(f.read_bytes(), tw, th, bo)
            ys, xs = ty * th, tx * tw
            a0, a1 = max(r0, ys), min(r1, ys + th)
            b0, b1 = max(c0, xs), min(c1, xs + tw)
            out[a0 - r0:a1 - r0, b0 - c0:b1 - c0] = tile[a0 - ys:a1 - ys, b0 - xs:b1 - xs]
    return out


# ---------------------------------------------------------------- 보조 함수
def gaussian(a, sigma_px):
    r = int(math.ceil(sigma_px * 3))
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma_px) ** 2)
    k /= k.sum()
    p = np.pad(a, r, mode="edge")
    p = np.apply_along_axis(lambda v: np.convolve(v, k, mode="valid"), 0, p)
    return np.apply_along_axis(lambda v: np.convolve(v, k, mode="valid"), 1, p)


def signed_distance(px, py, poly):
    """점들(px, py)에서 다각형까지의 거리. 안쪽은 음수."""
    P = np.asarray(poly, float)
    d = np.full(px.shape, np.inf)
    inside = np.zeros(px.shape, bool)
    for i in range(len(P)):
        (ax, ay), (bx, by) = P[i], P[(i + 1) % len(P)]
        dx, dy = bx - ax, by - ay
        t = np.clip(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy or 1), 0, 1)
        d = np.minimum(d, np.hypot(px - ax - dx * t, py - ay - dy * t))
        cond = (ay > py) != (by > py)
        xint = (bx - ax) * (py - ay) / np.where(by - ay == 0, 1e-9, by - ay) + ax
        inside ^= cond & (px < xint)
    return np.where(inside, -d, d)


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def main():
    s = (ROOT / "campus-data.js").read_text(encoding="utf-8")
    data = json.loads(s[s.index("=") + 1:].rstrip().rstrip(";"))
    lat0, lon0 = data["origin"]["lat"], data["origin"]["lon"]
    kx, ky = 111_320 * math.cos(math.radians(lat0)), 110_540
    pts = [p for bd in data["boundaries"] for p in bd["pts"]]
    x0 = math.floor((min(p[0] for p in pts) - MARGIN) / STEP) * STEP
    y0 = math.floor((min(p[1] for p in pts) - MARGIN) / STEP) * STEP
    x1 = math.ceil((max(p[0] for p in pts) + MARGIN) / STEP) * STEP
    y1 = math.ceil((max(p[1] for p in pts) + MARGIN) / STEP) * STEP
    nx, ny = int((x1 - x0) / STEP) + 1, int((y1 - y0) / STEP) + 1
    gx, gy = np.meshgrid(x0 + np.arange(nx) * STEP, y0 + np.arange(ny) * STEP)   # [ny, nx], y 증가 = 북쪽

    # 1) DEM 창 읽기 + 쌍선형 보간
    lon = lon0 + gx / kx
    lat = lat0 + gy / ky
    col = (lon - DEM_LON0) / DEM_RES
    row = (DEM_LAT0 - lat) / DEM_RES
    r0, r1 = int(row.min()) - 2, int(row.max()) + 3
    c0, c1 = int(col.min()) - 2, int(col.max()) + 3
    dem = load_dem_window(r0, r1, c0, c1)
    rr, cc = row - r0, col - c0
    i0, j0 = np.floor(rr).astype(int), np.floor(cc).astype(int)
    fr, fc = rr - i0, cc - j0
    raw = (dem[i0, j0] * (1 - fr) * (1 - fc) + dem[i0, j0 + 1] * (1 - fr) * fc
           + dem[i0 + 1, j0] * fr * (1 - fc) + dem[i0 + 1, j0 + 1] * fr * fc)
    print(f"DEM window {dem.shape}, raw {raw.min():.1f}..{raw.max():.1f} m")

    # 2) 맨땅 추정(형태학적 열림) + 평활
    def minmax_filter(a, r, fn):
        from numpy.lib.stride_tricks import sliding_window_view as swv
        p = np.pad(a, r, mode="edge")
        p = fn(swv(p, 2 * r + 1, axis=0), axis=-1)
        return fn(swv(p, 2 * r + 1, axis=1), axis=-1)
    opened = minmax_filter(minmax_filter(raw, OPEN_R, np.min), OPEN_R, np.max)
    print(f"opening removed up to {float((raw - opened).max()):.1f} m (mean {float((raw - opened).mean()):.1f} m)")
    h = gaussian(opened, SMOOTH / STEP)

    # 3) 숲 수관 보정 — 실제로 나무가 있는 곳만 수관 높이만큼 낮춘다.
    #    위성영상(VWorld) 캐시가 있으면 짙은 녹색(수관) 비율로, 없으면 OSM 숲 + 캠퍼스 밖을 숲으로 본다.
    inside_campus = np.zeros(h.shape, bool)
    for bd in data["boundaries"]:
        inside_campus |= signed_distance(gx, gy, bd["pts"]) < 0
    forest = np.where(inside_campus, 0.0, 0.85)
    img_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else None
    if img_dir and (img_dir / "mosaic.jpg").exists():
        from PIL import Image
        Image.MAX_IMAGE_PIXELS = None
        tr = json.loads((img_dir / "transform.json").read_text())
        mos = np.asarray(Image.open(img_dir / "mosaic.jpg").convert("RGB")).astype(np.int16)
        r_, g_, b_ = mos[..., 0], mos[..., 1], mos[..., 2]
        lum = (r_ + g_ + b_) / 3
        tree = ((g_ > r_ + 6) & (g_ >= b_) & (lum < 92)).astype(np.float32)     # 짙은 녹색 = 수관 (밝은 잔디 제외)
        nz = 2 ** tr["z"]
        lat_g, lon_g = lat0 + gy / ky, lon0 + gx / kx
        px = (lon_g + 180) / 360 * nz * tr["tile"] - tr["ox"]
        py = (1 - np.log(np.tan(np.radians(lat_g)) + 1 / np.cos(np.radians(lat_g))) / np.pi) / 2 * nz * tr["tile"] - tr["oy"]
        ok = (px >= 0) & (py >= 0) & (px < mos.shape[1] - 1) & (py < mos.shape[0] - 1)
        # 4 m 칸마다 주변 픽셀 평균(영상 0.24 m/px → 약 17 px)
        from math import ceil
        k = 8
        integ = np.pad(tree, ((1, 0), (1, 0))).cumsum(0).cumsum(1)
        xi, yi = np.clip(px.astype(int), k, mos.shape[1] - k - 1), np.clip(py.astype(int), k, mos.shape[0] - k - 1)
        frac = (integ[yi + k, xi + k] - integ[yi - k, xi + k] - integ[yi + k, xi - k] + integ[yi - k, xi - k]) / (2 * k) ** 2
        forest = np.where(ok, frac, forest)
        print(f"canopy mask from imagery: mean {frac[ok].mean():.2f} inside coverage")
    else:
        for a in data["areas"]:
            if a["kind"] == "forest":
                forest = np.maximum(forest, (signed_distance(gx, gy, a["outer"]) < 0) * 0.9)
    forest = gaussian(forest, 14 / STEP)        # DSM 해상도(30 m)에 맞춰 퍼뜨림
    # 캠퍼스 안의 나무 무리는 열림 연산이 이미 깎았으므로, 넓은 숲(캠퍼스 밖 산)에만 적용
    outside = 1 - gaussian(inside_campus.astype(float), 30 / STEP)
    h = h - CANOPY * forest * outside

    base_field = h.copy()   # 평탄화 기준 높이를 잴 원래 지면

    # 4) 부지 평탄화 (넓은 것 → 좁은 것 순서로 덮어씀)
    def pad(poly, level, inner=1.5, ramp=12.0):
        P = np.asarray(poly)
        bx0, by0 = P.min(0) - inner - ramp - STEP
        bx1, by1 = P.max(0) + inner + ramp + STEP
        ix0, ix1 = max(0, int((bx0 - x0) / STEP)), min(nx, int((bx1 - x0) / STEP) + 2)
        iy0, iy1 = max(0, int((by0 - y0) / STEP)), min(ny, int((by1 - y0) / STEP) + 2)
        sub = (slice(iy0, iy1), slice(ix0, ix1))
        d = signed_distance(gx[sub], gy[sub], poly)
        w = 1 - smoothstep(inner, inner + ramp, d)
        h[sub] = h[sub] * (1 - w) + level * w

    def ground_level(poly, how):
        P = np.asarray(poly)
        ix0, ix1 = max(0, int((P[:, 0].min() - 30 - x0) / STEP)), min(nx, int((P[:, 0].max() + 30 - x0) / STEP) + 2)
        iy0, iy1 = max(0, int((P[:, 1].min() - 30 - y0) / STEP)), min(ny, int((P[:, 1].max() + 30 - y0) / STEP) + 2)
        sub = (slice(iy0, iy1), slice(ix0, ix1))
        d = signed_distance(gx[sub], gy[sub], poly)
        vals = base_field[sub]
        if how == "inside":
            v = vals[d < 0]
            return float(np.median(v)) if v.size else float(np.median(vals))
        ring = vals[(d > 6) & (d < 28)]          # 건물: 둘레 지면(수관·건물 높이가 덜 섞인 낮은 쪽)
        return float(np.median(ring)) if ring.size else float(np.median(vals))

    # 도로 정지: 차로를 따라 높이를 길게 평활한 종단면으로 맞춤 (실제 도로처럼 끊김 없이 완만하게)
    def grade_road(pts, width, window=36.0, ramp=8.0):
        P = np.asarray(pts, float)
        dense = [P[0]]
        for a, b in zip(P[:-1], P[1:]):
            n = max(1, int(np.hypot(*(b - a)) / 2))
            dense += [a + (b - a) * (k / n) for k in range(1, n + 1)]
        D = np.asarray(dense)
        if len(D) < 2:
            return
        prof = np.array([sample(x, y) for x, y in D])
        sig = window / 2 / 2.0                       # 2 m 간격 표본
        prof = gaussian(prof[None, :], sig)[0] if len(prof) > 3 else prof
        half = width / 2 + 1.5
        bx0, by0 = D.min(0) - half - ramp - STEP
        bx1, by1 = D.max(0) + half + ramp + STEP
        ix0, ix1 = max(0, int((bx0 - x0) / STEP)), min(nx, int((bx1 - x0) / STEP) + 2)
        iy0, iy1 = max(0, int((by0 - y0) / STEP)), min(ny, int((by1 - y0) / STEP) + 2)
        sub = (slice(iy0, iy1), slice(ix0, ix1))
        qx, qy = gx[sub][..., None], gy[sub][..., None]
        dd = np.hypot(qx - D[None, None, :, 0], qy - D[None, None, :, 1])
        nearest = dd.argmin(-1)
        dist = dd.min(-1)
        w = 1 - smoothstep(half, half + ramp, dist)
        h[sub] = h[sub] * (1 - w) + prof[nearest] * w

    def sample(x, y):
        fx, fy = (x - x0) / STEP, (y - y0) / STEP
        i, j = int(np.clip(fx, 0, nx - 2)), int(np.clip(fy, 0, ny - 2))
        tx, ty = np.clip(fx - i, 0, 1), np.clip(fy - j, 0, 1)
        return (h[j, i] * (1 - tx) + h[j, i + 1] * tx) * (1 - ty) + (h[j + 1, i] * (1 - tx) + h[j + 1, i + 1] * tx) * ty

    for r in sorted(data["roads"], key=lambda r: -r["width"]):
        if r["kind"] in ("unclassified", "service", "pedestrian") and len(r["pts"]) >= 2:
            grade_road(r["pts"], r["width"])
    base_field = h.copy()

    pads = []
    for a in data["areas"]:
        if a["kind"] in ("pitch", "parking", "playground"):
            pads.append((abs(polygon_area(a["outer"])), a["outer"], ground_level(a["outer"], "inside"), 8.0))
    # 건물 자리는 평탄화하지 않는다 — 경사지 건물은 자연 지형에 그대로 앉아 낮은 쪽은 기단 · 지하층이 드러나고
    # 높은 쪽은 땅에 묻힌다(렌더러가 건물 바닥을 발밑 지형의 중앙값에 두고 낮은 쪽을 기단으로 메움).
    st = data.get("statue") or {}
    if st.get("center"):
        cx, cy = st["center"]
        plaza = [[cx - 26, cy - 28], [cx + 26, cy - 28], [cx + 26, cy + 24], [cx - 26, cy + 24]]
        pads.append((1e9, plaza, ground_level(plaza, "inside"), 10.0))   # 광장은 가장 먼저(가장 넓게)
    pads.sort(key=lambda p: -p[0])
    for _, poly, level, ramp in pads:
        pad(poly, level, ramp=ramp)

    # 기준 높이: 본교 캠퍼스 안의 중앙값을 0 으로
    ref = float(np.median(h[inside_campus]))
    rel = h - ref
    enc = base64.b64encode(np.round(rel * 100).astype("<i2").tobytes()).decode()
    OUT.write_text(
        "// 자동 생성 파일 — scripts/build_terrain.py 로 다시 만드세요.\n"
        "// 고도: Copernicus GLO-30 DEM © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the European Union and ESA\n"
        "window.TERRAIN = " + json.dumps({"x0": x0, "y0": y0, "step": STEP, "nx": nx, "ny": ny, "ref": round(ref, 2),
                                          "h": enc}, separators=(",", ":")) + ";\n",
        encoding="utf-8")
    print(f"terrain {nx}x{ny} @ {STEP} m, ref {ref:.1f} m, relief {rel.min():.1f}..{rel.max():.1f} m "
          f"(campus {rel[inside_campus].min():.1f}..{rel[inside_campus].max():.1f}) -> {OUT.name}")


def polygon_area(pts):
    return sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1]
               for i in range(len(pts))) / 2


if __name__ == "__main__":
    main()

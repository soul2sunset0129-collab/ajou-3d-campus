"""OSM 원본(data/osm_raw.json: 본교 캠퍼스, data/osm_medical.json: 병원 부지)을
3D 뷰어용 로컬 좌표 데이터(campus-data.js)로 변환한다.

좌표계: 캠퍼스 경계 중심을 원점으로 x=동쪽(m), y=북쪽(m).
실행:  python scripts/process_osm.py
"""
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "osm_raw.json"
RAW_MEDICAL = ROOT / "data" / "osm_medical.json"
OUT = ROOT / "campus-data.js"

CAMPUS_WAY_ID = 477523965
HOSPITAL_WAY_ID = 297874790
FLOOR_HEIGHT = 3.8  # m, 대학 건물 평균 층고

# OSM에 층수가 없는 건물의 추정 층수. (실측 아님 — 화면에 "추정"으로 표시됨)
ESTIMATED_LEVELS = {
    "율곡관": 7,
    "체육관": 4,
    "제1학생회관": 4,
    "제2학생회관": 4,
    "원천정보관": 6,
    "국제학사": 10,
    "화공실험동": 2,
    "토목설계동": 2,
    "종합설계동": 2,
    "약학관": 6,
    "산학협력원": 7,
    "임상수기센터": 4,
    "혜강관": 6,
    "일신관": 12,
}
# 층 개념이 맞지 않는 구조물은 높이(m)를 직접 지정
FIXED_HEIGHT = {
    "노천극장": 1.5,
    "대형지반연구실험동": 9,
}

# OSM에는 university로 되어 있지만 실제로는 생활관(기숙사)인 건물
DORMITORIES = {"용지관", "화홍관", "광교관"}

ROAD_WIDTH = {
    "unclassified": 8, "service": 6, "pedestrian": 5,
    "footway": 2.5, "steps": 2.5, "path": 1.8,
}


def main():
    raw = json.loads(RAW.read_text(encoding="utf-8"))["elements"]
    seen = {(e["type"], e["id"]) for e in raw}
    medical_ids = set()
    if RAW_MEDICAL.exists():
        for e in json.loads(RAW_MEDICAL.read_text(encoding="utf-8"))["elements"]:
            if (e["type"], e["id"]) not in seen:
                raw.append(e)
                medical_ids.add(e["id"])
    campus = next(e for e in raw if e["id"] == CAMPUS_WAY_ID)
    hospital = next((e for e in raw if e["id"] == HOSPITAL_WAY_ID), None)
    b = campus["bounds"]
    lat0 = (b["minlat"] + b["maxlat"]) / 2
    lon0 = (b["minlon"] + b["maxlon"]) / 2
    kx = 111_320 * math.cos(math.radians(lat0))
    ky = 110_540

    def proj(pt):
        return [round((pt["lon"] - lon0) * kx, 2), round((pt["lat"] - lat0) * ky, 2)]

    def ring(geom):
        pts = [proj(p) for p in geom]
        if len(pts) > 1 and pts[0] == pts[-1]:
            pts.pop()
        return pts

    out = {
        "origin": {"lat": lat0, "lon": lon0},
        "boundary": ring(campus["geometry"]),
        "boundaries": [{"name": "아주대학교", "pts": ring(campus["geometry"])}]
        + ([{"name": "아주대학교병원", "pts": ring(hospital["geometry"])}] if hospital else []),
        "buildings": [], "areas": [], "roads": [], "pois": [],
    }

    for e in raw:
        t = e.get("tags", {})
        if e["id"] in (CAMPUS_WAY_ID, HOSPITAL_WAY_ID):
            continue

        if "building" in t:
            if e["type"] == "way":
                outers, inners = [ring(e["geometry"])], []
            elif e["type"] == "relation":
                outers = stitch([m["geometry"] for m in e["members"] if m["role"] == "outer"], ring)
                inners = stitch([m["geometry"] for m in e["members"] if m["role"] == "inner"], ring)
            else:
                continue
            name = t.get("name")
            estimated = False
            if name in FIXED_HEIGHT:
                height, levels = FIXED_HEIGHT[name], None
            else:
                levels = t.get("building:levels")
                if levels:
                    levels = int(float(levels))
                elif name in ESTIMATED_LEVELS:
                    levels, estimated = ESTIMATED_LEVELS[name], True
                else:
                    levels, estimated = (2 if name else 1), True
                height = float(t["height"]) if "height" in t else levels * FLOOR_HEIGHT
            for i, outer in enumerate(outers):
                out["buildings"].append({
                    "id": e["id"] if i == 0 else f"{e['id']}-{i}",
                    "campus": "medical" if e["id"] in medical_ids else "main",
                    "name": name,
                    "nameEn": t.get("name:en"),
                    "kind": "dormitory" if name in DORMITORIES else t.get("building"),
                    "levels": levels,
                    "estimated": estimated,
                    "height": round(height, 1),
                    "area": round(abs(polygon_area(outer)) - sum(abs(polygon_area(h)) for h in inners)),
                    "outer": outer,
                    "holes": inners if i == 0 else [],
                })
            continue

        if "highway" in t and e["type"] == "way":
            hw = t["highway"]
            if hw in ROAD_WIDTH:
                out["roads"].append({"kind": hw, "width": ROAD_WIDTH[hw],
                                     "pts": [proj(p) for p in e["geometry"]]})
            continue

        if e["type"] == "way":
            kind = (t.get("leisure") or t.get("landuse") or t.get("natural")
                    or ("parking" if t.get("amenity") == "parking" else None))
            if kind:
                out["areas"].append({"id": e["id"], "kind": kind, "sport": t.get("sport"),
                                     "name": t.get("name"), "outer": ring(e["geometry"])})
            continue

        if e["type"] == "node" and t.get("name"):
            out["pois"].append({"name": t["name"],
                                "kind": t.get("highway") or t.get("amenity") or "landmark",
                                "pos": proj(e)})

    apply_research(out)
    out["buildings"] = [b for b in out["buildings"] if not b.get("remove")]
    out["buildings"].sort(key=lambda x: (x["name"] is None, x["name"] or ""))
    OUT.write_text(
        "// 자동 생성 파일 — scripts/process_osm.py 로 다시 만드세요.\n"
        "// 데이터 출처: © OpenStreetMap contributors (ODbL)\n"
        "window.CAMPUS_DATA = " + json.dumps(out, ensure_ascii=False, separators=(",", ":")) + ";\n",
        encoding="utf-8",
    )
    print(f"buildings={len(out['buildings'])} areas={len(out['areas'])} "
          f"roads={len(out['roads'])} pois={len(out['pois'])} -> {OUT.name}")


# ---------------------------------------------------------------------------
# 조사 결과 병합 (scripts/merge_research.py 가 만드는 data/*.json)
#   data/buildings_research.json : {osm id: 검증된 건물 기록}
#   data/extra_buildings.json    : OSM에 없는 아주대 건물 [{name, polygon, floors_above, ...}]
#   data/campus_features.json    : 운동장 표면, 선구자상 방향, 가로수길 등
#   data/roof_colors.json        : 위성영상에서 잰 지붕 색 (scripts/analyze_imagery.py)
#   data/official_buildings.json : 아주대 공식 캠퍼스맵 (scripts/fetch_official.py)
#   data/visual_analysis.json    : 공식 사진 + 위성영상 판독 결과(외관 · 부분 높이 · 외곽 보정)
#   data/campus_manual.json      : 직접 판독한 OSM 밖 공식 건물 · 교문
#   data/user_overrides.json     : 사용자가 직접 알려준 사실 — 조사 결과보다 우선
# 우선순위: OSM < 공식 캠퍼스맵 < 사진·영상 판독 < 정밀 조사 < 사용자 제보
# ---------------------------------------------------------------------------
DEFAULT_FLOOR_H = {"hospital": 4.2, "dormitory": 3.1}


def load_json(name, default):
    f = ROOT / "data" / name
    return json.loads(f.read_text(encoding="utf-8")) if f.exists() else default


def is_hex(v):
    return isinstance(v, str) and len(v.strip()) == 7 and v.strip().startswith("#")


def point_in_poly(pt, poly):
    x, y = pt
    inside = False
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def facade_from(r):
    wall, win, base = r.get("wall") or {}, r.get("windows") or {}, r.get("base") or {}
    f = {
        "wall": wall.get("primary_hex"), "wallMat": wall.get("primary_material"),
        "wall2": wall.get("secondary_hex"), "wall2Where": wall.get("secondary_where"),
        "glass": win.get("glass_hex"), "frame": win.get("frame_hex"), "style": win.get("style"),
        "winRatio": win.get("window_height_ratio"), "bay": win.get("bay_width_m"),
    }
    if base.get("floors") and is_hex(base.get("hex")):
        f["base"] = {"material": base.get("material", ""), "hex": base["hex"], "floors": int(round(base["floors"]))}
    return {k: v for k, v in f.items() if v not in (None, "")}


def apply_record(b, r, roof_hex):
    kind = b.get("kind")
    fa = r.get("floors_above")
    if fa:
        b["levels"] = int(fa)
    if r.get("floors_below"):
        b["basement"] = int(r["floors_below"])
    levels = b.get("levels") or 1
    fh = r.get("typical_floor_height_m")
    if not fh and r.get("height_m") and fa:
        fh = r["height_m"] / fa
    fh = min(5.5, max(2.8, fh or DEFAULT_FLOOR_H.get(kind, 3.8)))
    b["floorH"] = round(fh, 2)
    if b.get("osmName", b["name"]) not in FIXED_HEIGHT:
        b["height"] = round(r.get("height_m") or levels * fh, 1)
    base_floors = r.get("base_floors") or levels
    b["baseHeight"] = b["height"] if base_floors >= levels else round(base_floors * fh, 1)

    outline = r.get("corrected_outline") or []
    if len(outline) >= 4 and (r.get("confidence") or {}).get("outline") in ("medium", "high"):
        new_area = abs(polygon_area(outline))
        if 0.4 < new_area / max(b["area"], 1) < 2.5:
            b["holes"] = [h for h in b["holes"] if all(point_in_poly(p, outline) for p in h)]
            b["outer"] = [[round(x, 2), round(y, 2)] for x, y in outline]
            b["area"] = round(new_area - sum(abs(polygon_area(h)) for h in b["holes"]))
            b["outlineCorrected"] = True
    parts = []
    for p in r.get("parts") or []:
        poly = p.get("polygon") or []
        if len(poly) < 3 or not p.get("floors"):
            continue
        # 경계 위 꼭짓점도 통과하도록 중심 쪽으로 15% 당겨서 판정
        cx = sum(x for x, _ in poly) / len(poly)
        cy = sum(y for _, y in poly) / len(poly)
        inside = sum(point_in_poly((x + (cx - x) * 0.15, y + (cy - y) * 0.15), b["outer"]) for x, y in poly) / len(poly)
        if inside < 0.5:
            continue
        part = {"label": p.get("label", ""), "floors": int(p["floors"]),
                "height": round(p.get("height_m") or p["floors"] * fh, 1),
                "polygon": [[round(x, 2), round(y, 2)] for x, y in poly]}
        pf = {"wall": p.get("wall_hex"), "wallMat": p.get("wall_material"), "style": p.get("window_style"),
              "glass": p.get("glass_hex"), "winRatio": p.get("window_height_ratio")}
        pf = {k: v for k, v in pf.items() if v not in (None, "")}
        if pf:
            part["facade"] = pf
        if p.get("roof_shape") in ("gable", "vault"):
            part["roofShape"] = p["roof_shape"]
            if p.get("roof_axis_deg") is not None:
                part["roofAxisDeg"] = p["roof_axis_deg"]
        parts.append(part)
    b["parts"] = parts
    roof_info = r.get("roof") or {}
    if roof_info.get("shape") in ("gable", "vault"):
        b["roofShape"] = roof_info["shape"]
    b["facade"] = facade_from(r)
    if roof_hex:
        b["roofHex"] = roof_hex
    elif is_hex((r.get("roof") or {}).get("hex")):
        b["roofHex"] = r["roof"]["hex"]
    conf = r.get("confidence") or {}
    b["confidence"] = conf
    b["estimated"] = conf.get("floors") == "low"
    if r.get("uses"):
        b["uses"] = r["uses"]
    if r.get("year_completed"):
        b["year"] = r["year_completed"]
    if r.get("floors_basis"):
        b["floorsBasis"] = r["floors_basis"]
    if not b["name"] and r.get("identified_as"):
        b["identifiedAs"] = r["identified_as"]
    srcs, seen = [], set()
    for ev in r.get("floors_evidence") or []:
        url = (ev.get("source") or "").strip()
        if url.startswith("http") and url not in seen:
            seen.add(url)
            srcs.append({"url": url, "label": (ev.get("value") or "")[:40]})
    b["sources"] = srcs[:6]


def apply_research(out):
    research = load_json("buildings_research.json", {})
    overrides = load_json("user_overrides.json", {})
    official = load_json("official_buildings.json", {})
    visual = load_json("visual_analysis.json", {})
    roof = load_json("roof_colors.json", {})
    for b in out["buildings"]:
        bid = str(b["id"])
        b["osmName"] = b["name"]
        r = None
        off = official.get(bid)
        if off:
            b["name"] = off["name"]
            b["nameEn"] = off.get("nameEn") or b.get("nameEn")
            b["official"] = {"buildNo": off["buildNo"], "summary": off.get("summary"), "floorGuide": off.get("floor_guide"),
                             "photo": off.get("photo"), "source": off.get("source")}
            r = {"floors_evidence": [{"value": "공식 캠퍼스맵", "source": off["source"]}],
                 "confidence": {"floors": "high" if off.get("floors_agree") else "medium"}}
            if off.get("floors_above"):
                r["floors_above"] = off["floors_above"]
                r["floors_basis"] = "아주대 공식 캠퍼스맵 건물 안내" + ("" if off.get("floors_agree") else " (본문과 층별 목록이 달라 큰 값 사용)")
            if off.get("floors_below"):
                r["floors_below"] = off["floors_below"]
            if off.get("year"):
                r["year_completed"] = off["year"]
        vis = visual.get(bid)
        if vis:
            ev = (r or {}).get("floors_evidence", [])
            r = {**(r or {}), **vis, "floors_evidence": ev}
        res = research.get(bid)
        if res:
            ev = (r or {}).get("floors_evidence", []) + (res.get("floors_evidence") or [])
            r = {**(r or {}), **res, "floors_evidence": ev}
            if res.get("official_name") and not off:
                b["name"] = res["official_name"]
        o = overrides.get(bid)
        if o:
            r = {**(r or {}), **{k: v for k, v in o.items() if k != "name"}}
        roof_hex = (roof.get(str(b["id"])) or {}).get("hex")
        if r and r.get("remove"):
            b["remove"] = True
            continue
        if r:
            apply_record(b, r, roof_hex)
        elif roof_hex:
            b["roofHex"] = roof_hex

    manual = load_json("campus_manual.json", {})
    extras = load_json("extra_buildings.json", []) + manual.get("extra_buildings", [])
    if manual.get("gates"):
        out["gates"] = manual["gates"]
    if manual.get("statue"):
        out["statue"] = manual["statue"]
    for i, x in enumerate(extras):
        poly = x.get("polygon") or []
        if len(poly) < 3:
            continue
        b = {"id": f"extra-{i}", "campus": x.get("campus", "main"), "name": x.get("name"), "nameEn": None,
             "kind": x.get("kind", "university"), "levels": x.get("floors_above") or 2,
             "estimated": not x.get("floors_above"), "height": 0, "area": round(abs(polygon_area(poly))),
             "outer": [[round(a, 2), round(c, 2)] for a, c in poly], "holes": [], "extra": True}
        rec = {k: x.get(k) for k in ("floors_above", "floors_below", "height_m", "uses", "year_completed", "typical_floor_height_m",
                                     "floors_basis", "floors_evidence", "wall", "windows", "base", "roof", "confidence")}
        rec["confidence"] = rec.get("confidence") or {"floors": "medium" if x.get("floors_above") else "low"}
        apply_record(b, rec, x.get("roof_hex") if is_hex(x.get("roof_hex")) else None)
        out["buildings"].append(b)

    feats = load_json("campus_features.json", {})
    if feats.get("fields"):
        out["fields"] = feats["fields"]
    if feats.get("statue") and "statue" not in out:
        out["statue"] = feats["statue"]
    if feats.get("avenues"):
        out["avenues"] = feats["avenues"]
    if feats.get("features"):
        out["features"] = feats["features"]


def stitch(ways, ring):
    """멀티폴리곤 멤버 way들을 끝점끼리 이어 닫힌 링으로 만든다."""
    segs = [list(w) for w in ways if w]
    rings = []
    while segs:
        cur = segs.pop(0)
        key = lambda p: (p["lat"], p["lon"])
        while key(cur[0]) != key(cur[-1]):
            for i, s in enumerate(segs):
                if key(s[0]) == key(cur[-1]):
                    cur += s[1:]
                elif key(s[-1]) == key(cur[-1]):
                    cur += s[::-1][1:]
                else:
                    continue
                segs.pop(i)
                break
            else:
                break  # 닫히지 않는 링 — 있는 그대로 사용
        rings.append(ring(cur))
    return rings


def polygon_area(pts):
    return sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1]
               for i in range(len(pts))) / 2


if __name__ == "__main__":
    main()

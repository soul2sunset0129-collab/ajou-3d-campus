"""조사 워크플로 저널(journal.jsonl)에서 결과를 뽑아 data/*.json 으로 저장한다.

  data/buildings_research.json : {osm id: 검증 기록}  (verify 결과 우선, 없으면 research 결과)
  data/extra_buildings.json    : OSM에 없는 아주대 건물 (인벤토리 감사 결과)
  data/campus_features.json    : 운동장 표면, 선구자상 방향, 가로수길, 기타 시설물
  data/research_sources.json   : 캠퍼스 전체 조사에서 찾은 출처 목록
  reference-photos/credits.json: 새로 받은 자유 라이선스 사진 출처 추가

실행:  python scripts/merge_research.py <journal.jsonl> [<journal2.jsonl> ...]
그다음 python scripts/process_osm.py 로 campus-data.js 를 다시 만든다.
"""
import json
import math
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"


def read_journals(paths):
    labels, results = {}, {}
    for p in paths:
        for line in Path(p).read_text(encoding="utf-8").splitlines():
            e = json.loads(line)
            if e["type"] == "started":
                labels[e["key"]] = e.get("label", "")
            elif e["type"] == "result" and e.get("result") is not None:
                results[labels.get(e["key"], e["key"])] = e["result"]   # 나중 실행이 앞선 결과를 덮어씀
    return results


def load_campus():
    s = (ROOT / "campus-data.js").read_text(encoding="utf-8")
    return json.loads(s[s.index("=") + 1:].rstrip().rstrip(";"))


def centroid(pts):
    return [sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)]


def point_in_poly(pt, poly):
    x, y = pt
    inside, j = False, len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


SURFACE = [
    (r"인조|artificial|synthetic|turf", "turf"),
    (r"흙|마사|dirt|sand|clay|gravel", "sand"),
    (r"우레탄|urethane|polyurethane|hard|아스팔트|asphalt|acrylic", "hardcourt"),
    (r"천연|natural grass|잔디|grass", "pitch"),
]
SPECIES = [
    (r"벚|cherry|sakura", "cherry"), (r"은행|ginkgo", "ginkgo"), (r"단풍|maple", "maple"),
    (r"소나무|pine", "pine"), (r"메타|metasequoia|dawn redwood", "metasequoia"),
    (r"느티|zelkova|plane|플라타너스|이팝|oak|참나무", "broadleaf"),
]


def classify(text, table):
    t = (text or "").lower()
    for pat, val in table:
        if re.search(pat, t):
            return val
    return None


def main(paths):
    results = read_journals(paths)
    campus = load_campus()
    known_ids = {str(b["id"]) for b in campus["buildings"]}

    # 1) 건물별 기록 (verify > research)
    research = {}
    rank = {"research": 0, "verify": 1, "bldg": 2}   # 나중 단계/새 워크플로 결과 우선
    for label, r in results.items():
        if not isinstance(r, dict) or "id" not in r:
            continue
        kind = label.split(":", 1)[0]
        bid = str(r["id"])
        if bid not in known_ids or kind not in rank:
            continue
        if bid not in research or rank[kind] >= rank[research[bid]["_stage"]]:
            research[bid] = {**r, "_stage": kind}
    (DATA / "buildings_research.json").write_text(json.dumps(research, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"buildings_research: {len(research)} (" + ", ".join(f"{k} {sum(1 for r in research.values() if r['_stage'] == k)}" for k in rank) + ")")

    # 2) OSM에 없는 건물 (v2: campus:extras, v1: sweep:missing)
    ex2 = results.get("campus:extras") or {}
    missing = ex2.get("buildings") or (results.get("sweep:missing") or {}).get("missing", [])
    extra = []
    for m in missing:
        poly = m.get("polygon") or []
        if not m.get("is_ajou") or m.get("status") != "existing" or len(poly) < 4:
            continue
        if m.get("wall_hex") and not m.get("wall"):
            m["wall"] = {"primary_hex": m["wall_hex"], "primary_material": m.get("wall_material", "")}
        if m.get("window_style") and not m.get("windows"):
            m["windows"] = {"style": m["window_style"], "glass_hex": m.get("glass_hex")}
        c = centroid(poly)
        if any(point_in_poly(c, b["outer"]) for b in campus["buildings"]):
            continue   # 이미 있는 건물과 겹침
        extra.append({
            "name": m.get("name"), "campus": m.get("campus", "main"), "polygon": poly,
            "floors_above": m.get("floors_above"), "floors_below": m.get("floors_below"),
            "roof_hex": m.get("roof_hex"), "height_m": m.get("height_m"), "kind": m.get("kind") or "university",
            "wall": m.get("wall"), "windows": m.get("windows"),
            "floors_basis": m.get("description") or m.get("notes"),
            "floors_evidence": [{"value": str(m.get("floors_above", "")), "source": u}
                                for u in (m.get("evidence_urls") or m.get("evidence") or []) if str(u).startswith("http")],
            "confidence": {"floors": "medium" if m.get("floors_above") else "low"},
        })
    (DATA / "extra_buildings.json").write_text(json.dumps(extra, ensure_ascii=False, indent=1), encoding="utf-8")
    osm_issues = ex2.get("osm_outline_issues") or (results.get("sweep:missing") or {}).get("osm_issues", [])
    print(f"extra_buildings: {len(extra)} / missing reported {len(missing)}, osm issues {len(osm_issues)}")

    # 3) 시설물 · 운동장 · 동상 · 가로수길
    feats = results.get("campus:features") or results.get("sweep:features") or {}
    pitches = [a for a in campus["areas"] if a["kind"] == "pitch"]
    fields = []
    for f in feats.get("fields", []):
        surf = classify(f.get("surface"), SURFACE)
        c = f.get("center")
        if not surf or not c or len(c) < 2:
            continue
        best = min(pitches, key=lambda a: math.dist(centroid(a["outer"]), c), default=None)
        if best and math.dist(centroid(best["outer"]), c) < 60:
            fields.append({"id": best["id"], "surface": surf, "name": f.get("name"), "note": f.get("notes")})
    avenues = []
    for a in feats.get("tree_avenues", []):
        sp = classify(a.get("species"), SPECIES)
        pts = a.get("polyline") or []
        if sp and len(pts) >= 2:
            avenues.append({"species": sp, "label": a.get("species"), "where": a.get("where"), "pts": pts})
    out = {"fields": fields, "avenues": avenues, "statue": feats.get("statue"), "gates": ex2.get("gates", []),
           "features": feats.get("features", []), "ground_surfaces": feats.get("ground_surfaces", []),
           "osm_issues": osm_issues, "notes": feats.get("notes")}
    (DATA / "campus_features.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"campus_features: fields {len(fields)}, avenues {len(avenues)}, statue {'yes' if out['statue'] else 'no'}")

    # 4) 출처 목록
    sources = {k.split(':', 1)[1]: v for k, v in results.items() if k.startswith("sweep:") and isinstance(v, dict)}
    (DATA / "research_sources.json").write_text(json.dumps(sources, ensure_ascii=False, indent=1), encoding="utf-8")

    # 5) 새 사진 출처
    photos = (results.get("sweep:photos") or {}).get("downloaded", [])
    cred_path = ROOT / "reference-photos" / "credits.json"
    credits = json.loads(cred_path.read_text(encoding="utf-8")) if cred_path.exists() else []
    have = {c["file"] for c in credits}
    added = 0
    for ph in photos:
        fname = Path(ph["file"]).name
        if fname in have or not (ROOT / "reference-photos" / fname).exists():
            continue
        credits.append({"file": fname, "title": ph.get("title"), "source": ph.get("source"), "license": ph.get("license"),
                        "author": ph.get("author"), "date": ph.get("date"), "description": ph.get("depicts")})
        added += 1
    cred_path.write_text(json.dumps(credits, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"photos: +{added} credits")


if __name__ == "__main__":
    main(sys.argv[1:])

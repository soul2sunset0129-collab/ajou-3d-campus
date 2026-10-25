// 건물 부분 파괴: 처음 맞은 건물을 "층 × 평면 격자 칸"으로 나누고(외곽선을 따라 정확히 잘라냄),
// 폭탄이 맞은 층 · 범위의 칸만 없앤다. 받칠 곳이 없어진 위층 칸은 함께 떨어진다.
//  - 바깥 면은 원래 외벽 텍스처, 잘린 단면은 콘크리트, 칸 위 · 아래는 바닥 슬래브(맨 위층은 지붕)
import * as THREE from 'three';

const EPS = 1e-6;
const concrete = new THREE.MeshStandardMaterial({ color: 0x7d7973, roughness: 1 });        // 잘린 단면
const slab = new THREE.MeshStandardMaterial({ color: 0xa29e96, roughness: 0.95 });          // 층 바닥 · 천장

function polyArea(p) {
  let a = 0;
  for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; }
  return a / 2;
}
function pointInPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function distToPoly(x, y, pts) {
  if (pointInPoly(x, y, pts)) return 0;
  let d = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
    d = Math.min(d, Math.hypot(x - ax - dx * t, y - ay - dy * t));
  }
  return d;
}

/** 다각형을 축 정렬 사각형으로 자름 (Sutherland–Hodgman). 각 변이 원래 외곽(true)인지 잘린 면(false)인지도 돌려줌 */
function clipToCell(poly, x0, y0, x1, y1) {
  let out = poly;
  const sides = [(p) => p[0] - x0, (p) => x1 - p[0], (p) => p[1] - y0, (p) => y1 - p[1]];
  for (const f of sides) {
    const inp = out;
    out = [];
    for (let i = 0; i < inp.length; i++) {
      const a = inp[i], b = inp[(i + 1) % inp.length], fa = f(a), fb = f(b);
      if (fa >= 0) out.push(a);
      if ((fa >= 0) !== (fb >= 0)) { const t = fa / (fa - fb); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
    }
    if (!out.length) return null;
  }
  if (Math.abs(polyArea(out)) < 0.3) return null;
  if (polyArea(out) < 0) out.reverse();   // 반시계 방향으로
  const tol = 1e-4;
  const onSide = (a, b) => (Math.abs(a[0] - x0) < tol && Math.abs(b[0] - x0) < tol) || (Math.abs(a[0] - x1) < tol && Math.abs(b[0] - x1) < tol)
    || (Math.abs(a[1] - y0) < tol && Math.abs(b[1] - y0) < tol) || (Math.abs(a[1] - y1) < tol && Math.abs(b[1] - y1) < tol);
  const ext = out.map((a, i) => !onSide(a, out[(i + 1) % out.length]));
  return { pts: out, ext };
}

// 칸 하나(한 층)의 기하를 재질별 버킷에 쌓음: 0 외벽, 1 단면, 2 지붕, 3 슬래브
function pushCell(B, cell, y0, y1, topIsRoof) {
  const P = cell.pts, n = P.length, h = y1 - y0;
  const add = (k, p, nrm, uv) => { B[k].pos.push(p[0], p[1], p[2]); B[k].nrm.push(nrm[0], nrm[1], nrm[2]); B[k].uv.push(uv[0], uv[1]); };
  for (let i = 0; i < n; i++) {
    const a = P[i], b = P[(i + 1) % n];
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
    if (len < EPS) continue;
    const nrm = [dy / len, 0, dx / len];               // 바깥쪽 법선 (데이터 (dy,-dx) → 월드 z = -북)
    const k = cell.ext[i] ? 0 : 1;
    // 외벽 UV 는 three.js ExtrudeGeometry(WorldUVGenerator)와 같은 규칙: u = 긴 축 좌표, v = 1 - 층 안 높이
    const useX = Math.abs(dx) > Math.abs(dy);
    const ua = k === 0 ? (useX ? a[0] : a[1]) : 0, ub = k === 0 ? (useX ? b[0] : b[1]) : len;
    const A0 = [a[0], y0, -a[1]], B0 = [b[0], y0, -b[1]], B1 = [b[0], y1, -b[1]], A1 = [a[0], y1, -a[1]];
    const v0 = 1, v1 = 1 - h;
    add(k, A0, nrm, [ua, v0]); add(k, B0, nrm, [ub, v0]); add(k, B1, nrm, [ub, v1]);
    add(k, A0, nrm, [ua, v0]); add(k, B1, nrm, [ub, v1]); add(k, A1, nrm, [ua, v1]);
  }
  const tris = THREE.ShapeUtils.triangulateShape(P.map((p) => new THREE.Vector2(p[0], p[1])), []);
  const kt = topIsRoof ? 2 : 3;
  for (const [i, j, l] of tris) {
    for (const q of [P[i], P[j], P[l]]) add(kt, [q[0], y1, -q[1]], [0, 1, 0], [q[0], q[1]]);
    for (const q of [P[i], P[l], P[j]]) add(3, [q[0], y0, -q[1]], [0, -1, 0], [q[0], q[1]]);
  }
}

function buildGeometry(cells, alive, y0, y1, topIsRoof) {
  const B = [0, 1, 2, 3].map(() => ({ pos: [], nrm: [], uv: [] }));
  cells.forEach((c, i) => { if (alive[i]) pushCell(B, c, y0, y1, topIsRoof); });
  const geo = new THREE.BufferGeometry();
  const pos = [], nrm = [], uv = [];
  let start = 0;
  B.forEach((b, k) => {
    pos.push(...b.pos); nrm.push(...b.nrm); uv.push(...b.uv);
    const count = b.pos.length / 3;
    if (count) geo.addGroup(start, count, k);
    start += count;
  });
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeBoundingSphere();
  return geo;
}

export function createFracture({ scene }) {
  const pickable = [];

  /** 건물을 칸으로 나눔 (처음 맞을 때 한 번) */
  function voxelize(bd) {
    if (bd.frac) return bd.frac;
    const xs = bd.outer.map((p) => p[0]), ys = bd.outer.map((p) => p[1]);
    const s = Math.min(6, Math.max(2.5, Math.sqrt(bd.area) / 10));   // 칸 크기: 다산관 ≈ 4.4 m → 한 층 약 100칸
    const ox = Math.min(...xs) - s * 0.37, oy = Math.min(...ys) - s * 0.37;   // 격자선이 외곽선과 겹치지 않게 살짝 밀기
    const masses = (bd.masses ?? []).map((m) => {
      const mx = m.outer.map((p) => p[0]), my = m.outer.map((p) => p[1]);
      const cells = [];
      for (let i = Math.floor((Math.min(...mx) - ox) / s); i * s + ox < Math.max(...mx); i++) {
        for (let j = Math.floor((Math.min(...my) - oy) / s); j * s + oy < Math.max(...my); j++) {
          const c = clipToCell(m.outer, ox + i * s, oy + j * s, ox + (i + 1) * s, oy + (j + 1) * s);
          if (!c) continue;
          const cx = c.pts.reduce((a, p) => a + p[0], 0) / c.pts.length, cy = c.pts.reduce((a, p) => a + p[1], 0) / c.pts.length;
          if ((m.holes ?? []).some((hole) => pointInPoly(cx, cy, hole))) continue;
          cells.push({ ...c, i, j, cx, cy, area: Math.abs(polyArea(c.pts)) });
        }
      }
      const floors = Math.max(1, Math.round(m.h / m.floorH));
      const fh = m.h / floors;
      const index = new Map(cells.map((c, k) => [`${c.i},${c.j}`, k]));
      const alive = Array.from({ length: floors }, () => new Uint8Array(cells.length).fill(1));
      // 층마다 외벽 재질(같은 외벽 텍스처를 그 층 높이에 맞춰 씀) · 지붕 재질
      const wallMats = Array.from({ length: floors }, (_, f) => new THREE.MeshStandardMaterial({
        ...m.tex(m.yRel + f * fh), emissive: 0xffffff, emissiveIntensity: m.wall?.emissiveIntensity ?? 0, roughness: 0.75,
      }));
      const roofMat = new THREE.MeshStandardMaterial({ color: m.roofColor, roughness: 0.95 });
      const meshes = Array.from({ length: floors }, (_, f) => {
        const mesh = new THREE.Mesh(buildGeometry(cells, alive[f], m.yBase + f * fh, m.yBase + (f + 1) * fh, f === floors - 1),
          [wallMats[f], concrete, roofMat, slab]);
        mesh.castShadow = mesh.receiveShadow = true;
        mesh.userData.b = bd;
        scene.add(mesh);
        pickable.push(mesh);
        return mesh;
      });
      m.mesh.visible = false;
      if (m.edges) m.edges.visible = false;
      return { m, cells, index, floors, fh, alive, meshes, dirty: new Set() };
    });
    if (bd.roofUnits) bd.roofUnits.visible = false;
    const total = masses.reduce((a, M) => a + M.cells.length * M.floors, 0);
    bd.frac = { masses, total, removed: 0, s, ox, oy };
    return bd.frac;
  }

  /**
   * 폭발 피해. 위층부터 한 층씩 부서진다: 맞은 점 근처 기둥(같은 격자 칸의 층 더미)마다
   * 남아 있는 맨 위 칸부터 floorsCount 층(소형 1, 대형 2)을 없앤다. 같은 곳을 또 맞히면 그 아래층이 부서짐.
   * share = 맞은 덩어리 한 층 면적 중 부서질 비율(소형 0.1, 대형 0.2) — 가까운 기둥부터 면적을 더해 채움.
   * @returns 없앤 칸 목록 [{x, y, z, fell}]
   */
  function blast(bd, hit, floorsCount, { share = 0.1, rMax = 18 } = {}) {
    const F = voxelize(bd);
    const hx = hit.x, hy = -hit.z;
    const out = [];
    // 기둥: 격자 (i,j) 마다 아래 → 위 순서로 [덩어리, 칸] (기단 위에 얹힌 덩어리는 기단 위에 쌓임)
    const cols = new Map();
    for (const M of [...F.masses].sort((a, b) => a.m.yBase - b.m.yBase)) {
      M.cells.forEach((c, k) => {
        const key = `${c.i},${c.j}`;
        if (!cols.has(key)) cols.set(key, { cx: c.cx, cy: c.cy, area: c.area, stack: [] });
        for (let f = 0; f < M.floors; f++) cols.get(key).stack.push([M, f, k]);
      });
    }
    // 목표 면적: 맞은 점이 있는(없으면 가장 가까운) 덩어리 한 층 면적 × share
    const hitM = F.masses.reduce((best, M) => {
      const d = distToPoly(hx, hy, M.m.outer) - (M.m.yBase + M.m.h) * 1e-3;   // 겹치면 위에 얹힌 덩어리
      return d < best.d ? { M, d } : best;
    }, { M: F.masses[0], d: Infinity }).M;
    const target = share * hitM.cells.reduce((a, c) => a + c.area, 0);
    const order = [...cols.values()]
      .filter((col) => col.stack.some(([M, f, k]) => M.alive[f][k]))
      .map((col) => [Math.hypot(col.cx - hx, col.cy - hy), col])
      .sort((a, b) => a[0] - b[0]);
    let acc = 0;
    for (const [dist, col] of order) {
      if (acc >= target || (acc > 0 && dist > rMax)) break;
      acc += col.area;
      let n = 0;
      for (let t = col.stack.length - 1; t >= 0 && n < floorsCount; t--) {
        const [M, f, k] = col.stack[t];
        if (!M.alive[f][k]) continue;
        kill(M, f, k, out, false);
        n++;
      }
    }
    settle(F, out);
    for (const M of F.masses) for (const f of M.dirty) rebuild(M, f);
    for (const M of F.masses) M.dirty.clear();
    // 맨 위층이 뚫리면 경사 지붕(체육관 아치 등)은 날아감
    for (const M of F.masses) {
      if (M.m.extra?.length && M.alive[M.floors - 1].some((v) => !v)) for (const e of M.m.extra) e.visible = false;
    }
    return out;
  }

  function kill(M, f, k, out, fell) {
    M.alive[f][k] = 0;
    M.dirty.add(f);
    const c = M.cells[k];
    out.push({ x: c.cx, y: c.cy, z: M.m.yBase + (f + 0.5) * M.fh, fell, floor: f });
  }

  // 받칠 곳이 없는 칸은 떨어짐: 바로 아래 칸이 있거나, 같은 층의 이웃 2칸 이상이 받쳐 주면(외팔보) 버팀
  function settle(F, out) {
    const base = F.masses[0];
    for (const M of F.masses) {
      for (let f = 0; f < M.floors; f++) {
        const sup = new Uint8Array(M.cells.length);
        M.cells.forEach((c, k) => {
          if (!M.alive[f][k]) return;
          if (f > 0) sup[k] = M.alive[f - 1][k];
          else if (M === base) sup[k] = 1;                                   // 기단 1층은 땅이 받침
          else { const bk = base.index.get(`${c.i},${c.j}`); sup[k] = bk === undefined ? 1 : base.alive[base.floors - 1][bk]; }
        });
        for (let pass = 0; pass < 3; pass++) {
          M.cells.forEach((c, k) => {
            if (!M.alive[f][k] || sup[k]) return;
            let n = 0;
            for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
              const nk = M.index.get(`${c.i + di},${c.j + dj}`);
              if (nk !== undefined && sup[nk]) n++;
            }
            if (n >= 2) sup[k] = 1;
          });
        }
        M.cells.forEach((c, k) => { if (M.alive[f][k] && !sup[k]) kill(M, f, k, out, true); });
      }
    }
    F.removed = F.masses.reduce((a, M) => a + M.alive.reduce((b, row) => b + row.reduce((s2, v) => s2 + (v ? 0 : 1), 0), 0), 0);
  }

  function rebuild(M, f) {
    const mesh = M.meshes[f];
    mesh.geometry.dispose();
    mesh.geometry = buildGeometry(M.cells, M.alive[f], M.m.yBase + f * M.fh, M.m.yBase + (f + 1) * M.fh, f === M.floors - 1);
  }

  /** (x,y) 기둥에 남아 있는 맨 위 높이 — 폭탄이 위층부터 맞도록. 칸이 없으면 null */
  function topAt(bd, x, y) {
    const F = voxelize(bd);
    let best = null;
    for (const M of F.masses) {
      const i = Math.floor((x - F.ox) / F.s), j = Math.floor((y - F.oy) / F.s);
      const k = M.index.get(`${i},${j}`);
      if (k === undefined) continue;
      for (let f = M.floors - 1; f >= 0; f--) {
        if (M.alive[f][k]) { best = Math.max(best ?? -Infinity, M.m.yBase + (f + 1) * M.fh); break; }
      }
    }
    return best;
  }

  const fraction = (bd) => (bd.frac ? bd.frac.removed / Math.max(1, bd.frac.total) : 0);
  const meshesOf = (bd) => (bd.frac ? bd.frac.masses.flatMap((M) => [...M.meshes, ...(M.m.extra ?? [])]) : bd.meshes);

  /** 원래 건물로 되돌림 */
  function restore(bd) {
    if (!bd.frac) return;
    for (const M of bd.frac.masses) {
      for (const mesh of M.meshes) {
        scene.remove(mesh);
        mesh.geometry.dispose();
        const i = pickable.indexOf(mesh);
        if (i >= 0) pickable.splice(i, 1);
      }
      M.m.mesh.visible = true;
      for (const e of M.m.extra ?? []) e.visible = true;
    }
    if (bd.roofUnits) bd.roofUnits.visible = true;
    bd.frac = null;
  }

  function setNight(on) {
    for (const mesh of pickable) mesh.material[0].emissiveIntensity = on ? 1 : 0;
  }

  return { voxelize, blast, topAt, restore, fraction, meshesOf, pickable, setNight };
}

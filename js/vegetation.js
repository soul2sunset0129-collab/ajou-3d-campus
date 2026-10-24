// 나무: 수집한 사진의 수종을 저폴리 형태로 재현하고 InstancedMesh 로 수천 그루를 배치한다.
//  - 소나무(02·06 선구자상 주변), 벚나무(04 도서관 앞 가로수, 06), 은행나무(01 운동장 옆 노란 가로수),
//    단풍나무(07·09), 활엽수(01 캠퍼스를 둘러싼 숲)
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

export const SEASONS = {
  spring: {
    pine: ['#2f5b35', '#3a6a3c', '#34603a'],
    cherry: ['#f6dbe6', '#f2cad9', '#fbe9ef', '#f0c0d2'],
    ginkgo: ['#9cc65a', '#8bb84d', '#a6cc66'],
    maple: ['#8db857', '#a3c466', '#7fae4f'],
    broadleaf: ['#7fae4f', '#93bc5e', '#6e9f45', '#86b356'],
    metasequoia: ['#8fc06a', '#9cc874', '#84b85f'],
  },
  summer: {
    pine: ['#2f5b35', '#3a6a3c', '#34603a'],
    cherry: ['#4f8040', '#5a8a47', '#477a3b'],
    ginkgo: ['#5c8f3a', '#679a40', '#558735'],
    maple: ['#4b7d36', '#568a3d', '#447330'],
    broadleaf: ['#3f6e34', '#4b7b3a', '#365f2e', '#447536'],
    metasequoia: ['#4c7d3c', '#558744', '#467535'],
  },
  autumn: {
    pine: ['#2f5b35', '#3a6a3c', '#34603a'],
    cherry: ['#c96a3a', '#b9523a', '#d98a4a', '#a8533a'],
    ginkgo: ['#f2c230', '#e9b524', '#f5cf4a', '#e0a91f'],
    maple: ['#c8321f', '#d9481f', '#b52a22', '#e0662a', '#e88a2c'],
    broadleaf: ['#a7793b', '#b8652c', '#8c7a3a', '#6e7a35', '#c49a3c', '#5f7233'],
    metasequoia: ['#b5652c', '#c07434', '#a85a2a'],
  },
};

const TRUNK = { pine: '#8a4b32', cherry: '#4a3a33', ginkgo: '#5b4a3d', maple: '#4d3b30', broadleaf: '#544235', metasequoia: '#7a4a33' };

// [x, y, z, 반지름, y 납작도]
const SPECS = {
  pine: { trunk: [7.2, 0.17, 0.28], blobs: [[0, 7.3, 0, 2.3, 0.45], [1.4, 6.5, 0.4, 1.7, 0.45], [-1.2, 6.9, -0.7, 1.8, 0.45], [0.3, 8.2, 0.2, 1.3, 0.5]] },
  cherry: { trunk: [2.8, 0.18, 0.28], blobs: [[0, 4.3, 0, 2.9, 0.72], [1.7, 3.9, 0.6, 2.0, 0.75], [-1.6, 4.1, -0.5, 2.1, 0.75], [0.2, 5.2, -0.3, 1.8, 0.7]] },
  ginkgo: { trunk: [4.5, 0.16, 0.26], blobs: [[0, 6.4, 0, 2.3, 1.6], [0.2, 9.2, 0, 1.4, 1.3], [0.7, 5.2, 0.3, 1.6, 1.0]] },
  maple: { trunk: [2.3, 0.14, 0.22], blobs: [[0, 3.7, 0, 2.3, 0.8], [1.2, 3.4, 0.6, 1.6, 0.8], [-1.1, 3.6, -0.5, 1.6, 0.8]] },
  broadleaf: { trunk: [3.6, 0.2, 0.32], blobs: [[0, 6.1, 0, 3.4, 0.85], [1.9, 5.5, 1.0, 2.4, 0.85], [-1.9, 5.7, -0.8, 2.5, 0.85]] },
  // 메타세쿼이아: 곧은 줄기에 좁고 긴 원뿔형 수관
  metasequoia: { trunk: [9, 0.16, 0.34], blobs: [[0, 6, 0, 2.6, 1.2], [0, 9.5, 0, 2.0, 1.4], [0, 13, 0, 1.3, 1.6], [0, 15.6, 0, 0.7, 1.6]] },
};

function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildGeometries(type, rand) {
  const s = SPECS[type];
  const [h, rTop, rBot] = s.trunk;
  const trunk = new THREE.CylinderGeometry(rTop, rBot, h, 6).translate(0, h / 2, 0);
  // 숲을 이루는 수종(수천 그루)은 면 수를 줄이고, 캠퍼스 조경수는 더 둥글게
  const detail = type === 'broadleaf' || type === 'pine' ? 0 : 1;
  const blobs = s.blobs.map(([x, y, z, r, sy]) => {
    let g = new THREE.IcosahedronGeometry(r, detail);
    g.deleteAttribute('normal');
    g.deleteAttribute('uv');
    g = mergeVertices(g);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const k = 0.82 + rand() * 0.3;   // 울퉁불퉁한 잎 덩어리
      p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * sy, p.getZ(i) * k);
    }
    g.translate(x, y, z);
    return g;
  });
  const canopy = mergeGeometries(blobs);
  canopy.computeVertexNormals();
  return { trunk, canopy };
}

/**
 * 장애물 래스터(1px = 1m): R = 건물·도로·운동장 등 나무 금지, G = 녹지, B = 캠퍼스 내부.
 */
function rasterize(data, extent, extraBlocked) {
  const { minX, maxY, w, h } = extent;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#000';
  g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'lighter';
  const path = (pts, close = true) => {
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x - minX, maxY - y) : g.moveTo(x - minX, maxY - y)));
    if (close) g.closePath();
  };
  g.fillStyle = '#0000ff';
  for (const bd of data.boundaries ?? [{ pts: data.boundary }]) { path(bd.pts); g.fill(); }

  g.fillStyle = '#00ff00';
  for (const a of data.areas) {
    if (['park', 'garden', 'grass', 'forest'].includes(a.kind)) { path(a.outer); g.fill(); }
  }
  g.fillStyle = g.strokeStyle = '#ff0000';
  g.lineJoin = g.lineCap = 'round';
  for (const b of data.buildings) { path(b.outer); g.fill(); g.lineWidth = 6; g.stroke(); }
  for (const a of data.areas) {
    if (['parking', 'pitch', 'playground', 'outdoor_seating'].includes(a.kind)) { path(a.outer); g.fill(); }
  }
  for (const r of data.roads) { path(r.pts, false); g.lineWidth = r.width + 2; g.stroke(); }
  for (const zone of extraBlocked) {
    if (zone.poly) { path(zone.poly); g.fill(); continue; }
    g.beginPath(); g.arc(zone.x - minX, maxY - zone.y, zone.r, 0, Math.PI * 2); g.fill();
  }
  const px = g.getImageData(0, 0, w, h).data;
  return (x, y) => {
    const i = Math.floor(x - minX), j = Math.floor(maxY - y);
    if (i < 0 || j < 0 || i >= w || j >= h) return null;
    const o = (j * w + i) * 4;
    return { blocked: px[o] > 100, green: px[o + 1] > 100, campus: px[o + 2] > 100 };
  };
}

function pickWeighted(rand, weights) {
  let r = rand() * Object.values(weights).reduce((a, b) => a + b, 0);
  for (const [k, w] of Object.entries(weights)) if ((r -= w) <= 0) return k;
  return Object.keys(weights)[0];
}

function pointInPoly([x, y], pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * @param data   CAMPUS_DATA
 * @param opts.landmarks  [{x, y, r}] 나무를 심지 않을 원형 영역(광장 등)
 * @param opts.ringPines  [{x, y, r}] 원 둘레에 소나무를 심을 곳(선구자상 광장)
 */
export function createVegetation(data, { landmarks = [], ringPines = [], pines = [], avenues = [], heightAt = () => 0, density = 1 } = {}) {
  const rand = rng(20261023);
  const allPts = (data.boundaries ?? [{ pts: data.boundary }]).flatMap((bd) => bd.pts);
  const xs = allPts.map((p) => p[0]), ys = allPts.map((p) => p[1]);
  const M = 170; // 캠퍼스 밖 숲 띠 폭(m)
  const extent = { minX: Math.min(...xs) - M, maxX: Math.max(...xs) + M, minY: Math.min(...ys) - M, maxY: Math.max(...ys) + M };
  extent.w = Math.ceil(extent.maxX - extent.minX);
  extent.h = Math.ceil(extent.maxY - extent.minY);
  const sample = rasterize(data, extent, landmarks);

  const trees = [];
  const taken = new Set();
  const cell = 3.6;
  const tryPlant = (x, y, type, { needCampus = null, scale = 1 } = {}) => {
    const s = sample(x, y);
    if (!s || s.blocked) return false;
    if (needCampus !== null && s.campus !== needCampus) return false;
    const key = `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
    if (taken.has(key)) return false;
    taken.add(key);
    trees.push({ x, y, type, s: scale * (0.8 + rand() * 0.45), rot: rand() * Math.PI * 2,
                 lean: type === 'pine' ? rand() * 0.14 : rand() * 0.04, leanDir: rand() * Math.PI * 2, c: rand() });
    return true;
  };

  // 0) 조사로 확인한 가로수길 (벚꽃길 · 은행나무길 등) — 선 위가 막혀 있으면 양옆 5 m 에
  for (const av of avenues) {
    if (!SPECS[av.species]) continue;
    for (let i = 1; i < av.pts.length; i++) {
      const [x0, y0] = av.pts[i - 1], [x1, y1] = av.pts[i];
      const len = Math.hypot(x1 - x0, y1 - y0) || 1;
      const nx = -(y1 - y0) / len, ny = (x1 - x0) / len;
      for (let d = 0; d < len; d += 7) {
        const px = x0 + ((x1 - x0) * d) / len, py = y0 + ((y1 - y0) * d) / len;
        if (!tryPlant(px, py, av.species)) {
          tryPlant(px + nx * 5, py + ny * 5, av.species);
          tryPlant(px - nx * 5, py - ny * 5, av.species);
        }
      }
    }
  }

  // 1) 가로수: 차로 양옆으로 일정 간격 (은행나무 또는 벚나무 줄)
  data.roads.forEach((r, ri) => {
    if (!['service', 'unclassified', 'pedestrian'].includes(r.kind)) return;
    const type = ri % 2 ? 'ginkgo' : 'cherry';
    for (let i = 1; i < r.pts.length; i++) {
      const [x0, y0] = r.pts[i - 1], [x1, y1] = r.pts[i];
      const len = Math.hypot(x1 - x0, y1 - y0);
      const nx = -(y1 - y0) / len, ny = (x1 - x0) / len;
      for (let d = 4; d < len; d += 9) {
        const t = d / len, px = x0 + (x1 - x0) * t, py = y0 + (y1 - y0) * t;
        for (const side of [-1, 1]) {
          if (rand() < 0.85) tryPlant(px + nx * side * (r.width / 2 + 2.8), py + ny * side * (r.width / 2 + 2.8), type, { needCampus: true });
        }
      }
    }
  });

  // 2) 선구자상 광장 주변 소나무 (공식 사진 57: 수조 뒤와 양옆으로 늘어선 소나무)
  for (const p of pines) tryPlant(p.x, p.y, 'pine', { scale: 1.15 });
  for (const { x, y, r } of ringPines) {
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 9) {
      tryPlant(x + Math.cos(a) * (r + 2 + rand() * 3), y + Math.sin(a) * (r + 2 + rand() * 3), 'pine', { scale: 1.1 });
    }
  }

  // 3) 녹지 내부
  const MIX = {
    forest: { broadleaf: 0.55, pine: 0.35, maple: 0.1 },
    park: { pine: 0.3, maple: 0.25, cherry: 0.2, broadleaf: 0.25 },
    garden: { pine: 0.4, maple: 0.35, cherry: 0.25 },
    grass: { cherry: 0.5, maple: 0.5 },
  };
  for (const a of data.areas) {
    if (!MIX[a.kind]) continue;
    const lawn = (a.name ?? '').includes('잔디');
    const per = lawn ? 700 : { forest: 32, park: 75, garden: 60, grass: 260 }[a.kind];
    const axs = a.outer.map((p) => p[0]), ays = a.outer.map((p) => p[1]);
    const [ax0, ax1, ay0, ay1] = [Math.min(...axs), Math.max(...axs), Math.min(...ays), Math.max(...ays)];
    const area = Math.abs(a.outer.reduce((s, p, i) => {
      const q = a.outer[(i + 1) % a.outer.length];
      return s + p[0] * q[1] - q[0] * p[1];
    }, 0) / 2);
    const n = Math.min(Math.round((area / per) * density), 2200);
    for (let k = 0, tries = 0; k < n && tries < n * 4; tries++) {
      const p = [ax0 + rand() * (ax1 - ax0), ay0 + rand() * (ay1 - ay0)];
      if (pointInPoly(p, a.outer) && tryPlant(p[0], p[1], pickWeighted(rand, MIX[a.kind]))) k++;
    }
  }

  // 4) 캠퍼스 안 빈 땅 — 드문드문
  // 5) 캠퍼스를 둘러싼 숲 (사진 01) — 경계에서 멀어질수록 듬성듬성
  const total = ((extent.w * extent.h) / 95) * density;
  for (let k = 0; k < total; k++) {
    const x = extent.minX + rand() * extent.w, y = extent.minY + rand() * extent.h;
    const s = sample(x, y);
    if (!s || s.blocked || s.green) continue;
    if (s.campus) {
      if (rand() < 0.09) tryPlant(x, y, pickWeighted(rand, { cherry: 0.3, maple: 0.3, pine: 0.25, ginkgo: 0.15 }));
    } else {
      const edge = Math.min(x - extent.minX, extent.maxX - x, y - extent.minY, extent.maxY - y);
      if (rand() < Math.min(1, edge / 60)) tryPlant(x, y, pickWeighted(rand, { broadleaf: 0.6, pine: 0.4 }), { scale: 1.1 });
    }
  }

  // ---- InstancedMesh 구성 ----
  const group = new THREE.Group();
  group.name = 'vegetation';
  const meshes = {};
  const byType = {};
  for (const t of trees) (byType[t.type] ??= []).push(t);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3();
  for (const [type, list] of Object.entries(byType)) {
    const geo = buildGeometries(type, rng(type.length * 977));
    const trunk = new THREE.InstancedMesh(geo.trunk, new THREE.MeshStandardMaterial({ color: TRUNK[type], roughness: 1 }), list.length);
    const canopy = new THREE.InstancedMesh(geo.canopy, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, flatShading: true }), list.length);
    list.forEach((t, i) => {
      e.set(Math.cos(t.leanDir) * t.lean, t.rot, Math.sin(t.leanDir) * t.lean);
      q.setFromEuler(e);
      sc.set(t.s, t.s * (0.92 + t.c * 0.16), t.s);
      m4.compose(v.set(t.x, heightAt(t.x, t.y) - 0.15, -t.y), q, sc);   // 지형 위에
      trunk.setMatrixAt(i, m4);
      canopy.setMatrixAt(i, m4);
    });
    for (const m of [trunk, canopy]) {
      m.castShadow = true;
      m.receiveShadow = m === canopy;
      m.computeBoundingSphere();
      group.add(m);
    }
    meshes[type] = { canopy, list };
  }

  const col = new THREE.Color();
  function setSeason(season) {
    for (const [type, { canopy, list }] of Object.entries(meshes)) {
      const pal = SEASONS[season][type];
      list.forEach((t, i) => {
        col.set(pal[Math.floor(t.c * pal.length) % pal.length]);
        col.offsetHSL(0, 0, (t.c - 0.5) * 0.06);
        canopy.setColorAt(i, col);
      });
      canopy.instanceColor.needsUpdate = true;
    }
  }

  // 폭파 모드: 반경 안의 나무를 쓰러뜨림(크기 0) / 모두 되살림
  const hidden = [];
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  function blast(x, y, r) {
    for (const { canopy, list } of Object.values(meshes)) {
      const trunk = group.children[group.children.indexOf(canopy) - 1];
      list.forEach((t, i) => {
        if (t.down || Math.hypot(t.x - x, t.y - y) > r) return;
        t.down = true;
        const m = new THREE.Matrix4();
        canopy.getMatrixAt(i, m);
        hidden.push({ canopy, trunk, i, m, t });
        canopy.setMatrixAt(i, zero);
        trunk.setMatrixAt(i, zero);
        canopy.instanceMatrix.needsUpdate = trunk.instanceMatrix.needsUpdate = true;
      });
    }
  }
  function restoreAll() {
    for (const h of hidden.splice(0)) {
      h.t.down = false;
      h.canopy.setMatrixAt(h.i, h.m);
      h.trunk.setMatrixAt(h.i, h.m);
      h.canopy.instanceMatrix.needsUpdate = h.trunk.instanceMatrix.needsUpdate = true;
    }
  }

  return { group, setSeason, trees, blast, restoreAll, count: trees.length, counts: Object.fromEntries(Object.entries(byType).map(([k, l]) => [k, l.length])) };
}

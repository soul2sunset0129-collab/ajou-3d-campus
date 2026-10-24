// 지형: scripts/build_terrain.py 가 만든 높이 격자(window.TERRAIN)로 지형 메시를 만들고,
// 도로 · 보도 · 녹지 · 주차장 · 운동장(라인 포함)을 지면 텍스처 한 장에 그려 지형에 입힌다.
import * as THREE from 'three';

const DAY = {
  forest: '#7f9568', campus: '#a3b585', park: '#8fae6d', garden: '#86a866', grass: '#9fbd7d', forestArea: '#6f8d58',
  paving: '#d3ccbd', path: '#d9cfbb', steps: '#e4ddcf', asphalt: '#6e7276', lane: '#e2b93b', laneWhite: '#f2f2ee',
  parking: '#8f9396', turf: '#5f9c52', turf2: '#6aa75c', tennis: '#4f8f7d', basketball: '#b97c4f', playground: '#cdb98f',
  seating: '#c9bba3', line: '#f4f4f0', stall: '#e9e9e4',
};

function pca(pts) {
  // 가장 긴 변 방향을 축으로 한 방향 상자
  let best = 0, u = [1, 0];
  pts.forEach((p, i) => {
    const q = pts[(i + 1) % pts.length], len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (len > best) { best = len; u = [(q[0] - p[0]) / len, (q[1] - p[1]) / len]; }
  });
  const v = [-u[1], u[0]];
  const pu = pts.map((p) => p[0] * u[0] + p[1] * u[1]), pv = pts.map((p) => p[0] * v[0] + p[1] * v[1]);
  const [u0, u1, v0, v1] = [Math.min(...pu), Math.max(...pu), Math.min(...pv), Math.max(...pv)];
  const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
  return { u, v, len: u1 - u0, wid: v1 - v0, c: [cu * u[0] + cv * v[0], cu * u[1] + cv * v[1]] };
}

export function createTerrain(T, data) {
  // ---- 높이 격자 ----
  const bin = atob(T.h);
  const heights = new Float32Array(T.nx * T.ny);
  for (let i = 0; i < heights.length; i++) {
    const v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8);
    heights[i] = ((v << 16) >> 16) / 100;
  }
  let minH = Infinity, maxH = -Infinity;
  for (const h of heights) { if (h < minH) minH = h; if (h > maxH) maxH = h; }
  const W = (T.nx - 1) * T.step, H = (T.ny - 1) * T.step;
  const x0 = T.x0, y0 = T.y0, x1 = x0 + W, y1 = y0 + H;

  /** 데이터 좌표 (x=동, y=북) 의 지면 높이 (쌍선형 보간, 범위 밖은 가장자리 값) */
  function heightAt(x, y) {
    const fx = Math.min(T.nx - 1.001, Math.max(0, (x - x0) / T.step));
    const fy = Math.min(T.ny - 1.001, Math.max(0, (y - y0) / T.step));
    const i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j;
    const k = j * T.nx + i;
    return (heights[k] * (1 - tx) + heights[k + 1] * tx) * (1 - ty) + (heights[k + T.nx] * (1 - tx) + heights[k + T.nx + 1] * tx) * ty;
  }

  // ---- 지면 텍스처 ----
  const RES = 0.6; // m/px
  const cw = Math.min(4096, Math.ceil(W / RES)), ch = Math.min(4096, Math.ceil(H / RES));
  const canvas = document.createElement('canvas');
  canvas.width = cw; canvas.height = ch;
  const g = canvas.getContext('2d');
  const S = cw / W;                       // px per m
  const P = (x, y) => [(x - x0) * S, (y1 - y) * (ch / H)];
  const path = (pts, close = true) => {
    g.beginPath();
    pts.forEach((p, i) => { const [a, b] = P(p[0], p[1]); i ? g.lineTo(a, b) : g.moveTo(a, b); });
    if (close) g.closePath();
  };
  // 잔디 · 흙의 자잘한 얼룩 (작은 노이즈 타일을 패턴으로 반복)
  const noise = document.createElement('canvas');
  noise.width = noise.height = 256;
  {
    const ng = noise.getContext('2d');
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 9000; i++) {
      ng.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.06)';
      const r = 1 + rnd() * 3;
      ng.fillRect(rnd() * 256, rnd() * 256, r, r);
    }
  }
  const noisePattern = g.createPattern(noise, 'repeat');

  // 운동장 · 코트 라인 (방향 상자 좌표계로 그림)
  function inBox(poly, fn) {
    const b = pca(poly);
    const [cx, cy] = P(b.c[0], b.c[1]);
    g.save();
    path(poly); g.clip();
    g.translate(cx, cy);
    g.rotate(-Math.atan2(b.u[1], b.u[0]));
    g.scale(S, S);
    fn(b);
    g.restore();
  }
  function soccer(b, C) {
    const L = b.len - 3, Wd = b.wid - 3;
    for (let k = -Math.ceil(b.len / 10); k < Math.ceil(b.len / 10); k++) {   // 잔디 깎은 줄무늬
      g.fillStyle = k % 2 ? C.turf : C.turf2;
      g.fillRect(k * 5, -b.wid, 5, b.wid * 2);
    }
    g.strokeStyle = C.line; g.lineWidth = 0.15;
    g.strokeRect(-L / 2, -Wd / 2, L, Wd);
    g.beginPath(); g.moveTo(0, -Wd / 2); g.lineTo(0, Wd / 2); g.stroke();
    g.beginPath(); g.arc(0, 0, Math.min(9.15, Wd / 5), 0, Math.PI * 2); g.stroke();
    for (const sx of [-1, 1]) {
      const pw = Math.min(40.3, Wd * 0.6), gw = Math.min(18.3, Wd * 0.28);
      g.strokeRect(sx > 0 ? L / 2 - 16.5 : -L / 2, -pw / 2, 16.5, pw);
      g.strokeRect(sx > 0 ? L / 2 - 5.5 : -L / 2, -gw / 2, 5.5, gw);
    }
  }
  function court(b, color, lines) {
    g.fillStyle = color;
    g.fillRect(-b.len, -b.wid, b.len * 2, b.wid * 2);
    g.strokeStyle = lines; g.lineWidth = 0.1;
    const L = b.len - 2, Wd = b.wid - 2;
    g.strokeRect(-L / 2, -Wd / 2, L, Wd);
    g.beginPath(); g.moveTo(0, -Wd / 2); g.lineTo(0, Wd / 2); g.stroke();
  }
  function parkingStalls(b, C) {
    g.strokeStyle = C.stall; g.lineWidth = 0.12;
    const depth = Math.min(5, b.wid / 2.5);
    for (let u = -b.len / 2 + 1.25; u < b.len / 2; u += 2.5) {
      for (const s of [-1, 1]) {
        g.beginPath(); g.moveTo(u, s * b.wid / 2); g.lineTo(u, s * (b.wid / 2 - depth)); g.stroke();
      }
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;

  function paint(night = false) {
    const C = DAY;
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = C.forest; g.fillRect(0, 0, cw, ch);
    g.fillStyle = C.campus;
    for (const bd of data.boundaries ?? [{ pts: data.boundary }]) { path(bd.pts); g.fill(); }
    // 녹지
    for (const a of data.areas) {
      const col = { park: C.park, garden: C.garden, grass: C.grass, forest: C.forestArea, playground: C.playground, outdoor_seating: C.seating }[a.kind];
      if (col) { g.fillStyle = col; path(a.outer); g.fill(); }
    }
    g.fillStyle = noisePattern; g.fillRect(0, 0, cw, ch);
    // 건물 둘레 포장
    g.lineJoin = g.lineCap = 'round';
    g.fillStyle = g.strokeStyle = C.paving;
    for (const b of data.buildings) { path(b.outer); g.lineWidth = 7 * S; g.stroke(); g.fill(); }
    // 주차장 · 운동장 · 코트
    const fieldSurface = Object.fromEntries((data.fields ?? []).map((f) => [f.id, f.surface]));
    for (const a of data.areas) {
      if (a.kind === 'parking') {
        g.fillStyle = C.parking; path(a.outer); g.fill();
        inBox(a.outer, (b) => parkingStalls(b, C));
      } else if (a.kind === 'pitch') {
        const surf = fieldSurface[a.id];
        if (a.sport === 'tennis' || surf === 'hardcourt') inBox(a.outer, (b) => court(b, C.tennis, C.line));
        else if (a.sport === 'basketball') inBox(a.outer, (b) => court(b, C.basketball, C.line));
        else if (surf === 'sand') inBox(a.outer, (b) => court(b, '#c9b48a', '#efe9da'));
        else inBox(a.outer, (b) => soccer(b, C));
      }
    }
    // 보행로 · 계단 · 도로
    for (const r of data.roads) {
      const isRoad = ['unclassified', 'service', 'pedestrian'].includes(r.kind);
      if (isRoad) continue;
      g.strokeStyle = r.kind === 'steps' ? C.steps : C.path;
      g.lineWidth = r.width * S;
      path(r.pts, false); g.stroke();
    }
    for (const r of data.roads) {
      if (!['unclassified', 'service', 'pedestrian'].includes(r.kind)) continue;
      g.strokeStyle = r.kind === 'pedestrian' ? C.paving : C.asphalt;
      g.lineWidth = r.width * S;
      path(r.pts, false); g.stroke();
    }
    // 차선: 넓은 길은 노란 중앙선(점선)
    g.setLineDash([3 * S, 3 * S]);
    for (const r of data.roads) {
      if (!['unclassified', 'service'].includes(r.kind) || r.width < 6) continue;
      g.strokeStyle = C.lane; g.lineWidth = 0.16 * S;
      path(r.pts, false); g.stroke();
    }
    g.setLineDash([]);
    if (night) {
      g.globalCompositeOperation = 'multiply';
      g.fillStyle = '#5a6680';      // 밤: 푸른빛으로 어둡게 (길은 보이게)
      g.fillRect(0, 0, cw, ch);
      g.globalCompositeOperation = 'source-over';
    }
    texture.needsUpdate = true;
  }

  // ---- 지형 메시 ----
  const geo = new THREE.PlaneGeometry(W, H, T.nx - 1, T.ny - 1);
  geo.rotateX(-Math.PI / 2);                  // (x, y) → (x, 0, -y): 첫 행(+y)이 북쪽
  const pos = geo.attributes.position;
  for (let r = 0; r < T.ny; r++) {
    const j = T.ny - 1 - r;                   // 격자 행(남→북)
    for (let c = 0; c < T.nx; c++) pos.setY(r * T.nx + c, heights[j * T.nx + c]);
  }
  geo.translate(x0 + W / 2, 0, -(y0 + H / 2));
  geo.computeVertexNormals();
  // 가파른 비탈(약 22° 이상)은 석축 · 축대처럼 보이게 돌 색으로 섞음
  const nrm = geo.attributes.normal;
  const steep = new Float32Array(nrm.count);
  for (let i = 0; i < nrm.count; i++) {
    const ny = nrm.getY(i);
    steep[i] = Math.min(1, Math.max(0, (0.93 - ny) / 0.1));
  }
  geo.setAttribute('steep', new THREE.BufferAttribute(steep, 1));
  const material = new THREE.MeshLambertMaterial({ map: texture });
  const stone = new THREE.Color('#a39d92');
  material.onBeforeCompile = (shader) => {
    shader.uniforms.stoneColor = { value: stone };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute float steep;
varying float vSteep;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vSteep = steep;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform vec3 stoneColor;
varying float vSteep;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
diffuseColor.rgb = mix(diffuseColor.rgb, stoneColor * (0.92 + 0.08 * sin(vMapUv.y * 6000.0)), vSteep * 0.85);`);
  };
  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';

  // 가장자리 치마 (멀리서 볼 때 지형 끝이 떠 보이지 않게)
  const skirtPts = [];
  const bottom = minH - 25;
  const edge = (pts) => {
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
      const a = new THREE.Vector3(ax, heightAt(ax, ay), -ay), b = new THREE.Vector3(bx, heightAt(bx, by), -by);
      const a2 = a.clone().setY(bottom), b2 = b.clone().setY(bottom);
      skirtPts.push(a, a2, b, b, a2, b2);
    }
  };
  const ring = (n, f) => Array.from({ length: n + 1 }, (_, i) => f(i / n));
  edge(ring(60, (t) => [x0 + W * t, y0]));
  edge(ring(60, (t) => [x1, y0 + H * t]));
  edge(ring(60, (t) => [x1 - W * t, y1]));
  edge(ring(60, (t) => [x0, y1 - H * t]));
  const skirtGeo = new THREE.BufferGeometry().setFromPoints(skirtPts);
  skirtGeo.computeVertexNormals();
  const skirtMat = new THREE.MeshLambertMaterial({ color: DAY.forest, side: THREE.DoubleSide });
  const skirt = new THREE.Mesh(skirtGeo, skirtMat);

  return {
    mesh, skirt, heightAt, paint, minH, maxH, ref: T.ref, bounds: { x0, y0, x1, y1 },
    setNight(on) { paint(on); skirtMat.color.set(on ? '#1c241d' : DAY.forest); stone.set(on ? '#3a3a3c' : '#a39d92'); },
  };
}

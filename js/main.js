import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { styleFor, facadeFor, specFor, ROOF_COLORS, FLOOR } from './facades.js';
import { createVegetation } from './vegetation.js';
import { createExplorer } from './explore.js';
import { createPioneerStatue, createAmphitheater, createGate } from './landmarks.js';
import { createTerrain } from './terrain.js';
import { createDemolition } from './demolition.js';

const DATA = window.CAMPUS_DATA;
const $ = (s) => document.querySelector(s);

// ---------- 기본 장면 ----------
const container = $('#scene');
// 휴대폰 · 태블릿: 해상도 배율 · 그림자 · 나무 수 · 지면 텍스처를 낮춰 부드럽게
const MOBILE = matchMedia('(pointer: coarse)').matches || Math.min(screen.width, screen.height) < 768;
const renderer = new THREE.WebGLRenderer({ antialias: !MOBILE || devicePixelRatio < 2, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, MOBILE ? 1.5 : 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = MOBILE ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
container.appendChild(renderer.domElement);

const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(innerWidth, innerHeight);
Object.assign(labelRenderer.domElement.style, { position: 'absolute', top: '0', pointerEvents: 'none' });
container.appendChild(labelRenderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 1, 8000);
const controls = new MapControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.47;
controls.minDistance = 12;
controls.maxDistance = 1800;

// 데이터 좌표(x=동, y=북) → 월드(x, z=-북)
const toV3 = ([x, y], h = 0) => new THREE.Vector3(x, h, -y);
const shapeFrom = (outer, holes = []) => {
  const s = new THREE.Shape(outer.map(([x, y]) => new THREE.Vector2(x, y)));
  for (const h of holes) s.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
  return s;
};
const rng = (seed) => () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// ---------- 테마 (낮 / 밤) ----------
const THEMES = {
  light: { skyTop: 0x5f97d4, skyHorizon: 0xdbe7ef, ground: 0xb4bf98, campus: 0xe6e2d7, road: 0xf7f6f2, path: 0xd8cfbd,
           edge: 0x37404d, hemi: 0.85, sun: 2.6, sunColor: 0xfff1dc, night: false },
  dark:  { skyTop: 0x0a1430, skyHorizon: 0x2b3a5c, ground: 0x1b231c, campus: 0x2a2f36, road: 0x454c57, path: 0x363b43,
           edge: 0x0c1016, hemi: 0.32, sun: 0.45, sunColor: 0x9fb4ff, night: true },
};
// 하늘: 그라데이션 돔
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: { top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() } },
  vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: 'uniform vec3 top; uniform vec3 horizon; varying vec3 vP; void main(){ float h = clamp(vP.y * 1.6, 0.0, 1.0); gl_FragColor = vec4(mix(horizon, top, pow(h, 0.7)), 1.0);\n#include <colorspace_fragment>\n}',
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(5000, 32, 16), skyMat);
scene.add(sky);

scene.fog = new THREE.Fog(0, 1300, 3600);
const hemi = new THREE.HemisphereLight(0xdfeeff, 0x6b6a55, 1);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff4e2, 2);
sun.position.set(-320, 520, 260);
sun.castShadow = true;
sun.shadow.mapSize.set(MOBILE ? 2048 : 4096, MOBILE ? 2048 : 4096);
Object.assign(sun.shadow.camera, { left: -720, right: 720, top: 720, bottom: -720, near: 10, far: 1700 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.6;
scene.add(sun);

// ---------- 지형 · 지면 ----------
// 실제 고도(Copernicus DEM, scripts/build_terrain.py) 위에 도로 · 녹지 · 운동장을 텍스처로 그려 입힌다
const mats = {
  ground: new THREE.MeshLambertMaterial({ color: 0x7f9568 }),
  edge: new THREE.LineBasicMaterial({ transparent: true, opacity: 0.25 }),
  rooftop: new THREE.MeshStandardMaterial({ color: 0xb4b7ba, roughness: 0.8 }),
};
const BOUNDARIES = DATA.boundaries ?? [{ name: '아주대학교', pts: DATA.boundary }];
const terrain = window.TERRAIN
  ? createTerrain(window.TERRAIN, DATA, { res: MOBILE ? 0.9 : 0.6 })
  : { heightAt: () => 0, paint() {}, setNight() {}, minH: 0, maxH: 0, ref: 0, mesh: null, skirt: null };
const groundY = (x, y) => terrain.heightAt(x, y);
if (terrain.mesh) scene.add(terrain.mesh, terrain.skirt);
// 지형 밖 먼 바닥 (안개 속으로 이어짐)
const ground = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000).rotateX(-Math.PI / 2), mats.ground);
ground.position.y = terrain.minH - 20;
ground.receiveShadow = true;
scene.add(ground);

// ---------- 건물 ----------
const buildingMeshes = [];
const facadeMats = [];
const edgeLines = [];
const byId = new Map();

function centroid(pts) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length];
    const f = x0 * y1 - x1 * y0;
    a += f; cx += (x0 + x1) * f; cy += (y0 + y1) * f;
  }
  return a ? [cx / (3 * a), cy / (3 * a)] : pts[0];
}
function pointInPoly([x, y], pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const rooftopGeos = [];
let amphi = null;
function extrude(outer, holes, h, y0) {
  const geo = new THREE.ExtrudeGeometry(shapeFrom(outer, holes), { depth: h, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2);
  if (y0) geo.translate(0, y0, 0);
  return geo;
}
// 박공 · 아치 지붕: 외곽선의 방향 상자 위에 곡면/경사면과 양 끝 박공벽을 만든다
//  axisDeg = 지붕이 오르내리는 방향(나침반 방위). 없으면 가장 긴 변에 수직(용마루가 긴 변을 따라감)
function pitchedRoof(poly, eave, rise, shape, axisDeg) {
  let u;
  if (axisDeg != null) {
    const b = THREE.MathUtils.degToRad(axisDeg);
    u = [Math.sin(b), Math.cos(b)];
  } else {
    let best = 0, d = [1, 0];
    poly.forEach((p, i) => {
      const q = poly[(i + 1) % poly.length], len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (len > best) { best = len; d = [(q[0] - p[0]) / len, (q[1] - p[1]) / len]; }
    });
    u = [-d[1], d[0]];
  }
  const v = [-u[1], u[0]];
  const pu = poly.map((p) => p[0] * u[0] + p[1] * u[1]), pv = poly.map((p) => p[0] * v[0] + p[1] * v[1]);
  const [u0, u1, v0, v1] = [Math.min(...pu), Math.max(...pu), Math.min(...pv), Math.max(...pv)];
  const segs = shape === 'vault' ? 28 : 2;
  const prof = (t) => (shape === 'vault' ? rise * Math.sin(Math.PI * t) : rise * (1 - Math.abs(2 * t - 1)));
  const at = (uu, vv, h) => new THREE.Vector3(uu * u[0] + vv * v[0], eave + h, -(uu * u[1] + vv * v[1]));
  const top = [], ends = [];
  for (let i = 0; i < segs; i++) {
    const ta = i / segs, tb = (i + 1) / segs;
    const ua = u0 + (u1 - u0) * ta, ub = u0 + (u1 - u0) * tb;
    const a0 = at(ua, v0, prof(ta)), b0 = at(ub, v0, prof(tb)), a1 = at(ua, v1, prof(ta)), b1 = at(ub, v1, prof(tb));
    top.push(a0, b0, b1, a0, b1, a1);
    for (const [vv, flip] of [[v0, false], [v1, true]]) {
      const ba = at(ua, vv, 0), bb = at(ub, vv, 0), ta3 = at(ua, vv, prof(ta)), tb3 = at(ub, vv, prof(tb));
      ends.push(...(flip ? [ba, tb3, bb, ba, ta3, tb3] : [ba, bb, tb3, ba, tb3, ta3]));
    }
  }
  const mk = (pts) => {
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    g.computeVertexNormals();
    return g;
  };
  return { roof: mk(top), ends: mk(ends) };
}

function addRooftopUnits(poly, holes, top, area, rand) {
  const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
  const n = Math.min(4, 1 + Math.floor(area / 900));
  for (let k = 0, tries = 0; k < n && tries < 40; tries++) {
    const p = [Math.min(...xs) + rand() * (Math.max(...xs) - Math.min(...xs)), Math.min(...ys) + rand() * (Math.max(...ys) - Math.min(...ys))];
    const w = 3 + rand() * 5, d = 3 + rand() * 4, h = 1.5 + rand() * 2.2;
    const corners = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([dx, dy]) => [p[0] + dx, p[1] + dy]);
    if (!corners.every((c) => pointInPoly(c, poly) && !holes.some((hole) => pointInPoly(c, hole)))) continue;
    rooftopGeos.push(new THREE.BoxGeometry(w, h, d).translate(p[0], top + h / 2, -p[1]));
    k++;
  }
}

DATA.buildings.forEach((b, bi) => {
  // 노천극장은 위성영상에서 판독한 계단식 객석으로 표현
  if ((b.osmName ?? b.name) === '노천극장') {
    amphi = createAmphitheater();
    amphi.base = groundY(-57, -125);           // 무대 중심의 지면 높이
    amphi.group.position.y = amphi.base;
    scene.add(amphi.group);
    b.meshes = amphi.meshes;
    b.totalHeight = 13 * 0.42;
    for (const m of amphi.meshes) {
      m.userData.b = b;
      m.userData.base = [].concat(m.material).map((mt) => mt.color.clone());
      buildingMeshes.push(m);
    }
    b.ground = amphi.base;
    b.center = toV3(centroid(b.outer), b.ground + b.totalHeight);
    const el = document.createElement('div');
    el.className = 'label';
    el.textContent = b.name;
    const label = new CSS2DObject(el);
    label.position.copy(b.center).add(new THREE.Vector3(0, 4, 0));
    scene.add(label);
    b.labelEl = el;
    byId.set(String(b.id), b.meshes[0]);
    return;
  }
  const floorH = b.floorH ?? FLOOR;
  // 지면: 부지가 평탄화된 지형 위 높이. 경사 아래쪽은 기단(치마)으로 메움
  // 발밑 지형 표본(꼭짓점 · 변 중점 · 중심)의 중앙값을 바닥 높이로
  const samples = [centroid(b.outer), ...b.outer, ...b.outer.map((p, i) => { const q = b.outer[(i + 1) % b.outer.length]; return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]; })]
    .map((p) => groundY(p[0], p[1])).sort((a, c) => a - c);
  const gY = samples[Math.floor(samples.length / 2)];
  const minG = samples[0];
  b.ground = gY;
  // 덩어리: 전체 외곽을 덮는 기단(base) + 그 위로 솟은 부분(parts)
  const baseH = b.baseHeight ?? b.height;
  const parts = (b.parts ?? []).filter((p) => p.polygon?.length >= 3 && (p.height > baseH + 0.5 || p.roofShape));
  const totalH = Math.max(baseH, ...parts.map((p) => p.height));
  b.totalHeight = totalH;
  const style = styleFor(b);
  const roofColor = b.roofHex ?? ROOF_COLORS[style];
  const textures = facadeFor(b, totalH, floorH, bi);
  b.meshes = [];
  b.masses = [];   // 폭파 모드의 부분 파괴용: 덩어리별 외곽 · 높이 · 외벽
  const masses = [{ outer: b.outer, holes: b.holes ?? [], y0: 0, h: baseH, tex: textures, roofShape: parts.length ? null : b.roofShape }]
    .concat(parts.map((p, pi) => ({
      outer: p.polygon, holes: [], y0: baseH, h: p.height - baseH, roofShape: p.roofShape, roofAxisDeg: p.roofAxisDeg,
      // 생김새가 다른 부분(예: 금속패널 탑)은 자기 외관 사양으로
      tex: p.facade ? facadeFor({ ...b, facade: { ...(b.facade ?? {}), ...p.facade } }, totalH, floorH, bi * 7 + pi + 1) : textures,
    })));
  let roofTop = 0;
  for (const m of masses) {
    // 경사 지붕이면 벽은 처마 높이까지만, 그 위에 지붕을 얹음
    let rise = 0;
    if (m.roofShape) {
      const span = Math.sqrt(Math.abs(m.outer.reduce((a, p, i) => { const q = m.outer[(i + 1) % m.outer.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0) / 2));
      rise = m.roofShape === 'vault' ? Math.min(span * 0.12, 6.5) : Math.min(span * 0.12, 2.6);
      if (m.roofShape === 'vault') m.h = Math.max(3, m.h - rise);   // 아치는 주어진 높이가 꼭대기
    }
    roofTop = Math.max(roofTop, m.y0 + m.h + rise);
    const geo = extrude(m.outer, m.holes, m.h, m.y0 + gY);
    // ExtrudeGeometry 그룹 0 = 지붕/바닥, 1 = 벽
    const roof = new THREE.MeshStandardMaterial({ color: roofColor, roughness: 0.95 });
    const wall = new THREE.MeshStandardMaterial({ ...m.tex(m.y0), emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.75 });
    const mesh = new THREE.Mesh(geo, [roof, wall]);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.userData.b = b;
    mesh.userData.base = [roof.color.clone(), wall.color.clone()];
    scene.add(mesh);
    buildingMeshes.push(mesh);
    facadeMats.push(wall);
    b.meshes.push(mesh);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), mats.edge);
    scene.add(edges);
    edgeLines.push(edges);
    (b.edges ??= []).push(edges);
    const massInfo = { outer: m.outer, holes: m.holes, yBase: m.y0 + gY, yRel: m.y0, h: m.h, floorH, tex: m.tex, roofColor, mesh, edges, wall, extra: [] };
    b.masses.push(massInfo);
    if (m.roofShape) {
      const pr = pitchedRoof(m.outer, m.y0 + m.h + gY, rise, m.roofShape, m.roofAxisDeg);
      const roofMesh = new THREE.Mesh(pr.roof, new THREE.MeshStandardMaterial({ color: roofColor, roughness: 0.7, metalness: 0.2, side: THREE.DoubleSide }));
      const endMesh = new THREE.Mesh(pr.ends, new THREE.MeshStandardMaterial({ color: specFor(b).wall, roughness: 0.8, side: THREE.DoubleSide }));
      for (const rm of [roofMesh, endMesh]) {
        rm.castShadow = rm.receiveShadow = true;
        rm.userData.b = b;
        rm.userData.base = [rm.material.color.clone()];
        scene.add(rm);
        buildingMeshes.push(rm);
        b.meshes.push(rm);
        massInfo.extra.push(rm);
      }
    }
  }
  b.totalHeight = Math.max(totalH, roofTop);

  // 옥상 설비 — 가장 높은 덩어리 위에
  if (totalH >= 11 && b.area > 300) {
    const top = masses.reduce((a, m) => (m.y0 + m.h > a.y0 + a.h ? m : a));
    addRooftopUnits(top.outer, top.holes, top.y0 + top.h + gY, b.area, rng(bi * 131 + 7));
  }

  // 경사 아래쪽 기단: 지면과 건물 바닥 사이를 메움
  if (gY - minG > 0.15) {
    const spec = specFor(b);
    const depth = gY - minG + 0.8;
    // 한 층 높이 이상 드러나면 지하층 외벽(창 포함)으로, 낮으면 돌 기단으로
    const plinthMat = depth > floorH * 0.8
      ? [new THREE.MeshStandardMaterial({ color: roofColor, roughness: 0.95 }),
         new THREE.MeshStandardMaterial({ ...facadeFor(b, depth, floorH, bi + 500)(0), emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.75 })]
      : new THREE.MeshStandardMaterial({ color: new THREE.Color(spec.base?.hex ?? spec.wall).offsetHSL(0, -0.05, -0.12), roughness: 0.9 });
    if (Array.isArray(plinthMat)) facadeMats.push(plinthMat[1]);
    const plinth = new THREE.Mesh(extrude(b.outer, [], depth, minG - 0.8), plinthMat);
    plinth.castShadow = plinth.receiveShadow = true;
    plinth.userData.b = b;
    plinth.userData.base = [].concat(plinth.material).map((m) => m.color.clone());
    scene.add(plinth);
    buildingMeshes.push(plinth);
    b.meshes.push(plinth);
  }
  // 옥상 설비는 건물별 메시로 (폭파 모드에서 건물과 함께 무너지도록)
  const units = rooftopGeos.splice(0);
  if (units.length) {
    const roofUnits = new THREE.Mesh(mergeGeometries(units), mats.rooftop);
    roofUnits.castShadow = roofUnits.receiveShadow = true;
    roofUnits.userData.b = b;
    roofUnits.userData.base = [mats.rooftop.color.clone()];
    scene.add(roofUnits);
    b.meshes.push(roofUnits);
    b.roofUnits = roofUnits;
  }
  b.center = toV3(centroid(b.outer), gY + b.totalHeight);
  if (b.name) {
    const el = document.createElement('div');
    el.className = 'label';
    el.textContent = b.name;
    const label = new CSS2DObject(el);
    label.position.copy(b.center).add(new THREE.Vector3(0, 4, 0));
    scene.add(label);
    b.labelEl = el;
    b.labelObj = label;
  }
  byId.set(String(b.id), b.meshes[0]);
});


// ---------- 가로등 (공식 사진의 율곡관 앞길처럼 차로를 따라) ----------
const lampHeads = new THREE.MeshStandardMaterial({ color: 0xf2f2ee, emissive: 0xffe2a8, emissiveIntensity: 0, roughness: 0.4 });
{
  const spots = [];
  const blockedByBuilding = (x, y) => DATA.buildings.some((b) => {
    const xs = b.outer.map((p) => p[0]), ys = b.outer.map((p) => p[1]);
    if (x < Math.min(...xs) - 3 || x > Math.max(...xs) + 3 || y < Math.min(...ys) - 3 || y > Math.max(...ys) + 3) return false;
    return pointInPoly([x, y], b.outer) || b.outer.some((p, i) => {
      const q = b.outer[(i + 1) % b.outer.length];
      const dx = q[0] - p[0], dy = q[1] - p[1];
      const t = Math.max(0, Math.min(1, ((x - p[0]) * dx + (y - p[1]) * dy) / (dx * dx + dy * dy || 1)));
      return Math.hypot(x - p[0] - dx * t, y - p[1] - dy * t) < 2.5;
    });
  });
  DATA.roads.forEach((r, ri) => {
    if (!['unclassified', 'service'].includes(r.kind)) return;
    let carry = 12 + (ri % 3) * 5, side = ri % 2 ? 1 : -1;
    for (let i = 1; i < r.pts.length; i++) {
      const [x0, y0] = r.pts[i - 1], [x1, y1] = r.pts[i];
      const len = Math.hypot(x1 - x0, y1 - y0) || 1;
      const nx = -(y1 - y0) / len, ny = (x1 - x0) / len;
      for (let d = carry; d < len; d += 30) {
        const px = x0 + ((x1 - x0) * d) / len + nx * side * (r.width / 2 + 0.8);
        const py = y0 + ((y1 - y0) * d) / len + ny * side * (r.width / 2 + 0.8);
        if (!blockedByBuilding(px, py) && !spots.some((s) => Math.hypot(s.x - px, s.y - py) < 15)) {
          spots.push({ x: px, y: py, ang: Math.atan2(-ny * side, -nx * side) });  // 팔이 도로 쪽을 향하게
        }
        side = -side;
        carry = d + 30 - len;
      }
      carry = Math.max(0, carry);
    }
  });
  const poleGeo = mergeGeometries([
    new THREE.CylinderGeometry(0.06, 0.1, 7, 6).translate(0, 3.5, 0),
    new THREE.BoxGeometry(1.5, 0.08, 0.08).translate(0.7, 6.95, 0),
  ]);
  const headGeo = new THREE.BoxGeometry(0.55, 0.14, 0.28).translate(1.35, 6.86, 0);
  const poles = new THREE.InstancedMesh(poleGeo, new THREE.MeshStandardMaterial({ color: 0xb9bdc2, metalness: 0.5, roughness: 0.45 }), spots.length);
  const heads = new THREE.InstancedMesh(headGeo, lampHeads, spots.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
  spots.forEach((sp, i) => {
    // 데이터 좌표 각도 → 월드 y 회전 (월드 z = -북)
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), sp.ang);
    m4.compose(new THREE.Vector3(sp.x, groundY(sp.x, sp.y), -sp.y), q, one);
    poles.setMatrixAt(i, m4);
    heads.setMatrixAt(i, m4);
  });
  poles.castShadow = true;
  scene.add(poles, heads);
}

// ---------- 교문 ----------
for (const gt of DATA.gates ?? []) {
  const r = nearestRoad(gt.pos);
  if (!r || r.d > 40) continue;
  const gate = createGate({ name: gt.name, type: gt.type, pos: r.p, n: r.n, roadW: Math.max(r.w, 7) });
  gate.position.y = groundY(r.p[0], r.p[1]);
  scene.add(gate);
}

// ---------- 선구자상 ----------
const statuePoi = DATA.pois.find((p) => p.name.includes('선구자상'));
// 방향: 조사값(나침반 방위, 북=0° 시계방향) → 데이터 좌표계 각도(동=0, 반시계)
const statueBearing = DATA.statue?.facing_deg_from_north;
const statue = statuePoi
  ? createPioneerStatue(DATA.statue?.center ?? statuePoi.pos, Number.isFinite(statueBearing) ? THREE.MathUtils.degToRad(90 - statueBearing) : undefined)
  : null;
if (statue) {
  // 광장 바닥(로컬 0.62)이 지면 위 약 10 cm 에 오도록
  statue.group.position.y = groundY(statue.pos[0], statue.pos[1]) - 0.52;
  statue.floorY = statue.group.position.y + 0.62;
  statue.top.y += statue.group.position.y;
  scene.add(statue.group);
  const el = document.createElement('div');
  el.className = 'label';
  el.textContent = '선구자상';
  const label = new CSS2DObject(el);
  label.position.copy(statue.top);
  scene.add(label);
  statue.labelEl = el;
}

// 버스정류장 쉘터 (지붕 + 유리 뒷벽 + 기둥). 다른 POI 는 이름표만 지도에 둔다
function nearestRoad(pos) {
  let best = null, bd = Infinity;
  for (const r of DATA.roads) {
    for (let i = 1; i < r.pts.length; i++) {
      const [ax, ay] = r.pts[i - 1], [bx, by] = r.pts[i];
      const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1;
      const t = Math.max(0, Math.min(1, ((pos[0] - ax) * dx + (pos[1] - ay) * dy) / (L * L)));
      const d = Math.hypot(pos[0] - ax - dx * t, pos[1] - ay - dy * t);
      if (d < bd) { bd = d; best = { d, n: [-dy / L, dx / L], w: r.width, p: [ax + dx * t, ay + dy * t] }; }
    }
  }
  return best;
}
{
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x2f5f9e, roughness: 0.5 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0xbfd6e2, transparent: true, opacity: 0.45, roughness: 0.1 });
  const postMat = new THREE.MeshStandardMaterial({ color: 0xb9bdc2, metalness: 0.5, roughness: 0.4 });
  for (const p of DATA.pois) {
    if (p.kind !== 'bus_stop') continue;
    const r = nearestRoad(p.pos);
    if (!r || r.d > 25) continue;
    const side = Math.sign((p.pos[0] - r.p[0]) * r.n[0] + (p.pos[1] - r.p[1]) * r.n[1]) || 1;
    const off = r.w / 2 + 1.6;
    const g = new THREE.Group();
    const sx = r.p[0] + r.n[0] * side * off, sy = r.p[1] + r.n[1] * side * off;
    g.position.set(sx, groundY(sx, sy), -sy);
    g.rotation.y = Math.atan2(r.n[1] * side, r.n[0] * side);   // 로컬 +x = 도로 반대쪽(뒷벽 방향)
    const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; g.add(m); };
    add(new THREE.BoxGeometry(1.8, 0.12, 4), roofMat, 0.1, 2.65, 0);
    add(new THREE.BoxGeometry(0.06, 2.1, 3.8), glassMat, 0.85, 1.25, 0);
    for (const z of [-1.8, 1.8]) add(new THREE.CylinderGeometry(0.05, 0.05, 2.6, 8), postMat, 0.8, 1.3, z);
    add(new THREE.BoxGeometry(0.45, 0.08, 2.4), postMat, 0.55, 0.5, 0);   // 벤치
    scene.add(g);
  }
}

// ---------- 나무 ----------
const vegetation = createVegetation(DATA, { landmarks: statue?.blockers ?? [], pines: statue?.pines ?? [], avenues: DATA.avenues ?? [], heightAt: groundY, density: MOBILE ? 0.55 : 1 });
scene.add(vegetation.group);
$('#tree-count').textContent = vegetation.count.toLocaleString();

// ---------- 탐험 모드 ----------
// 미니맵 바탕 (1px = 1m)
function buildMinimap() {
  const all = BOUNDARIES.flatMap((bd) => bd.pts);
  const M = 220;
  const minX = Math.min(...all.map((p) => p[0])) - M, maxX = Math.max(...all.map((p) => p[0])) + M;
  const minY = Math.min(...all.map((p) => p[1])) - M, maxY = Math.max(...all.map((p) => p[1])) + M;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(maxX - minX);
  canvas.height = Math.ceil(maxY - minY);
  const g = canvas.getContext('2d');
  const path = (pts, close = true) => {
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x - minX, maxY - y) : g.moveTo(x - minX, maxY - y)));
    if (close) g.closePath();
  };
  g.fillStyle = '#c3cfae';
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = '#ece8dd';
  for (const bd of BOUNDARIES) { path(bd.pts); g.fill(); }
  for (const a of DATA.areas) {
    g.fillStyle = a.kind === 'pitch' ? '#7fb069' : a.kind === 'parking' ? '#d4d4cf' : '#b5cf98';
    path(a.outer); g.fill();
  }
  g.strokeStyle = '#ffffff';
  g.lineCap = g.lineJoin = 'round';
  for (const r of DATA.roads) { g.lineWidth = Math.max(2, r.width); path(r.pts, false); g.stroke(); }
  for (const b of DATA.buildings) {
    g.fillStyle = b.campus === 'medical' ? '#9aa9b8' : '#8f9aa6';
    g.strokeStyle = '#5d6772';
    g.lineWidth = 1;
    path(b.outer); g.fill(); g.stroke();
  }
  g.font = '500 13px "Noto Sans KR", sans-serif';
  g.textAlign = 'center';
  g.fillStyle = '#1d2430';
  for (const b of DATA.buildings) {
    if (!b.name) continue;
    const [cx, cy] = centroid(b.outer);
    g.fillText(b.name, cx - minX, maxY - cy + 4);
  }
  return { canvas, minX, maxY };
}

const explorer = createExplorer({
  heightAt: groundY,
  camera, renderer, data: DATA, sun, statue, amphi,
  trees: vegetation.trees,
  minimapSource: buildMinimap(),
  onEnter() {
    controls.enabled = false;
    // 외곽선은 도면 보기용 — 사람 눈높이에서는 숨김
    edgeLines.forEach((l) => (l.visible = false));
    fly = null;
    $('#info').classList.remove('show');
    document.body.classList.remove('info-open');
    fitViewport();
  },
  onExit() {
    controls.enabled = true;
    const edgesOn = $('#t-edges').getAttribute('aria-pressed') === 'true';
    edgeLines.forEach((l) => (l.visible = edgesOn));
    for (const b of DATA.buildings) if (b.labelEl) b.labelEl.style.opacity = '';
    fitViewport();
  },
  onInspect() {
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    const hit = raycaster.intersectObjects(pickables, false)[0];
    if (hit && hit.distance < 120) select(hit.object, { fly: false });
    else select(null);
  },
});
{
  const tp = $('#tp');
  for (const b of [...DATA.buildings].filter((x) => x.name).sort((a, c) => a.name.localeCompare(c.name, 'ko'))) {
    const o = document.createElement('option');
    o.value = String(b.id);
    o.textContent = b.name;
    tp.appendChild(o);
  }
  tp.addEventListener('change', () => {
    const b = DATA.buildings.find((x) => String(x.id) === tp.value);
    if (b) explorer.teleport(b);
    tp.value = '';
    tp.blur();
  });
}
$('#explore').addEventListener('click', () => explorer.enter(selected?.userData.b));

// ---------- 폭파 모드 ----------
const demolition = createDemolition({
  scene, camera, renderer, data: DATA, terrainMesh: terrain.mesh, buildingMeshes, heightAt: groundY, vegetation,
  onEnter() { select(null); hovered = null; refreshHighlights(); fitViewport(); },
  onExit() { fitViewport(); },
});
$('#demolish').addEventListener('click', () => demolition.enter());
if (MOBILE) {
  $('.demo-hint').textContent = '건물을 탭하면 맞은 자리가 맨 위층부터 한 층씩 부서져요 · 두 손가락: 회전·확대';
  $('#hint').textContent = '한 손가락: 이동 · 두 손가락: 회전·확대 · 건물 탭: 정보';
}

// ---------- 테마 · 계절 적용 ----------
function applyTheme(name) {
  const T = THEMES[name];
  skyMat.uniforms.top.value.set(T.skyTop);
  skyMat.uniforms.horizon.value.set(T.skyHorizon);
  scene.fog.color.set(T.skyHorizon);
  mats.ground.color.set(T.night ? 0x1c241d : 0x7f9568);
  terrain.setNight(T.night);
  mats.edge.color.set(T.edge);
  hemi.intensity = T.hemi;
  sun.intensity = T.sun;
  sun.color.set(T.sunColor);
  for (const m of facadeMats) m.emissiveIntensity = T.night ? 1 : 0;
  lampHeads.emissiveIntensity = T.night ? 2.2 : 0;
  statue?.setNight(T.night);
  document.documentElement.dataset.theme = name;
  $('#t-theme').setAttribute('aria-pressed', String(T.night));
}
applyTheme(matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

function applySeason(season) {
  vegetation.setSeason(season);
  document.querySelectorAll('.season').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.season === season)));
}
// 기본 계절: 오늘 날짜 기준
const month = new Date().getMonth() + 1;
applySeason(month >= 3 && month <= 5 ? 'spring' : month >= 9 && month <= 11 ? 'autumn' : 'summer');
document.querySelectorAll('.season').forEach((b) => b.addEventListener('click', () => applySeason(b.dataset.season)));

// ---------- 카메라 이동 ----------
const HOME = { pos: new THREE.Vector3(-380, 560 + groundY(0, -40), 620), target: new THREE.Vector3(0, groundY(0, -40), 40) };
camera.position.copy(HOME.pos);
controls.target.copy(HOME.target);
let fly = null;
function flyTo(pos, target, ms = 900) {
  fly = { p0: camera.position.clone(), t0: controls.target.clone(), p1: pos, t1: target, start: performance.now(), ms };
}
function focusOn(center, size, height, base = 0) {
  const target = center.clone().setY(base + height * 0.4);
  const dir = camera.position.clone().sub(controls.target).setY(0).normalize();
  if (!dir.lengthSq()) dir.set(0, 0, 1);
  const dist = Math.max(90, size * 2.6);
  flyTo(target.clone().addScaledVector(dir, dist * 0.8).setY(target.y + dist * 0.65), target);
}

// ---------- 선택 / 하이라이트 ----------
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const pickables = [...buildingMeshes, ...(statue ? [statue.hit] : [])];
const TINT = new THREE.Color(0x3d7be0);
let hovered = null, selected = null;

function tint(mesh, k) {
  if (!mesh.userData.base) return;
  [].concat(mesh.material).forEach((m, i) => m.color.copy(mesh.userData.base[i]).lerp(TINT, k));
}
function tintBuilding(mesh, k) {
  for (const m of mesh.userData.b?.meshes ?? [mesh]) tint(m, k);
}
function refreshHighlights() {
  for (const m of buildingMeshes) tint(m, 0);
  const hb = hovered?.userData.b, sb = selected?.userData.b;
  if (hovered && (!sb || hb !== sb)) tintBuilding(hovered, 0.25);
  if (selected) tintBuilding(selected, 0.55);
}

const KIND_LABEL = { university: '교육·연구', dormitory: '기숙사(생활관)', school: '실험·실습', yes: '기타' };
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const CONF_LABEL = { high: '높음', medium: '보통', low: '낮음' };
function showInfo({ name, nameEn, rows, estimated, basis, sources, confidence, official }) {
  $('#i-name').textContent = name;
  $('#i-en').textContent = nameEn ?? '';
  $('#i-rows').innerHTML = rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
  $('#i-est').style.display = estimated ? 'block' : 'none';
  const src = (sources ?? []).filter((s) => /^https?:\/\//.test(s.url)).slice(0, 4);
  $('#i-basis').innerHTML = basis || src.length
    ? `${confidence?.floors ? `<span class="conf conf-${esc(confidence.floors)}">층수 신뢰도 ${CONF_LABEL[confidence.floors] ?? esc(confidence.floors)}</span>` : ''}`
      + (basis ? `<p>${esc(basis)}</p>` : '')
      + (src.length ? `<p class="src">출처: ${src.map((s, i) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label || `[${i + 1}]`)}</a>`).join(' · ')}</p>` : '')
    : '';
  const guide = official?.floorGuide ?? [];
  $('#i-official').innerHTML = official
    ? (official.summary ? `<p>${esc(official.summary)}</p>` : '')
      + (guide.length ? `<details><summary>층별 안내 (${guide.length})</summary><ul>${guide.map((g) => `<li><b>${esc(g.floor)}</b> ${esc(g.use)}</li>`).join('')}</ul></details>` : '')
      + `<p class="src"><a href="${esc(official.source)}" target="_blank" rel="noopener">아주대 공식 캠퍼스맵</a>${official.photo ? ` · <a href="${esc(official.photo)}" target="_blank" rel="noopener">공식 사진</a>` : ''}</p>`
    : '';
  $('#info').classList.add('show');
  document.body.classList.add('info-open');
  fitViewport();
}

function select(mesh, { fly: doFly = true } = {}) {
  document.querySelectorAll('.label.sel').forEach((el) => el.classList.remove('sel'));
  selected = mesh;
  refreshHighlights();
  const id = mesh?.userData.b?.id;
  document.querySelectorAll('#list li').forEach((li) => li.classList.toggle('active', id !== undefined && li.dataset.id === String(id)));
  if (!mesh) { $('#info').classList.remove('show'); document.body.classList.remove('info-open'); fitViewport(); return; }

  if (statue && mesh === statue.hit) {
    statue.labelEl.classList.add('sel');
    showInfo(statue.info);
    if (doFly) focusOn(statue.top.clone(), 30, 8, statue.floorY);
    return;
  }
  const b = mesh.userData.b;
  b.labelEl?.classList.add('sel');
  const floors = b.levels ? `지상 ${b.levels}층${b.basement ? ` · 지하 ${b.basement}층` : ''}${b.estimated ? ' (추정)' : ''}` : '—';
  const rows = [
    ['층수', floors],
    ['높이', `약 ${Math.round(b.totalHeight ?? b.height)} m`],
    ['바닥 면적', `${b.area.toLocaleString()} m²`],
    ['용도', b.uses?.length ? b.uses.slice(0, 3).join(', ') : (KIND_LABEL[b.kind] ?? b.kind)],
  ];
  if (b.year) rows.push(['준공', `${b.year}년`]);
  if (terrain.ref) rows.push(['지면 해발', `약 ${Math.round((b.ground ?? 0) + terrain.ref)} m`]);
  if (b.parts?.length) rows.push(['형태', b.parts.map((p) => `${p.label} ${p.floors}층`).join(' · ')]);
  showInfo({
    official: b.official,
    name: b.name ?? b.identifiedAs ?? '이름 없는 건물',
    nameEn: b.nameEn,
    estimated: b.estimated,
    rows,
    basis: b.floorsBasis,
    sources: b.sources,
    confidence: b.confidence,
  });
  document.querySelector(`#list li[data-id="${b.id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  if (doFly) focusOn(b.center, Math.sqrt(b.area) + b.height, b.totalHeight ?? b.height, b.ground ?? 0);
}

function pick(e) {
  const r = renderer.domElement.getBoundingClientRect();
  pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  return raycaster.intersectObjects(pickables, false)[0]?.object ?? null;
}
renderer.domElement.addEventListener('pointermove', (e) => {
  if (explorer.active || demolition.active) return;
  const m = pick(e);
  if (m !== hovered) { hovered = m; refreshHighlights(); renderer.domElement.style.cursor = m ? 'pointer' : ''; }
});
let downAt = null;
renderer.domElement.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
const tapSlop = (e) => (e.pointerType === 'touch' ? 10 : 5);   // 손가락 탭은 약간 흔들려도 탭으로
renderer.domElement.addEventListener('pointerup', (e) => {
  if (explorer.active) return;
  if (demolition.active) {   // 드래그가 아닌 클릭 = 폭탄 투하
    if (downAt && Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) <= tapSlop(e)) demolition.click(e);
    return;
  }
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > tapSlop(e)) return;
  select(pick(e));
});
controls.addEventListener('start', () => { fly = null; });

// ---------- 사이드바 ----------
const named = DATA.buildings.filter((b) => b.name);
$('#count').textContent = DATA.buildings.length;
function renderList(q = '') {
  const items = named.filter((b) => b.name.includes(q) || (b.nameEn ?? '').toLowerCase().includes(q.toLowerCase()));
  $('#list').innerHTML = items.map((b) =>
    `<li data-id="${b.id}" class="${selected?.userData.b === b ? 'active' : ''}"><span>${b.name}</span><span class="meta">${b.levels ? b.levels + '층' : ''}${b.estimated ? '*' : ''}</span></li>`
  ).join('') || '<li style="cursor:default;color:var(--muted)">검색 결과가 없어요</li>';
}
renderList();
$('#search').addEventListener('input', (e) => renderList(e.target.value.trim()));
$('#search').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { const first = $('#list li[data-id]'); if (first) select(byId.get(first.dataset.id)); }
});
// ---------- 모바일 바텀시트 ----------
const sidebarEl = $('#sidebar');
const isSheet = () => innerWidth <= 720;
function setSheet(expanded) {
  sidebarEl.classList.toggle('expanded', expanded);
  $('#sheet-toggle').setAttribute('aria-expanded', String(expanded));
}
$('#sheet-toggle').addEventListener('click', () => setSheet(!sidebarEl.classList.contains('expanded')));
$('#search').addEventListener('focus', () => { if (isSheet()) setSheet(true); });
// 시트 높이에 맞춰 나침반 · 처음으로 버튼을 띄움
new ResizeObserver(() => document.documentElement.style.setProperty('--sheet-h', `${sidebarEl.offsetHeight}px`)).observe(sidebarEl);
$('#list').addEventListener('click', () => { if (isSheet()) { setSheet(false); $('#search').blur(); } });

$('#list').addEventListener('click', (e) => {
  const li = e.target.closest('li[data-id]');
  if (li) select(byId.get(li.dataset.id));
});
$('#info .close').addEventListener('click', () => select(null));

const toggle = (btn, fn) => btn.addEventListener('click', () => {
  const on = btn.getAttribute('aria-pressed') !== 'true';
  btn.setAttribute('aria-pressed', String(on));
  fn(on);
});
toggle($('#t-labels'), (on) => container.classList.toggle('labels-off', !on));
toggle($('#t-edges'), (on) => edgeLines.forEach((l) => (l.visible = on)));
toggle($('#t-top'), (on) => {
  const t = controls.target.clone();
  if (on) flyTo(t.clone().add(new THREE.Vector3(0, 900, 0.01)), t);
  else flyTo(HOME.pos.clone().sub(HOME.target).add(t), t);
});
$('#t-theme').addEventListener('click', () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
$('#reset').addEventListener('click', () => { $('#t-top').setAttribute('aria-pressed', 'false'); flyTo(HOME.pos.clone(), HOME.target.clone()); });
$('#compass').addEventListener('click', () => {
  const t = controls.target, d = camera.position.distanceTo(t), polar = controls.getPolarAngle();
  flyTo(new THREE.Vector3(t.x, t.y + d * Math.cos(polar), t.z + d * Math.sin(polar)), t.clone());
});

// ---------- 루프 ----------
const ease = (t) => 1 - Math.pow(1 - t, 3);
const compassSvg = $('#compass svg');
let lastTime = performance.now();
function tick(now) {
  const dt = (now - lastTime) / 1000;
  lastTime = now;
  if (explorer.active) explorer.update(dt);
  else if (fly) {
    const k = Math.min((now - fly.start) / fly.ms, 1), e = ease(k);
    camera.position.lerpVectors(fly.p0, fly.p1, e);
    controls.target.lerpVectors(fly.t0, fly.t1, e);
    if (k === 1) fly = null;
  }
  if (!explorer.active) controls.update();
  if (demolition.active) demolition.update(dt);
  statue?.update(now / 1000);
  sky.position.copy(camera.position);
  if (!explorer.active) compassSvg.style.transform = `rotate(${THREE.MathUtils.radToDeg(controls.getAzimuthalAngle())}deg)`;
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// 데스크톱에서는 사이드바만큼 화면 중심을 오른쪽으로 밀어 캠퍼스가 가려지지 않게
function fitViewport() {
  camera.aspect = innerWidth / innerHeight;
  const busy = document.body.classList.contains('exploring') || document.body.classList.contains('demolishing');
  const shift = innerWidth > 720 && !busy ? ($('#sidebar').offsetWidth + 16) / 2 : 0;
  // 모바일에서 정보창(바텀시트)이 열리면 화면 중심을 그만큼 위로 — 선택한 건물이 가려지지 않게
  const lift = innerWidth <= 720 && !busy && document.body.classList.contains('info-open') ? $('#info').offsetHeight / 2 : 0;
  if (shift || lift) camera.setViewOffset(innerWidth, innerHeight, -shift, lift, innerWidth, innerHeight);
  else camera.clearViewOffset();
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  labelRenderer.setSize(innerWidth, innerHeight);
}
fitViewport();
addEventListener('resize', fitViewport);

const loading = $('#loading');
loading.style.opacity = 0;
setTimeout(() => loading.remove(), 400);

// 다음 단계(탐험 모드)에서 재사용할 수 있도록 노출
window.campus = { scene, camera, controls, renderer, buildingMeshes, vegetation, statue, explorer, demolition, DATA };

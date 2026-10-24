// 선구자상: 사진 02(야경)·06(주간) 참고.
// 붉은 화강암 받침대 위 청동 기마상(한 팔을 들어 올린 기수), 둘레 분수, 붉은 벽돌 광장, 회양목 화단.
import * as THREE from 'three';


function brickTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#8a4a3a';
  g.fillRect(0, 0, 256, 256);
  const bw = 32, bh = 16;
  let s = 7;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let r = 0; r < 256 / bh; r++) {
    for (let k = -1; k < 256 / bw + 1; k++) {
      const t = rand();
      const base = t < 0.2 ? [176, 150, 128] : [150 + t * 40, 72 + t * 20, 58 + t * 12]; // 사진 06: 붉은 벽돌 + 간간이 밝은 벽돌
      g.fillStyle = `rgb(${base.map(Math.round).join(',')})`;
      g.fillRect(k * bw + (r % 2) * (bw / 2) + 1, r * bh + 1, bw - 2, bh - 2);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function horseAndRider(bronze) {
  const g = new THREE.Group();
  const add = (geo, [x, y, z], rot = [0, 0, 0]) => {
    const m = new THREE.Mesh(geo, bronze);
    m.position.set(x, y, z);
    m.rotation.set(...rot);
    m.castShadow = true;
    g.add(m);
    return m;
  };
  // 말 (머리가 +x 방향)
  add(new THREE.CapsuleGeometry(0.42, 1.05, 6, 12), [0, 1.45, 0], [0, 0, Math.PI / 2]);
  add(new THREE.SphereGeometry(0.46, 12, 10), [0.55, 1.52, 0]);
  add(new THREE.SphereGeometry(0.44, 12, 10), [-0.6, 1.5, 0]);
  add(new THREE.CylinderGeometry(0.2, 0.32, 0.95, 10), [0.88, 2.0, 0], [0, 0, -0.62]);
  add(new THREE.CapsuleGeometry(0.15, 0.42, 4, 10), [1.25, 2.28, 0], [0, 0, 1.15]);
  add(new THREE.ConeGeometry(0.05, 0.16, 6), [1.12, 2.62, 0.08], [0, 0, -0.3]);
  add(new THREE.ConeGeometry(0.05, 0.16, 6), [1.12, 2.62, -0.08], [0, 0, -0.3]);
  const leg = new THREE.CylinderGeometry(0.075, 0.095, 1.08, 8);
  add(leg, [-0.62, 0.55, 0.2]);
  add(leg, [-0.62, 0.55, -0.2]);
  add(leg, [0.6, 0.55, -0.2]);
  // 한쪽 앞다리를 들어 올린 자세 (사진 06)
  add(new THREE.CylinderGeometry(0.075, 0.095, 0.55, 8), [0.68, 1.0, 0.2], [0, 0, 0.5]);
  add(new THREE.CylinderGeometry(0.07, 0.08, 0.55, 8), [0.92, 0.82, 0.2], [0, 0, -0.5]);
  add(new THREE.ConeGeometry(0.13, 0.95, 8), [-1.05, 1.2, 0], [0, 0, 2.6]);
  // 기수
  add(new THREE.CylinderGeometry(0.17, 0.22, 0.7, 10), [0.0, 2.25, 0]);
  add(new THREE.SphereGeometry(0.14, 12, 10), [0.03, 2.75, 0]);
  add(new THREE.CylinderGeometry(0.08, 0.09, 0.7, 8), [0.15, 1.75, 0.3], [0.5, 0, 0.6]);
  add(new THREE.CylinderGeometry(0.08, 0.09, 0.7, 8), [0.15, 1.75, -0.3], [-0.5, 0, 0.6]);
  // 높이 든 오른팔 (사진 02·06의 실루엣)
  add(new THREE.CylinderGeometry(0.05, 0.06, 0.75, 8), [0.06, 2.85, -0.2], [0.25, 0, -0.12]);
  add(new THREE.SphereGeometry(0.07, 8, 8), [0.1, 3.24, -0.29]);
  // 고삐를 잡은 왼팔
  add(new THREE.CylinderGeometry(0.05, 0.06, 0.6, 8), [0.28, 2.22, 0.2], [0, 0, -1.0]);
  return g;
}

// 위성영상(VWorld) 판독 배치 — 수조 중심 기준 로컬 좌표(m, x=동, y=북)
const PLAZA_RECTS = [
  [-14.7, -12.5, 14.7, 12.5],   // 수조를 둘러싼 큰 사각 광장
  [-7, -27, 7, 23],             // 남북 띠
  [-25, -2.6, 25, 2.6],         // 동서 띠
];
const BASIN_HALF = 8.4, WATER_HALF = 6.0;

/**
 * 선구자상: 공식 캠퍼스맵 사진(57) + 위성영상.
 * 십자형 붉은 벽돌 광장, 계단식 정사각 수조, 회색 화강암 받침대 위 횃불 든 기수의 청동 기마상(동쪽을 향함).
 * @param pos [x, y] 수조 중심(데이터 좌표) @param facing 데이터 좌표계 각도(동=0, 반시계)
 */
export function createPioneerStatue(pos, facing = 0) {
  const root = new THREE.Group();
  root.name = '선구자상';
  root.position.set(pos[0], 0, -pos[1]);
  const rectShape = ([x0, y0, x1, y1]) => new THREE.Shape([new THREE.Vector2(x0, y0), new THREE.Vector2(x1, y0), new THREE.Vector2(x1, y1), new THREE.Vector2(x0, y1)]);

  // 십자형 벽돌 광장
  const brick = new THREE.MeshStandardMaterial({ map: brickTexture(), roughness: 0.95 });
  brick.map.repeat.set(1 / 2.5, 1 / 2.5);
  for (const r of PLAZA_RECTS) {
    const g = new THREE.ShapeGeometry(rectShape(r)).rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, brick);
    m.position.y = 0.62;
    m.receiveShadow = true;
    root.add(m);
  }
  // 남북 잔디 정원
  const lawn = new THREE.MeshStandardMaterial({ color: '#6f9a55', roughness: 1 });
  for (const [cx, cy] of [[0, 16], [1, -19.8]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(7.8, 0.3, 6.9), lawn);
    m.position.set(cx, 0.72, -cy);
    m.receiveShadow = true;
    root.add(m);
  }

  // 계단식 정사각 수조 (밝은 화강암 테두리 + 녹청색 물)
  const stone = new THREE.MeshStandardMaterial({ color: '#c9c4ba', roughness: 0.75 });
  const ringBox = (half, inner, h, y) => {
    const sh = new THREE.Shape([new THREE.Vector2(-half, -half), new THREE.Vector2(half, -half), new THREE.Vector2(half, half), new THREE.Vector2(-half, half)]);
    sh.holes.push(new THREE.Path([new THREE.Vector2(-inner, -inner), new THREE.Vector2(-inner, inner), new THREE.Vector2(inner, inner), new THREE.Vector2(inner, -inner)]));
    const g = new THREE.ExtrudeGeometry(sh, { depth: h, bevelEnabled: false }).rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, stone);
    m.position.y = y;
    m.castShadow = m.receiveShadow = true;
    root.add(m);
  };
  ringBox(BASIN_HALF, BASIN_HALF - 1.0, 0.25, 0.62);
  ringBox(BASIN_HALF - 1.0, WATER_HALF, 0.45, 0.62);
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(WATER_HALF * 2, WATER_HALF * 2).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: '#5f8f80', roughness: 0.06, metalness: 0.25, transparent: true, opacity: 0.88 })
  );
  water.position.y = 0.9;
  root.add(water);

  // 받침대 (회색 화강암, 2단) + 동판
  const granite = new THREE.MeshStandardMaterial({ color: '#8f8d88', roughness: 0.55 });
  const statue = new THREE.Group();
  const block = (w, h, d, y, mat = granite) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.y = y + h / 2;
    m.castShadow = m.receiveShadow = true;
    statue.add(m);
    return m;
  };
  block(6.4, 0.5, 4.0, 0.62, stone);   // 수조 가운데 단
  block(4.6, 1.3, 2.4, 1.12);
  block(3.9, 1.5, 2.0, 2.42);
  const plaque = block(1.1, 0.55, 0.05, 1.5, new THREE.MeshStandardMaterial({ color: '#25231f', metalness: 0.4, roughness: 0.45 }));
  plaque.position.z = 1.23;   // 정면(남쪽) — 先驅者像
  const bronze = new THREE.MeshStandardMaterial({ color: '#4d4438', metalness: 0.55, roughness: 0.45 });
  const rider = horseAndRider(bronze);
  rider.scale.setScalar(1.55);
  rider.position.y = 3.92;
  statue.add(rider);
  statue.rotation.y = facing;
  root.add(statue);

  // 분수 물줄기 — 물 가장자리를 따라 사각으로 (야간 사진 02)
  const jetMat = new THREE.MeshStandardMaterial({ color: '#eef7ff', emissive: '#000000', transparent: true, opacity: 0.45, roughness: 0.2, depthWrite: false });
  const jetGeo = new THREE.CylinderGeometry(0.06, 0.09, 1, 8, 1, true).translate(0, 0.5, 0);
  const sprayGeo = new THREE.SphereGeometry(0.3, 10, 8).scale(1, 0.7, 1);
  const jets = [];
  const jetAt = (x, y, h, phase) => {
    const column = new THREE.Mesh(jetGeo, jetMat), spray = new THREE.Mesh(sprayGeo, jetMat);
    column.position.set(x, 0.9, -y);
    spray.position.copy(column.position);
    root.add(column, spray);
    jets.push({ column, spray, h, phase });
  };
  const e = WATER_HALF - 0.8;
  for (let i = 0; i < 4; i++) {
    for (let k = 0; k < 5; k++) {
      const t = -e + (2 * e * k) / 4;
      const [x, y] = [[t, e], [e, -t], [-t, -e], [-e, t]][i];
      jetAt(x, y, 3.2, i * 5 + k);
    }
  }

  const glow = new THREE.PointLight('#ffb35a', 0, 40, 1.6);
  glow.position.set(0, 1.4, 0);
  root.add(glow);

  // 회양목 생울타리 — 큰 사각 광장의 네 귀퉁이를 따라 (사진 57)
  const hedgeMat = new THREE.MeshStandardMaterial({ color: '#3f6d31', roughness: 1 });
  const hedge = (x0, y0, x1, y1) => {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.55, Math.max(0.1, len - 1.1), 3, 8).rotateZ(Math.PI / 2), hedgeMat);
    m.position.set((x0 + x1) / 2, 1.0, -(y0 + y1) / 2);
    m.rotation.y = Math.atan2(y1 - y0, x1 - x0);
    m.scale.set(1, 0.8, 1.1);
    m.castShadow = m.receiveShadow = true;
    root.add(m);
  };
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      hedge(sx * 7.8, sy * 13.3, sx * 15.4, sy * 13.3);
      hedge(sx * 15.4, sy * 3.4, sx * 15.4, sy * 13.3);
    }
  }

  const hit = new THREE.Mesh(new THREE.BoxGeometry(BASIN_HALF * 2, 10, BASIN_HALF * 2), new THREE.MeshBasicMaterial({ visible: false }));
  hit.position.y = 5;
  root.add(hit);

  const toData = ([x0, y0, x1, y1]) => [[pos[0] + x0, pos[1] + y0], [pos[0] + x1, pos[1] + y0], [pos[0] + x1, pos[1] + y1], [pos[0] + x0, pos[1] + y1]];
  return {
    group: root,
    hit,
    pos,
    radius: 15,
    // 나무를 심지 않을 곳 · 탐험 모드 충돌/바닥 높이용 (데이터 좌표)
    blockers: PLAZA_RECTS.map((r) => ({ poly: toData([r[0] - 1.5, r[1] - 1.5, r[2] + 1.5, r[3] + 1.5]) })),
    basinPoly: toData([-BASIN_HALF, -BASIN_HALF, BASIN_HALF, BASIN_HALF]),
    contains: (x, y) => PLAZA_RECTS.some(([x0, y0, x1, y1]) => x >= pos[0] + x0 && x <= pos[0] + x1 && y >= pos[1] + y0 && y <= pos[1] + y1),
    // 사진 57: 수조 뒤(북쪽)와 양옆으로 늘어선 소나무
    pines: [[-20, 9], [-13, 17], [-20, 18], [13, 17], [20, 9], [20, 18], [-20, -9], [-13, -16], [13, -16], [20, -9], [-10, 22], [10, 22]]
      .map(([x, y]) => ({ x: pos[0] + x, y: pos[1] + y })),
    top: new THREE.Vector3(pos[0], 10.5, -pos[1]),
    info: {
      name: '선구자상', nameEn: 'Statue of Pioneer',
      rows: [['구성', '횃불 든 기수의 청동 기마상 · 사각 분수'], ['받침대', '회색 화강암 2단, 동판 「先驅者像」'], ['광장', '십자형 붉은 벽돌 포장 · 회양목 · 소나무'], ['참고', '공식 캠퍼스맵 57번 사진, 위성영상']],
    },
    update(t) {
      for (const j of jets) {
        const h = j.h * (0.88 + 0.12 * Math.sin(t * 2.2 + j.phase));
        j.column.scale.y = h;
        j.spray.position.y = 0.9 + h;
      }
    },
    setNight(on) {
      jetMat.color.set(on ? '#ffcf7a' : '#eef7ff');
      jetMat.emissive.set(on ? '#ff9a3a' : '#000000');
      jetMat.emissiveIntensity = on ? 0.9 : 0;
      jetMat.opacity = on ? 0.7 : 0.45;
      glow.intensity = on ? 60 : 0;
    },
  };
}

/**
 * 노천극장: 위성영상 판독(서쪽 반원 무대 + 동쪽 계단식 객석, 잔디 띠와 방사형 통로).
 * @param center [x, y] 무대 중심(데이터 좌표)
 */
export function createAmphitheater({ center = [-57, -125], stageR = 13, rIn = 14, rOut = 33, from = -80, to = 80, rows = 13, rise = 0.42 } = {}) {
  const root = new THREE.Group();
  root.name = '노천극장';
  root.position.set(center[0], 0, -center[1]);
  const concrete = new THREE.MeshStandardMaterial({ color: '#d2cfc6', roughness: 0.95 });
  const bench = new THREE.MeshStandardMaterial({ color: '#a9a59b', roughness: 0.9 });
  const grass = new THREE.MeshStandardMaterial({ color: '#86a05f', roughness: 1 });
  const stageMat = new THREE.MeshStandardMaterial({ color: '#c9c6bd', roughness: 0.9 });
  const meshes = [];
  const a0 = THREE.MathUtils.degToRad(from), a1 = THREE.MathUtils.degToRad(to);

  // 데이터 좌표계(동=0°, 반시계) 의 부채꼴 띠를 XY 평면 Shape 로 → rotateX 로 눕힘
  const sector = (r0, r1, s0, s1) => {
    const sh = new THREE.Shape();
    sh.absarc(0, 0, r1, s0, s1, false);
    sh.absarc(0, 0, r0, s1, s0, true);
    return sh;
  };
  const add = (geo, mat, y = 0) => {
    geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, mat);
    m.position.y = y;
    m.castShadow = m.receiveShadow = true;
    root.add(m);
    meshes.push(m);
    return m;
  };

  // 무대 (반원) + 무대 가장자리 단
  add(new THREE.ExtrudeGeometry(sector(0, stageR, a0 - 0.15, a1 + 0.15), { depth: 0.35, bevelEnabled: false }), stageMat);
  const arc = new THREE.Mesh(new THREE.TorusGeometry(stageR * 0.82, 0.12, 6, 48, a1 - a0 + 0.3), bench);
  arc.rotation.x = -Math.PI / 2;
  arc.rotation.z = a0 - 0.15;
  arc.position.y = 0.36;
  root.add(arc);

  // 객석: 바깥으로 갈수록 높아지는 계단, 4줄마다 잔디 띠
  const dr = (rOut - rIn) / rows;
  const aisles = [-45, 0, 45].map(THREE.MathUtils.degToRad);
  for (let i = 0; i < rows; i++) {
    const r0 = rIn + i * dr, r1 = r0 + dr, h = (i + 1) * rise;
    const isGrass = i % 4 === 3;
    add(new THREE.ExtrudeGeometry(sector(r0, r1, a0, a1), { depth: h, bevelEnabled: false, curveSegments: 40 }), isGrass ? grass : concrete);
    if (!isGrass) {
      // 좌석(벤치) 줄 — 통로 부분은 비움
      const edges = [a0, ...aisles, a1];
      for (let k = 0; k < edges.length - 1; k++) {
        const s0 = edges[k] + (k ? 0.035 : 0), s1 = edges[k + 1] - (k < edges.length - 2 ? 0.035 : 0);
        add(new THREE.ExtrudeGeometry(sector(r1 - dr * 0.45, r1 - dr * 0.12, s0, s1), { depth: 0.12, bevelEnabled: false, curveSegments: 24 }), bench, h);
      }
    }
  }
  // 무대 뒤 흰 곡면 벽과 학교 엠블럼 (공식 사진 82: 디아트 리모델링)
  const wallMat = new THREE.MeshStandardMaterial({ color: '#efeee9', roughness: 0.8 });
  const wb = THREE.MathUtils.degToRad(112), we = THREE.MathUtils.degToRad(248);
  add(new THREE.ExtrudeGeometry(sector(stageR + 0.6, stageR + 1.2, wb, we), { depth: 3.0, bevelEnabled: false, curveSegments: 40 }), wallMat);
  const emblem = new THREE.Mesh(new THREE.CircleGeometry(0.9, 32), new THREE.MeshStandardMaterial({ color: '#1f3f7a', roughness: 0.5 }));
  emblem.position.set(-(stageR + 0.55), 1.9, 0);
  emblem.rotation.y = Math.PI / 2;
  root.add(emblem);

  // 뒤쪽 잔디 경사
  add(new THREE.ExtrudeGeometry(sector(rOut, rOut + 3, a0, a1), { depth: rows * rise * 0.6, bevelEnabled: false, curveSegments: 40 }), grass);

  // 탐험 모드용: 데이터 좌표 (x, y) 의 바닥 높이
  function heightAt(x, y) {
    const dx = x - center[0], dy = y - center[1];
    const r = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
    if (a < a0 || a > a1) return r < stageR && Math.abs(a) < Math.PI / 2 + 0.15 ? 0.35 : 0;
    if (r < stageR) return 0.35;
    if (r < rIn) return 0;
    if (r < rOut) return (Math.floor((r - rIn) / dr) + 1) * rise;
    if (r < rOut + 3) return rows * rise * 0.6;
    return 0;
  }

  return { group: root, meshes, heightAt };
}

/**
 * 교문 (공식 캠퍼스맵 사진 참고)
 *  - portal: 정문 — 길 양쪽에 베이지 콘크리트 문틀
 *  - booth : 차단기 부스 + 차단봉
 *  - canopy: 부스 + 차단봉 + 청록색 곡면 캐노피 (동문 · 병원정문)
 * @param pos [x, y] 데이터 좌표, @param n [nx, ny] 도로를 가로지르는 방향(단위벡터), @param roadW 도로 폭
 */
export function createGate({ name, type, pos, n, roadW = 8 }) {
  const g = new THREE.Group();
  g.name = name;
  g.position.set(pos[0], 0, -pos[1]);
  g.rotation.y = Math.atan2(n[1], n[0]);   // 로컬 x = 도로를 가로지르는 방향
  const concrete = new THREE.MeshStandardMaterial({ color: '#d8d1c2', roughness: 0.9 });
  const yellow = new THREE.MeshStandardMaterial({ color: '#e7b416', roughness: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: '#3a3f44', roughness: 0.5 });
  const box = (w, h, d, x, y, z, mat) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    g.add(m);
    return m;
  };
  const half = roadW / 2;
  if (type === 'portal') {
    // 사진 55: 길 왼쪽 보도 위 낮은 문틀, 오른쪽 높은 기둥형 문틀
    for (const [side, w, h] of [[-1, 6.5, 5.2], [1, 3.2, 6.8]]) {
      const cx = side * (half + 1.2 + w / 2);
      box(0.9, h, 0.9, cx - w / 2, h / 2, 0, concrete);
      box(0.9, h, 0.9, cx + w / 2, h / 2, 0, concrete);
      box(w + 0.9, 1.1, 1.1, cx, h - 0.55, 0, concrete);
    }
  } else {
    // 중앙 부스 + 차단봉
    box(1.4, 2.5, 1.6, 0, 1.25, 0, yellow);
    box(1.6, 0.25, 1.8, 0, 2.6, 0, dark);
    box(1.8, 0.3, 4.5, 0, 0.15, 0, new THREE.MeshStandardMaterial({ color: '#2b2b2b' }));
    const arm = box(half - 0.6, 0.1, 0.1, (half - 0.6) / 2 + 0.7, 1.0, 1.0, new THREE.MeshStandardMaterial({ color: '#f2f2f2' }));
    arm.material.color.set('#e8e8e8');
    for (let k = 0; k < 4; k++) box(0.5, 0.11, 0.11, 1.2 + k * ((half - 1) / 4), 1.0, 1.0, new THREE.MeshStandardMaterial({ color: '#d62f2f' }));
    if (type === 'canopy') {
      const teal = new THREE.MeshStandardMaterial({ color: '#4fa6a0', roughness: 0.3, metalness: 0.2, transparent: true, opacity: 0.85, side: THREE.DoubleSide });
      const pole = new THREE.MeshStandardMaterial({ color: '#c8ccd0', metalness: 0.6, roughness: 0.35 });
      for (const side of [-1, 1]) {
        const cx = side * half * 0.5;
        const p = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 5.2, 10), pole);
        p.position.set(cx, 2.6, 0);
        p.castShadow = true;
        g.add(p);
        // 바깥쪽으로 들려 올라간 날개형 곡면 지붕 (사진 101 · 100)
        const w = half * 1.05, geo = new THREE.PlaneGeometry(w, 5, 16, 1);
        geo.rotateX(-Math.PI / 2);
        const pa = geo.attributes.position;
        for (let k = 0; k < pa.count; k++) {
          const lx = pa.getX(k) * side;           // 바깥쪽으로 갈수록 +
          pa.setY(k, 5.2 + 0.9 * Math.pow(Math.max(0, lx / (w / 2) + 0.2), 2));
        }
        geo.computeVertexNormals();
        const roof = new THREE.Mesh(geo, teal);
        roof.position.set(cx, 0, 0);
        roof.castShadow = true;
        g.add(roof);
      }
    }
  }
  return g;
}

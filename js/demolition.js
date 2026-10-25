// 캠퍼스 폭파 모드: 클릭한 곳에 폭탄이 떨어져 폭발하고, 내구도가 다 닳은 건물은 무너져 잔해가 된다.
// 모드를 나가거나 "복구"를 누르면 모든 건물 · 나무가 원래대로 돌아온다.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createFracture } from './fracture.js';

// floors: 부서지는 층 수, share: 맞은 건물 한 층 면적 중 부서지는 비율(소형 10%, 대형은 두 배)
const BOMBS = {
  small: { label: '소형', radius: 20, damage: 110, fire: 9, shake: 0.6, floors: 1, share: 0.10, rMin: 3.5, rMax: 12 },
  large: { label: '대형', radius: 42, damage: 320, fire: 20, shake: 1.6, floors: 2, share: 0.20, rMin: 5, rMax: 17 },
};
const DROP_HEIGHT = 140, GRAVITY = 60;

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

// 부드러운 원형 그라데이션 텍스처 (연기 · 불꽃 · 폭발 자국)
function radialTexture(inner, outer) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, inner);
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createDemolition({ scene, camera, renderer, data, terrainMesh, buildingMeshes, heightAt, vegetation, onEnter, onExit }) {
  const $ = (s) => document.querySelector(s);
  const hud = $('#demo-hud');
  let active = false, bombType = 'small', soundOn = true, audio = null;
  const bombs = [], effects = [], debris = [], collapsing = [], craters = [], rubbles = [];
  let shake = 0;
  const fracture = createFracture({ scene });

  const smokeTex = radialTexture('rgba(255,255,255,0.95)', 'rgba(255,255,255,0)');   // 색은 재질 color 로
  const fireTex = radialTexture('rgba(255,236,170,1)', 'rgba(255,90,10,0)');
  const craterTex = radialTexture('rgba(25,20,16,0.85)', 'rgba(40,32,24,0)');

  // 건물 상태
  const buildings = data.buildings.filter((b) => b.meshes?.length);
  for (const b of buildings) {
    b.hpMax = 60 + Math.sqrt(b.area) * 2.2 + (b.totalHeight ?? 10) * 1.5;   // 크고 높은 건물일수록 튼튼
    b.hp = b.hpMax;
  }
  const destroyedCount = () => buildings.filter((b) => b.destroyed).length;
  const damagedCount = () => buildings.filter((b) => b.destroyed || fracture.fraction(b) > 0).length;
  const updateHud = () => { $('#demo-count').textContent = `${damagedCount()}동 피해 · ${destroyedCount()}동 붕괴`; };

  // ---- 소리 (WebAudio 로 합성 — 외부 파일 없음) ----
  function ctx() {
    if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
    return audio;
  }
  function whistle(duration) {
    if (!soundOn) return;
    const a = ctx(), o = a.createOscillator(), g = a.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(1400, a.currentTime);
    o.frequency.exponentialRampToValueAtTime(320, a.currentTime + duration);
    g.gain.setValueAtTime(0.0001, a.currentTime);
    g.gain.exponentialRampToValueAtTime(0.06, a.currentTime + 0.2);
    g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + duration);
    o.connect(g).connect(a.destination);
    o.start();
    o.stop(a.currentTime + duration);
  }
  function boom(big, distance) {
    if (!soundOn) return;
    const a = ctx(), len = big ? 2.6 : 1.6;
    const buf = a.createBuffer(1, a.sampleRate * len, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, big ? 2.2 : 3);
    const src = a.createBufferSource(), lp = a.createBiquadFilter(), g = a.createGain();
    src.buffer = buf;
    lp.type = 'lowpass';
    lp.frequency.value = big ? 500 : 900;
    g.gain.value = Math.min(1, (big ? 1.1 : 0.8) * 250 / (250 + distance));
    src.connect(lp).connect(g).connect(a.destination);
    src.start();
  }

  // ---- 폭탄 ----
  const bombGeo = mergeGeometries([
    new THREE.CapsuleGeometry(0.55, 1.6, 6, 12),
    new THREE.BoxGeometry(1.6, 0.06, 0.5).translate(0, 1.15, 0),
    new THREE.BoxGeometry(0.06, 0.5, 1.6).translate(0, 1.15, 0).rotateY(0),
    new THREE.BoxGeometry(0.06, 1.6, 0.5).translate(0, 1.15, 0).rotateY(Math.PI / 2),
  ].map((g) => (g.index ? g.toNonIndexed() : g)).map((g) => { g.deleteAttribute('uv'); return g; }));
  const bombMat = new THREE.MeshStandardMaterial({ color: 0x3b4148, metalness: 0.6, roughness: 0.35 });

  /** 클릭한 점(벽이면 그 층, 지붕이면 꼭대기 층)을 향해 카메라 쪽 하늘에서 비스듬히 떨어짐 */
  function drop(point, target) {
    const type = BOMBS[bombType];
    const x = point.x, y = -point.z;
    const ground = heightAt(x, y);
    const back = new THREE.Vector3(camera.position.x - x, 0, camera.position.z + y).normalize().multiplyScalar(55);
    const start = point.clone().add(back).add(new THREE.Vector3(0, DROP_HEIGHT, 0));
    const mesh = new THREE.Mesh(bombGeo, bombMat);
    mesh.castShadow = true;
    mesh.scale.setScalar(bombType === 'large' ? 1.8 : 1);
    mesh.position.copy(start);
    // 꼬리 날개(+y)가 날아온 쪽을 향하게
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), start.clone().sub(point).normalize());
    scene.add(mesh);
    const fall = Math.sqrt((2 * DROP_HEIGHT) / GRAVITY);
    bombs.push({ mesh, x, y, impactY: point.y, ground, start, point: point.clone(), target, t: 0, fall, type });
    whistle(fall);
  }

  function explode(b) {
    const { x, y, impactY, ground, type } = b;
    const pos = new THREE.Vector3(x, impactY, -y);
    scene.remove(b.mesh);
    // 섬광
    const light = new THREE.PointLight(0xffa040, 0, type.radius * 6, 1.4);
    light.position.copy(pos).add(new THREE.Vector3(0, 4, 0));
    scene.add(light);
    // 불덩이
    const fire = new THREE.Sprite(new THREE.SpriteMaterial({ map: fireTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    fire.position.copy(pos);
    scene.add(fire);
    // 충격파 고리 (지면)
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xfff1d0, transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide }));
    ring.position.set(x, ground + 0.4, -y);
    scene.add(ring);
    effects.push({ t: 0, light, fire, ring, type });
    // 연기 기둥
    for (let i = 0; i < (type === BOMBS.large ? 26 : 14); i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, depthWrite: false, transparent: true, opacity: 0, color: new THREE.Color().setHSL(0.08, 0.06, 0.18 + Math.random() * 0.15) }));
      s.position.copy(pos).add(new THREE.Vector3((Math.random() - 0.5) * type.fire, Math.random() * 3, (Math.random() - 0.5) * type.fire));
      scene.add(s);
      effects.push({ smoke: s, t: -Math.random() * 0.5, life: 6 + Math.random() * 4, vy: 4 + Math.random() * 7, grow: type.fire * (1.6 + Math.random() * 1.6), max: 0.9 });
    }
    // 파편
    spawnDebris(pos, type === BOMBS.large ? 40 : 22, 0x7d766c, type.fire);
    // 폭발 자국
    const crater = new THREE.Mesh(new THREE.CircleGeometry(type.radius * 0.45, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: craterTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
    crater.position.set(x, ground + 0.25, -y);
    crater.renderOrder = 2;
    scene.add(crater);
    craters.push(crater);
    // 나무 쓰러뜨림
    vegetation?.blast?.(x, y, type.radius * 0.7);
    // 화면 흔들림 · 소리
    const dist = camera.position.distanceTo(pos);
    shake = Math.max(shake, type.shake * Math.min(1, 400 / (dist + 60)));
    boom(type === BOMBS.large, dist);
    // 건물 피해 — 맞은 층 · 범위만 부서짐
    const hitB = b.target && !b.target.destroyed ? b.target : null;
    if (hitB?.masses?.length) partialDamage(hitB, b.point, type);
    else {
      // 땅에 떨어지면 가까운 건물의 1층(대형은 2층까지) 옆구리가 부서짐
      for (const bd of buildings) {
        if (bd.destroyed || bd === hitB) continue;
        const d = distToPoly(x, y, bd.outer);
        if (d > type.radius * 0.35) continue;
        if (bd.masses?.length) partialDamage(bd, new THREE.Vector3(x, (bd.ground ?? ground) + 0.5, -y), type);
        else hpDamage(bd, type, d);
      }
      if (hitB) hpDamage(hitB, type, 0);   // 노천극장처럼 칸으로 나누지 않는 구조물
    }
  }

  function partialDamage(bd, point, type) {
    const removed = fracture.blast(bd, point, type.floors, { share: type.share, rMax: type.rMax });
    if (!removed.length) return;
    // 부서진 칸 자리에서 파편 · 먼지, 바닥엔 잔해
    const sample = removed.filter((_, i) => i % Math.max(1, Math.floor(removed.length / 12)) === 0);
    for (const c of sample) spawnDebris(new THREE.Vector3(c.x, c.z, -c.y), c.fell ? 2 : 4, 0x8f897f, 6);
    for (const c of removed.filter((_, i) => i % 2 === 0).slice(0, 40)) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, depthWrite: false, transparent: true, opacity: 0, color: 0xc9c0b0 }));
      sp.position.set(c.x, c.z, -c.y);
      scene.add(sp);
      effects.push({ smoke: sp, t: -Math.random() * 0.6, life: 4 + Math.random() * 3, vy: 1 + Math.random() * 2, grow: 8 + Math.random() * 8, max: 0.7 });
    }
    addRubble(removed, bd);
    if (fracture.fraction(bd) >= 0.8) collapse(bd);   // 대부분 부서지면 나머지도 무너짐
    updateHud();
  }

  // 부서진 칸 아래 땅에 잔해 조각
  function addRubble(removed, bd) {
    const geos = [];
    for (const c of removed) {
      for (let k = 0; k < 2; k++) {
        const w = 0.8 + Math.random() * 2.4, h = 0.4 + Math.random() * 1.4, d = 0.8 + Math.random() * 2.4;
        const x = c.x + (Math.random() - 0.5) * 3, y = c.y + (Math.random() - 0.5) * 3;
        const g = new THREE.BoxGeometry(w, h, d).rotateY(Math.random() * Math.PI).rotateX((Math.random() - 0.5) * 0.6);
        g.translate(x, Math.max(heightAt(x, y), bd.ground ?? -Infinity) + h * 0.3, -y);
        geos.push(g.toNonIndexed());
      }
    }
    if (!geos.length) return;
    const rubble = new THREE.Mesh(mergeGeometries(geos), new THREE.MeshStandardMaterial({ color: 0x8e877c, roughness: 1, flatShading: true }));
    rubble.castShadow = rubble.receiveShadow = true;
    scene.add(rubble);
    rubbles.push(rubble);
  }

  function hpDamage(bd, type, d) {
    bd.hp -= type.damage * (1 - d / type.radius) ** 1.3;
    const ratio = Math.max(0, 1 - bd.hp / bd.hpMax);
    for (const m of bd.meshes) {   // 그을림
      [].concat(m.material).forEach((mt, i) => mt.color.copy(m.userData.base?.[i] ?? mt.color).multiplyScalar(1 - 0.65 * ratio));
    }
    if (bd.hp <= 0) collapse(bd);
    updateHud();
  }

  function spawnDebris(pos, n, color, spread) {
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.9 });
    for (let i = 0; i < n; i++) {
      const s = 0.3 + Math.random() * 1.1;
      const m = new THREE.Mesh(new THREE.BoxGeometry(s, s * 0.7, s * 1.2), mat);
      m.position.copy(pos).add(new THREE.Vector3((Math.random() - 0.5) * spread * 0.4, 1 + Math.random() * 2, (Math.random() - 0.5) * spread * 0.4));
      m.castShadow = true;
      scene.add(m);
      const a = Math.random() * Math.PI * 2, sp = 8 + Math.random() * 22;
      debris.push({ m, v: new THREE.Vector3(Math.cos(a) * sp, 12 + Math.random() * 26, Math.sin(a) * sp), spin: new THREE.Vector3(Math.random() * 6, Math.random() * 6, Math.random() * 6), t: 0 });
    }
  }

  // ---- 건물 붕괴 ----
  function collapse(bd) {
    bd.destroyed = true;
    if (bd.labelObj) bd.labelObj.visible = false;   // 라벨 렌더러가 표시 상태를 매 프레임 갱신하므로 객체를 숨김
    for (const e of bd.edges ?? []) e.visible = false;
    collapsing.push({ bd, meshes: fracture.meshesOf(bd), t: 0, depth: (bd.totalHeight ?? 10) + 6 });
    // 먼지 구름
    const c = bd.outer.reduce((a, p) => [a[0] + p[0] / bd.outer.length, a[1] + p[1] / bd.outer.length], [0, 0]);
    const g = bd.ground ?? heightAt(c[0], c[1]);
    for (let i = 0; i < 30; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, depthWrite: false, transparent: true, opacity: 0, color: 0xcfc6b6 }));
      const p = bd.outer[Math.floor(Math.random() * bd.outer.length)];
      const k = Math.random();
      s.position.set(p[0] * k + c[0] * (1 - k), g + Math.random() * 4, -(p[1] * k + c[1] * (1 - k)));
      scene.add(s);
      effects.push({ smoke: s, t: -Math.random() * 1.2, life: 6 + Math.random() * 4, vy: 1.5 + Math.random() * 2.5, grow: 18 + Math.random() * 22, max: 0.85 });
    }
    spawnDebris(new THREE.Vector3(c[0], g + (bd.totalHeight ?? 10) * 0.6, -c[1]), 30, 0x9a9184, 18);
    // 잔해 더미
    const xs = bd.outer.map((p) => p[0]), ys = bd.outer.map((p) => p[1]);
    const geos = [];
    const n = Math.min(160, 25 + Math.round(bd.area / 25));
    for (let i = 0, tries = 0; i < n && tries < n * 6; tries++) {
      const x = Math.min(...xs) + Math.random() * (Math.max(...xs) - Math.min(...xs));
      const y = Math.min(...ys) + Math.random() * (Math.max(...ys) - Math.min(...ys));
      if (!pointInPoly(x, y, bd.outer)) continue;
      const w = 1.5 + Math.random() * 4, h = 0.6 + Math.random() * Math.min(5, (bd.totalHeight ?? 10) * 0.25), d = 1.5 + Math.random() * 4;
      const geo = new THREE.BoxGeometry(w, h, d);
      geo.rotateX((Math.random() - 0.5) * 0.7).rotateY(Math.random() * Math.PI).rotateZ((Math.random() - 0.5) * 0.7);
      geo.translate(x, heightAt(x, y) + h * 0.3, -y);
      geos.push(geo.toNonIndexed());
      i++;
    }
    if (geos.length) {
      const tone = new THREE.Color(0xb3aa9c);
      const rubble = new THREE.Mesh(mergeGeometries(geos), new THREE.MeshStandardMaterial({ color: tone.multiplyScalar(0.75), roughness: 1, flatShading: true }));
      rubble.castShadow = rubble.receiveShadow = true;
      rubble.position.y = -6;
      scene.add(rubble);
      rubbles.push(rubble);
      collapsing[collapsing.length - 1].rubble = rubble;
    }
    updateHud();
  }

  // ---- 입력 ----
  const raycaster = new THREE.Raycaster();
  function click(e) {
    if (!active) return;
    const r = renderer.domElement.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
    const targets = [...buildingMeshes.filter((m) => m.visible), ...fracture.pickable.filter((m) => m.visible), ...(terrainMesh ? [terrainMesh] : [])];
    const hit = raycaster.intersectObjects(targets, false)[0];
    if (!hit) return;
    const bd = hit.object.userData.b ?? null;
    const point = hit.point.clone();
    if (bd?.masses?.length && !bd.destroyed) {
      // 위층부터 부서지므로 폭탄은 맞은 자리의 남은 맨 위(지붕)에 떨어짐
      const top = fracture.topAt(bd, point.x, -point.z);
      if (top != null) point.y = top;
    }
    drop(point, bd);
  }

  function restore() {
    for (const bd of buildings) fracture.restore(bd);
    for (const bd of buildings) {
      bd.destroyed = false;
      bd.hp = bd.hpMax;
      if (bd.labelObj) bd.labelObj.visible = true;
      for (const e of bd.edges ?? []) e.visible = $('#t-edges')?.getAttribute('aria-pressed') !== 'false';
      for (const m of bd.meshes) {
        m.visible = true;
        m.position.set(0, 0, 0);
        [].concat(m.material).forEach((mt, i) => m.userData.base?.[i] && mt.color.copy(m.userData.base[i]));
      }
    }
    for (const o of [...rubbles.splice(0), ...craters.splice(0)]) { scene.remove(o); o.geometry.dispose(); }
    for (const b of bombs.splice(0)) scene.remove(b.mesh);
    for (const d of debris.splice(0)) scene.remove(d.m);
    for (const e of effects.splice(0)) for (const o of [e.light, e.fire, e.ring, e.smoke]) if (o) scene.remove(o);
    collapsing.length = 0;
    vegetation?.restoreAll?.();
    scene.position.set(0, 0, 0);
    shake = 0;
    updateHud();
  }

  function enter() {
    if (active) return;
    active = true;
    hud.hidden = false;
    document.body.classList.add('demolishing');
    updateHud();
    onEnter?.();
  }
  function exit() {
    if (!active) return;
    active = false;
    restore();
    hud.hidden = true;
    document.body.classList.remove('demolishing');
    onExit?.();
  }

  document.querySelectorAll('.bomb-type').forEach((btn) => btn.addEventListener('click', () => {
    bombType = btn.dataset.bomb;
    document.querySelectorAll('.bomb-type').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
  }));
  $('#demo-restore').addEventListener('click', restore);
  $('#demo-exit').addEventListener('click', exit);
  $('#demo-sound').addEventListener('click', (e) => {
    soundOn = !soundOn;
    e.currentTarget.setAttribute('aria-pressed', String(soundOn));
    e.currentTarget.textContent = soundOn ? '🔊 소리' : '🔇 소리';
  });

  // ---- 매 프레임 ----
  function update(dt) {
    dt = Math.min(dt, 0.05);
    for (let i = bombs.length - 1; i >= 0; i--) {
      const b = bombs[i];
      b.t += dt;
      const k = Math.min(1, b.t / b.fall);
      b.mesh.position.lerpVectors(b.start, b.point, k * k);   // 점점 빨라지며 맞은 점으로
      if (k >= 1) { bombs.splice(i, 1); explode(b); }
    }
    for (let i = effects.length - 1; i >= 0; i--) {
      const e = effects[i];
      e.t += dt;
      if (e.smoke) {
        if (e.t < 0) continue;
        const k = e.t / e.life;
        e.smoke.position.y += e.vy * dt * (1 - k * 0.6);
        e.smoke.scale.setScalar(2 + e.grow * Math.sqrt(k));
        e.smoke.material.opacity = Math.min(e.max ?? 0.75, e.t * 2.5) * (1 - k) ** 0.7;
        if (k >= 1) { scene.remove(e.smoke); effects.splice(i, 1); }
        continue;
      }
      const R = e.type.fire, k = e.t;
      e.fire.scale.setScalar(R * 2.4 * Math.min(1, k / 0.25) * (1 + k * 0.3));
      e.fire.material.opacity = Math.max(0, 1 - k / 1.1);
      e.light.intensity = Math.max(0, 1 - k / 0.8) * (e.type === BOMBS.large ? 9000 : 3500);
      e.ring.scale.setScalar(1 + k * e.type.radius * 2.2);
      e.ring.material.opacity = Math.max(0, 0.7 * (1 - k / 0.9));
      if (k > 1.4) { for (const o of [e.light, e.fire, e.ring]) scene.remove(o); effects.splice(i, 1); }
    }
    for (let i = debris.length - 1; i >= 0; i--) {
      const d = debris[i];
      d.t += dt;
      d.v.y -= 35 * dt;
      d.m.position.addScaledVector(d.v, dt);
      d.m.rotation.x += d.spin.x * dt; d.m.rotation.y += d.spin.y * dt; d.m.rotation.z += d.spin.z * dt;
      const g = heightAt(d.m.position.x, -d.m.position.z);
      if (d.m.position.y < g + 0.2) {
        d.m.position.y = g + 0.2;
        d.v.multiplyScalar(0.35); d.v.y = Math.abs(d.v.y) * 0.4;
        d.spin.multiplyScalar(0.5);
      }
      if (d.t > 6) { scene.remove(d.m); debris.splice(i, 1); }
    }
    for (let i = collapsing.length - 1; i >= 0; i--) {
      const c = collapsing[i];
      c.t += dt;
      const k = Math.min(1, c.t / 2.6), sink = c.depth * k * k;
      const jitter = (1 - k) * 0.6;
      for (const m of c.meshes) m.position.set((Math.random() - 0.5) * jitter, -sink, (Math.random() - 0.5) * jitter);
      if (c.rubble) c.rubble.position.y = -6 + 6 * Math.min(1, k * 1.4);
      if (k >= 1) { for (const m of c.meshes) m.visible = false; collapsing.splice(i, 1); }
    }
    // 화면 흔들림 — 장면 전체를 살짝 흔듦(카메라 조작과 충돌하지 않게)
    if (shake > 0.001) {
      scene.position.set((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
      shake *= Math.pow(0.04, dt);
    } else if (scene.position.lengthSq()) scene.position.set(0, 0, 0);
  }

  return { enter, exit, update, click, restore, get active() { return active; } };
}

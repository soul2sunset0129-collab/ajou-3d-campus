// 캠퍼스 탐험 모드: 사람 눈높이 1인칭 시점으로 캠퍼스를 걸어 다닌다.
//  - PC: 화면 클릭 → 마우스로 둘러보기, WASD/방향키 이동, Shift 달리기, 클릭으로 건물 정보, ESC 일시정지
//  - 모바일: 왼쪽 아래 조이스틱으로 이동, 화면 드래그로 둘러보기, 짧게 탭하면 건물 정보
//  - 건물 외곽선 · 나무 줄기 · 분수대와 충돌, 노천극장 계단과 광장 단차는 높이를 따라감
import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

const EYE = 1.65;          // m — 눈높이
const RADIUS = 0.35;       // m — 몸 반지름
const WALK = 4.2, RUN = 10; // m/s (캠퍼스가 넓어 실제 보행보다 조금 빠르게)
const LOOK = 0.0023;

const v2 = (x, y) => new THREE.Vector2(x, y);

function closestOnSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return [ax + dx * t, ay + dy * t];
}
function pointInPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function createExplorer({ camera, renderer, data, sun, statue, amphi, trees, minimapSource, onEnter, onExit, onInspect, heightAt = () => 0 }) {
  const $ = (s) => document.querySelector(s);
  const hud = $('#explore-hud');
  const plc = new PointerLockControls(camera, renderer.domElement);
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const keys = new Set();
  const pos = v2(0, 0);          // 데이터 좌표 (x=동, y=북)
  let eyeY = EYE, active = false, saved = null;
  const touchMove = v2(0, 0);

  // ---- 충돌 대상 ----
  const solids = data.buildings
    .filter((b) => (b.osmName ?? b.name) !== '노천극장')
    .map((b) => {
      const xs = b.outer.map((p) => p[0]), ys = b.outer.map((p) => p[1]);
      return { b, pts: b.outer, box: [Math.min(...xs) - 2, Math.min(...ys) - 2, Math.max(...xs) + 2, Math.max(...ys) + 2] };
    });
  const CELL = 8;
  const treeGrid = new Map();
  for (const t of trees ?? []) {
    const k = `${Math.floor(t.x / CELL)},${Math.floor(t.y / CELL)}`;
    if (!treeGrid.has(k)) treeGrid.set(k, []);
    treeGrid.get(k).push(t);
  }
  const circles = [];
  if (statue?.basinPoly) {
    const xs = statue.basinPoly.map((p) => p[0]), ys = statue.basinPoly.map((p) => p[1]);
    solids.push({ b: { name: '선구자상' }, pts: statue.basinPoly, box: [Math.min(...xs) - 2, Math.min(...ys) - 2, Math.max(...xs) + 2, Math.max(...ys) + 2] });
  }

  function collide(p) {
    for (let iter = 0; iter < 3; iter++) {
      for (const s of solids) {
        const [x0, y0, x1, y1] = s.box;
        if (p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1) continue;
        const inside = pointInPoly(p.x, p.y, s.pts);
        let best = null, bd = Infinity;
        for (let i = 0; i < s.pts.length; i++) {
          const a = s.pts[i], c = s.pts[(i + 1) % s.pts.length];
          const q = closestOnSegment(p.x, p.y, a[0], a[1], c[0], c[1]);
          const d = Math.hypot(p.x - q[0], p.y - q[1]);
          if (d < bd) { bd = d; best = q; }
        }
        if (inside || bd < RADIUS) {
          let nx = p.x - best[0], ny = p.y - best[1];
          const len = Math.hypot(nx, ny) || 1;
          nx /= len; ny /= len;
          if (inside) { nx = -nx; ny = -ny; }
          p.set(best[0] + nx * RADIUS, best[1] + ny * RADIUS);
        }
      }
      const cx = Math.floor(p.x / CELL), cy = Math.floor(p.y / CELL);
      for (let i = -1; i <= 1; i++) {
        for (let j = -1; j <= 1; j++) {
          for (const t of treeGrid.get(`${cx + i},${cy + j}`) ?? []) {
            const r = 0.28 * t.s + RADIUS, d = Math.hypot(p.x - t.x, p.y - t.y);
            if (d < r && d > 1e-6) p.set(t.x + ((p.x - t.x) / d) * r, t.y + ((p.y - t.y) / d) * r);
          }
        }
      }
      for (const c of circles) {
        const d = Math.hypot(p.x - c.x, p.y - c.y);
        if (d < c.r) p.set(c.x + ((p.x - c.x) / (d || 1)) * c.r, c.y + ((p.y - c.y) / (d || 1)) * c.r);
      }
    }
    return p;
  }

  function groundAt(x, y) {
    let h = heightAt(x, y);                                     // 실제 지형
    if (amphi) { const a = amphi.heightAt(x, y); if (a > 0) h = Math.max(h, (amphi.base ?? 0) + a); }   // 노천극장 계단
    if (statue?.contains?.(x, y)) h = Math.max(h, statue.floorY ?? 0.62);                            // 선구자상 광장
    return h;
  }


  function treeWithin(p, r) {
    const cx = Math.floor(p.x / CELL), cy = Math.floor(p.y / CELL), n = Math.ceil(r / CELL);
    for (let i = -n; i <= n; i++) {
      for (let j = -n; j <= n; j++) {
        for (const t of treeGrid.get(`${cx + i},${cy + j}`) ?? []) if (Math.hypot(p.x - t.x, p.y - t.y) < r) return true;
      }
    }
    return false;
  }

  // 건물 앞의 빈 자리 찾기 (순간이동용) — 건물·분수대와 겹치지 않고 머리 위에 나무가 없는 곳
  function spotNear(b) {
    const c = b.outer.reduce((a, p) => [a[0] + p[0] / b.outer.length, a[1] + p[1] / b.outer.length], [0, 0]);
    // 건물 전체가 눈에 들어오도록 가장 먼 꼭짓점보다 18 m 바깥에서 시작
    const reach = Math.max(...b.outer.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1]))) + 18;
    for (let r = reach; r < reach + 60; r += 4) {
      for (let k = 0; k < 16; k++) {
        const a = -Math.PI / 2 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 8); // 남쪽부터 탐색
        const p = v2(c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r);
        const before = p.clone();
        collide(p);
        if (p.distanceTo(before) < 0.01 && !treeWithin(p, 5)) return { p, look: c };
      }
    }
    return { p: v2(c[0], c[1] - reach), look: c };
  }

  function placeAt(p, look) {
    pos.copy(p);
    eyeY = groundAt(p.x, p.y) + EYE;
    camera.position.set(p.x, eyeY, -p.y);
    if (look) {
      // 카메라는 -z 가 앞. 월드 방향 (dx, dz) 를 바라보도록 yaw 설정
      const dx = look[0] - p.x, dz = -look[1] + p.y;
      euler.set(0.08, Math.atan2(-dx, -dz), 0, 'YXZ');
      camera.quaternion.setFromEuler(euler);
    }
  }

  // ---- 미니맵 ----
  const mini = $('#minimap');
  const mctx = mini.getContext('2d');
  function drawMinimap() {
    const { canvas, minX, maxY } = minimapSource;
    const W = mini.width, H = mini.height, span = 260; // m
    mctx.clearRect(0, 0, W, H);
    mctx.save();
    mctx.beginPath();
    mctx.arc(W / 2, H / 2, W / 2 - 2, 0, Math.PI * 2);
    mctx.clip();
    mctx.drawImage(canvas, pos.x - minX - span / 2, maxY - pos.y - span / 2, span, span, 0, 0, W, H);
    mctx.restore();
    euler.setFromQuaternion(camera.quaternion, 'YXZ');
    mctx.save();
    mctx.translate(W / 2, H / 2);
    mctx.rotate(-euler.y);
    mctx.fillStyle = '#0a4da2';
    mctx.strokeStyle = '#fff';
    mctx.lineWidth = 2;
    mctx.beginPath();
    mctx.moveTo(0, -9); mctx.lineTo(6, 6); mctx.lineTo(0, 3); mctx.lineTo(-6, 6); mctx.closePath();
    mctx.fill(); mctx.stroke();
    mctx.restore();
  }

  // ---- 입력 ----
  const onKey = (e, down) => {
    if (!active) return;
    const k = e.code;
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight'].includes(k)) {
      down ? keys.add(k) : keys.delete(k);
      e.preventDefault();
    }
  };
  addEventListener('keydown', (e) => onKey(e, true));
  addEventListener('keyup', (e) => onKey(e, false));
  addEventListener('blur', () => keys.clear());

  const isTouch = matchMedia('(pointer: coarse)').matches;
  // ---- 둘러보기: 마우스 잠금(가능할 때) / 마우스 드래그(잠금이 막힌 환경 — 앱 미리보기, iframe 등) ----
  const lockSupported = !isTouch && 'requestPointerLock' in Element.prototype;
  let lockFailed = !lockSupported, paused = false, wantLock = false;
  const setPaused = (on) => { paused = on; hud.classList.toggle('paused', on); if (on) keys.clear(); };
  const tryLock = () => {
    if (lockFailed) return;
    wantLock = true;
    try {
      const p = renderer.domElement.requestPointerLock();
      p?.catch?.(() => onLockError());
    } catch { onLockError(); }
  };
  function onLockError() {
    if (!wantLock) return;
    wantLock = false;
    lockFailed = true;          // 이후로는 드래그 방식 — 다시 시도하지 않음
    setPaused(false);
    hud.classList.add('drag-look');
  }
  document.addEventListener('pointerlockerror', onLockError);
  // 잠금 실패는 위에서 직접 처리하므로 PointerLockControls 의 콘솔 오류 출력은 끔
  if (plc._onPointerlockError) document.removeEventListener('pointerlockerror', plc._onPointerlockError);
  plc.addEventListener('lock', () => { wantLock = false; hud.classList.add('locked'); hud.classList.remove('drag-look'); setPaused(false); });
  plc.addEventListener('unlock', () => {
    hud.classList.remove('locked');
    keys.clear();
    if (active) setPaused(true);   // ESC 로 잠금을 푼 경우 → 일시정지
  });
  const resume = () => {
    setPaused(false);              // 잠금 성공 여부와 상관없이 일단 닫음
    if (lockFailed) { hud.classList.add('drag-look'); return; }
    // 브라우저는 ESC 직후 약 1초 동안 재잠금을 거부하므로, 실패하면 드래그 방식으로 계속
    tryLock();
  };

  // 마우스 드래그로 둘러보기 (잠금이 아닐 때) · 짧게 클릭하면 십자선 위치의 건물 정보
  let drag = null;
  renderer.domElement.addEventListener('pointerdown', (e) => {
    if (!active || e.pointerType !== 'mouse' || e.button !== 0 || plc.isLocked) return;
    drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, id: e.pointerId };
    try { renderer.domElement.setPointerCapture(e.pointerId); } catch { /* 포인터 캡처 불가 — 드래그는 그대로 동작 */ }
  });
  renderer.domElement.addEventListener('pointermove', (e) => {
    if (!active || !drag || e.pointerId !== drag.id) return;
    euler.setFromQuaternion(camera.quaternion, 'YXZ');
    euler.y -= (e.clientX - drag.x) * LOOK * 1.4;
    euler.x = Math.max(-1.4, Math.min(1.4, euler.x - (e.clientY - drag.y) * LOOK * 1.4));
    camera.quaternion.setFromEuler(euler);
    drag.x = e.clientX; drag.y = e.clientY;
  });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!active || !drag || e.pointerId !== drag.id) return;
    const moved = Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy);
    drag = null;
    if (moved < 5) onInspect?.();
  });
  renderer.domElement.addEventListener('click', () => {
    if (active && plc.isLocked) onInspect?.();   // 잠금 중 클릭 = 건물 정보
  });

  // 터치: 왼쪽 조이스틱 + 나머지 영역 드래그로 시점
  const stick = $('#joystick'), knob = $('#joystick .knob');
  let stickId = null, lookId = null, lookLast = null, tapStart = null;
  stick.addEventListener('pointerdown', (e) => { stickId = e.pointerId; stick.setPointerCapture(e.pointerId); moveStick(e); });
  stick.addEventListener('pointermove', (e) => { if (e.pointerId === stickId) moveStick(e); });
  const endStick = (e) => { if (e.pointerId !== stickId) return; stickId = null; touchMove.set(0, 0); knob.style.transform = ''; };
  stick.addEventListener('pointerup', endStick);
  stick.addEventListener('pointercancel', endStick);
  function moveStick(e) {
    const r = stick.getBoundingClientRect();
    let dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2), dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
    const len = Math.hypot(dx, dy);
    if (len > 1) { dx /= len; dy /= len; }
    touchMove.set(dx, -dy);
    knob.style.transform = `translate(${dx * 32}px, ${dy * 32}px)`;
  }
  renderer.domElement.addEventListener('pointerdown', (e) => {
    if (!active || e.pointerType === 'mouse') return;
    lookId = e.pointerId; lookLast = [e.clientX, e.clientY]; tapStart = [e.clientX, e.clientY, performance.now()];
  });
  renderer.domElement.addEventListener('pointermove', (e) => {
    if (!active || e.pointerId !== lookId) return;
    euler.setFromQuaternion(camera.quaternion, 'YXZ');
    euler.y -= (e.clientX - lookLast[0]) * LOOK * 1.6;
    euler.x = Math.max(-1.4, Math.min(1.4, euler.x - (e.clientY - lookLast[1]) * LOOK * 1.6));
    camera.quaternion.setFromEuler(euler);
    lookLast = [e.clientX, e.clientY];
  });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!active || e.pointerId !== lookId) return;
    lookId = null;
    if (tapStart && Math.hypot(e.clientX - tapStart[0], e.clientY - tapStart[1]) < 8 && performance.now() - tapStart[2] < 300) onInspect?.();
  });

  // ---- 그림자: 플레이어 주변만 고해상도로 ----
  const shadowSaved = { ...sun.shadow.camera, pos: sun.position.clone(), target: sun.target.position.clone() };
  function followShadow() {
    const x = camera.position.x, z = camera.position.z;
    const y = camera.position.y;
    sun.position.set(x - 160, y + 260, z + 130);
    sun.target.position.set(x, y - 2, z);
    sun.target.updateMatrixWorld();
  }

  function enter(startBuilding) {
    if (active) return;
    active = true;
    saved = { pos: camera.position.clone(), quat: camera.quaternion.clone(), near: camera.near };
    camera.near = 0.1;
    camera.updateProjectionMatrix();
    Object.assign(sun.shadow.camera, { left: -110, right: 110, top: 110, bottom: -110, near: 10, far: 700 });
    sun.shadow.camera.updateProjectionMatrix();
    const spot = startBuilding ? spotNear(startBuilding)
      : statue ? { p: v2(statue.pos[0], statue.pos[1] - 21), look: statue.pos } : { p: v2(0, -150), look: [0, 0] };
    placeAt(spot.p, spot.look);
    hud.hidden = false;
    document.body.classList.add('exploring');
    onEnter?.();
    setPaused(false);
    hud.classList.toggle('drag-look', lockFailed);
    tryLock();
  }

  function exit() {
    if (!active) return;
    active = false;
    setPaused(false);
    if (plc.isLocked) plc.unlock();
    keys.clear();
    camera.near = saved.near;
    camera.updateProjectionMatrix();
    camera.position.copy(saved.pos);
    camera.quaternion.copy(saved.quat);
    Object.assign(sun.shadow.camera, { left: shadowSaved.left, right: shadowSaved.right, top: shadowSaved.top, bottom: shadowSaved.bottom, near: shadowSaved.near, far: shadowSaved.far });
    sun.shadow.camera.updateProjectionMatrix();
    sun.position.copy(shadowSaved.pos);
    sun.target.position.copy(shadowSaved.target);
    sun.target.updateMatrixWorld();
    hud.hidden = true;
    document.body.classList.remove('exploring');
    onExit?.();
  }

  function teleport(b) {
    const spot = spotNear(b);
    placeAt(spot.p, spot.look);
  }

  // ---- 매 프레임 ----
  const fwd = new THREE.Vector3(), right = new THREE.Vector3();
  let nearTimer = 0;
  function update(dt) {
    if (!active) return;
    dt = Math.min(dt, 0.1);
    let mf = 0, mr = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) mf += 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) mf -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) mr += 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) mr -= 1;
    mf += touchMove.y; mr += touchMove.x;
    const len = Math.hypot(mf, mr);
    if (len > 0.01) {
      const speed = (keys.has('ShiftLeft') || keys.has('ShiftRight') || Math.hypot(touchMove.x, touchMove.y) > 0.95 ? RUN : WALK) * Math.min(1, len);
      camera.getWorldDirection(fwd);
      fwd.y = 0; fwd.normalize();
      right.crossVectors(fwd, camera.up).normalize();
      const step = speed * dt / Math.max(1, len);
      // 월드(x, z) → 데이터(x, y=-z)
      const next = v2(pos.x + (fwd.x * mf + right.x * mr) * step, pos.y - (fwd.z * mf + right.z * mr) * step);
      // 한 번에 큰 단은 못 오름 (0.7 m 초과 → 막힘). 광장 단차 0.62 m, 객석 계단 0.42 m 는 오를 수 있음
      if (groundAt(next.x, next.y) - groundAt(pos.x, pos.y) <= 0.7) pos.copy(collide(next));
    }
    const target = groundAt(pos.x, pos.y) + EYE;
    eyeY += (target - eyeY) * Math.min(1, dt * 10);
    const bob = len > 0.01 ? Math.sin(performance.now() / 160) * 0.025 : 0;
    camera.position.set(pos.x, eyeY + bob, -pos.y);
    followShadow();

    // 가까운 건물 표시 (0.25초마다)
    nearTimer -= dt;
    if (nearTimer <= 0) {
      nearTimer = 0.25;
      let best = null, bd = Infinity;
      for (const s of solids) {
        if (!s.b.name && !s.b.identifiedAs) continue;
        for (let i = 0; i < s.pts.length; i++) {
          const a = s.pts[i], c = s.pts[(i + 1) % s.pts.length];
          const q = closestOnSegment(pos.x, pos.y, a[0], a[1], c[0], c[1]);
          const d = Math.hypot(pos.x - q[0], pos.y - q[1]);
          if (d < bd) { bd = d; best = s.b; }
        }
      }
      const near = $('#near');
      if (best && bd < 30) {
        near.textContent = `${best.name ?? best.identifiedAs} · ${Math.max(0, Math.round(bd))} m`;
        near.hidden = false;
      } else near.hidden = true;
      // 이름표는 가까운 것만
      for (const b of data.buildings) {
        if (!b.labelEl) continue;
        const d = Math.hypot(b.center.x - pos.x, -b.center.z - pos.y);
        b.labelEl.style.opacity = d < 140 ? String(Math.min(1, (140 - d) / 40)) : '0';
      }
    }
    drawMinimap();
  }

  $('#explore-exit').addEventListener('click', exit);
  $('#explore-resume').addEventListener('click', (e) => { e.stopPropagation(); resume(); });
  $('#explore-pause-exit').addEventListener('click', (e) => { e.stopPropagation(); exit(); });
  $('#explore-pause').addEventListener('click', (e) => { if (e.target.id === 'explore-pause') resume(); });
  addEventListener('keydown', (e) => { if (active && e.code === 'KeyQ') exit(); });

  return { enter, exit, update, teleport, get active() { return active; } };
}

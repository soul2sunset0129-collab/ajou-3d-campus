// 건물 외관: 조사 데이터(b.facade — 실제 사진·문헌 기반)로 건물마다 외벽 텍스처를 그린다.
// 조사값이 없는 건물은 수집 사진(reference-photos/)에서 뽑은 대표 유형으로 대체한다.
import * as THREE from 'three';

export const FLOOR = 3.8;     // m — 기본 층고 (process_osm.py 의 FLOOR_HEIGHT 와 같게)
const BAYS = 8;               // 텍스처 한 장에 담는 창 칸 수 (가로 반복 단위)
const PX_BAY = 48, PX_FLOOR = 46;

const STYLE_BY_NAME = {
  '중앙도서관': 'beige',
  '산학협력원': 'brick',
  '체육관': 'gym',
  '노천극장': 'plain',
  '대형지반연구실험동': 'lab',
  '시약 수거동': 'lab',
};

// 대표 유형 (조사값이 없을 때)
const STYLES = {
  white: { wall: '#f1f0ea', glass: '#4f6b7d', style: 'ribbon', winRatio: 0.46 },
  beige: { wall: '#d9c9ae', glass: '#3d4b52', style: 'ribbon', winRatio: 0.42, wall2: '#9d8063', wall2Where: 'spandrel' },
  brick: { wall: '#efeee8', glass: '#557085', style: 'punched', winRatio: 0.5, base: { material: 'brick', hex: '#a3523e', floors: 2 } },
  dorm:  { wall: '#f2ece1', glass: '#5b6f78', style: 'punched', winRatio: 0.45 },
  lab:   { wall: '#d9d9d4', glass: '#56646b', style: 'punched', winRatio: 0.3 },
  gym:   { wall: '#e9e9e4', glass: '#5a7286', style: 'few', winRatio: 0.2 },
  plain: { wall: '#d6d4cc', glass: null, style: 'none', winRatio: 0 },
};

export const ROOF_COLORS = {
  white: '#c9ccd0', beige: '#b8ad9c', brick: '#c9ccd0', dorm: '#bfb3a2',
  lab: '#b9bbbd', gym: '#7c93a8', plain: '#bdbdb8',
};

export function styleFor(b) {
  const osmName = b.osmName ?? b.name;
  if (STYLE_BY_NAME[osmName]) return STYLE_BY_NAME[osmName];
  if (b.kind === 'dormitory') return 'dorm';
  if (b.kind === 'school') return 'lab';
  if (!b.name) return 'plain';
  return 'white';
}

const isHex = (s) => typeof s === 'string' && /^#[0-9a-f]{6}$/i.test(s.trim());

/** 조사값(b.facade)과 대표 유형을 합친 최종 외관 사양 */
export function specFor(b) {
  const S = STYLES[styleFor(b)];
  const f = b.facade ?? {};
  const pick = (v, d) => (isHex(v) ? v.trim() : d);
  const base = f.base && f.base.floors > 0 ? { ...f.base, hex: pick(f.base.hex, '#a3523e') } : S.base ?? null;
  return {
    wall: pick(f.wall, S.wall),
    wallMat: f.wallMat ?? '',
    wall2: pick(f.wall2, S.wall2 ?? null),
    wall2Where: f.wall2Where ?? S.wall2Where ?? '',
    glass: f.style === 'none' ? null : pick(f.glass, S.glass),
    frame: pick(f.frame, '#c9ced2'),
    style: f.style ?? S.style,
    winRatio: Math.min(0.92, Math.max(0.12, f.winRatio ?? S.winRatio ?? 0.45)),
    bay: Math.min(9, Math.max(1.8, f.bay ?? 4)),
    base,
  };
}

function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const shade = (hex, k) => {
  const c = new THREE.Color(hex);
  c.offsetHSL(0, 0, k);
  return '#' + c.getHexString();
};

// ---- 재질 무늬 ----
function materialKind(text) {
  const t = (text ?? '').toLowerCase();
  if (/brick|벽돌|조적/.test(t)) return 'brick';
  if (/granite|stone|화강|석재|대리석|marble/.test(t)) return 'stone';
  if (/metal|alumin|알루미늄|금속|패널|panel|steel|징크|zinc/.test(t)) return 'metal';
  if (/tile|타일/.test(t)) return 'tile';
  if (/glass|curtain|유리|커튼/.test(t)) return 'glass';
  return 'concrete';
}

function fillMaterial(g, x, y, w, h, hex, kind, rand) {
  g.fillStyle = hex;
  g.fillRect(x, y, w, h);
  if (kind === 'brick') {
    const bh = 4, bw = 10;
    for (let r = 0; r * bh < h; r++) {
      for (let c = -1; c * bw < w; c++) {
        g.fillStyle = shade(hex, (rand() - 0.5) * 0.1);
        g.fillRect(x + c * bw + (r % 2) * (bw / 2) + 0.5, y + r * bh + 0.5, bw - 1, bh - 1);
      }
    }
    return;
  }
  const joints = { stone: [24, 12], metal: [48, 23], tile: [8, 8] }[kind];
  if (joints) {
    g.fillStyle = shade(hex, -0.08);
    for (let yy = y; yy < y + h; yy += joints[1]) g.fillRect(x, yy, w, 1);
    for (let xx = x; xx < x + w; xx += joints[0]) g.fillRect(xx, y, 1, h);
    if (kind === 'stone') {
      for (let i = 0; i < (w * h) / 60; i++) {
        g.fillStyle = shade(hex, (rand() - 0.5) * 0.12);
        g.fillRect(x + rand() * w, y + rand() * h, 1, 1);
      }
    }
    return;
  }
  for (let i = 0; i < (w * h) / 40; i++) {
    g.fillStyle = rand() < 0.5 ? 'rgba(0,0,0,0.025)' : 'rgba(255,255,255,0.025)';
    g.fillRect(x + rand() * w, y + rand() * h, 1 + rand() * 2, 1 + rand() * 2);
  }
}

function glassRect(g, x, y, w, h, hex) {
  const grad = g.createLinearGradient(0, y, 0, y + h);
  grad.addColorStop(0, shade(hex, 0.22));   // 하늘 반사
  grad.addColorStop(0.4, hex);
  grad.addColorStop(1, shade(hex, -0.04));
  g.fillStyle = grad;
  g.fillRect(x, y, w, h);
}

function paint(spec, floors, seed) {
  const rand = rng(seed);
  const W = PX_BAY * BAYS, H = PX_FLOOR * floors;
  const color = document.createElement('canvas');
  const glow = document.createElement('canvas');
  color.width = glow.width = W;
  color.height = glow.height = H;
  const g = color.getContext('2d'), ge = glow.getContext('2d');
  ge.fillStyle = '#000';
  ge.fillRect(0, 0, W, H);
  const wallKind = materialKind(spec.wallMat);
  fillMaterial(g, 0, 0, W, H, spec.wall, wallKind === 'glass' ? 'concrete' : wallKind, rand);

  const where = (spec.wall2Where ?? '').toLowerCase();
  const w2 = spec.wall2;
  const w2base = w2 && /하부|저층|base|ground|plinth|기단|1층|podium/.test(where);
  const w2piers = w2 && /pier|기둥|column|vertical|수직|frame|프레임|mullion|fin|루버|louver/.test(where);
  const w2top = w2 && /상부|upper|top|옥탑|crown|최상/.test(where);
  // 띠(스팬드럴)로 명시된 경우에만 층마다 띠를 그림 — '동쪽 별관' 같은 설명은 무시
  const w2band = w2 && !w2base && !w2piers && !w2top && /band|띠|spandrel|스팬드럴|horizontal|수평|sill|floor/.test(where);

  const lit = (x, y, w, h) => {
    if (rand() < 0.42) {
      ge.fillStyle = ['#ffd79a', '#ffe6b8', '#fff3dc', '#e8f0ff'][Math.floor(rand() * 4)];
      ge.globalAlpha = 0.55 + rand() * 0.45;
      ge.fillRect(x + 1, y + 1, w - 2, h - 2);
      ge.globalAlpha = 1;
    }
  };

  for (let f = 0; f < floors; f++) {
    const y0 = H - (f + 1) * PX_FLOOR;
    const inBase = spec.base && f < spec.base.floors;
    if (inBase) fillMaterial(g, 0, y0, W, PX_FLOOR, spec.base.hex, materialKind(spec.base.material), rand);
    else if (w2base && f < 1) fillMaterial(g, 0, y0, W, PX_FLOOR, w2, 'concrete', rand);
    else if (w2top && f === floors - 1) fillMaterial(g, 0, y0, W, PX_FLOOR, w2, 'concrete', rand);
    if (w2band) {
      g.fillStyle = w2;
      g.fillRect(0, y0 + PX_FLOOR * 0.74, W, PX_FLOOR * 0.26);
    }
    if (!spec.glass || spec.style === 'none') continue;

    const r = spec.winRatio;
    const ground = f === 0 && !inBase;
    for (let b = 0; b < BAYS; b++) {
      const x0 = b * PX_BAY;
      let wx, ww, wy, wh;
      switch (spec.style) {
        case 'curtain_wall':
          wx = x0; ww = PX_BAY; wy = y0 + 2; wh = PX_FLOOR - 5;
          glassRect(g, wx, wy, ww, wh, spec.glass);
          g.fillStyle = spec.frame;
          g.fillRect(x0, y0, PX_BAY, 2);
          g.fillRect(x0, wy, 1.5, wh);
          g.fillRect(x0 + PX_BAY / 2, wy, 1, wh);
          lit(wx, wy, ww, wh);
          continue;
        case 'grid': {
          const fr = PX_BAY * 0.17;
          wx = x0 + fr; ww = PX_BAY - fr * 2; wh = PX_FLOOR * r; wy = y0 + (PX_FLOOR - wh) / 2;
          glassRect(g, wx, wy, ww, wh, spec.glass);
          g.fillStyle = 'rgba(0,0,0,0.22)';           // 깊은 창틀 그림자
          g.fillRect(wx, wy, ww, 3);
          g.fillRect(wx, wy, 2, wh);
          if (w2piers) { g.fillStyle = w2; g.fillRect(x0, y0, fr * 0.8, PX_FLOOR); }
          lit(wx, wy, ww, wh);
          continue;
        }
        case 'few':
          if (b % 2) continue;
          wx = x0 + PX_BAY * 0.3; ww = PX_BAY * 0.4; wh = PX_FLOOR * r; wy = y0 + PX_FLOOR * 0.3;
          break;
        case 'mixed':
          if (b % 4 === 3) { if (w2) { g.fillStyle = w2; g.fillRect(x0, y0, PX_BAY, PX_FLOOR); } continue; }
          wx = x0; ww = PX_BAY; wh = PX_FLOOR * r; wy = y0 + PX_FLOOR * 0.22;
          break;
        case 'punched':
          wx = x0 + PX_BAY * 0.2; ww = PX_BAY * 0.6; wh = PX_FLOOR * r; wy = y0 + PX_FLOOR * (0.5 - r / 2) - 2;
          break;
        default: // ribbon
          wx = x0; ww = PX_BAY; wh = PX_FLOOR * r; wy = y0 + PX_FLOOR * 0.22;
      }
      if (ground && spec.style !== 'few') { wh = Math.min(PX_FLOOR - 6, wh + 6); }
      glassRect(g, wx, wy, ww, wh, spec.glass);
      g.fillStyle = spec.frame;
      if (spec.style === 'ribbon' || spec.style === 'mixed') {
        g.fillRect(x0, wy, 2, wh);
        g.fillRect(x0 + PX_BAY / 2, wy, 1, wh);
        if (w2piers) { g.fillStyle = w2; g.fillRect(x0, y0, 4, PX_FLOOR); }
      } else {
        g.fillRect(wx + ww / 2 - 0.5, wy, 1, wh);
        g.fillStyle = shade(spec.wall, -0.1);
        g.fillRect(wx - 1, wy + wh, ww + 2, 2);   // 창턱
        if (w2piers) { g.fillStyle = w2; g.fillRect(x0, y0, PX_BAY * 0.12, PX_FLOOR); }
      }
      lit(wx, wy, ww, wh);
    }
  }
  // 옥상 파라펫 띠
  g.fillStyle = shade(spec.wall, -0.06);
  g.fillRect(0, 0, W, 4);
  return { color, glow };
}

/**
 * 건물 한 동의 외벽 텍스처. 같은 건물의 여러 덩어리(기단·탑)가 같은 텍스처를 공유하므로
 * 높이 매핑은 건물 전체 높이(totalHeight) 기준이다.
 * @returns {(y0:number) => {map, emissiveMap}}  y0 = 그 덩어리의 시작 높이(m)
 */
export function facadeFor(b, totalHeight, floorH, seed = 1) {
  const spec = specFor(b);
  const floors = Math.max(1, Math.round(totalHeight / floorH));
  const { color, glow } = paint(spec, floors, 1000 + seed);
  const tile = spec.bay * BAYS;
  const baseColor = new THREE.CanvasTexture(color);
  baseColor.colorSpace = THREE.SRGBColorSpace;
  const baseGlow = new THREE.CanvasTexture(glow);
  baseGlow.colorSpace = THREE.SRGBColorSpace;
  for (const t of [baseColor, baseGlow]) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    t.anisotropy = 8;
  }
  // ExtrudeGeometry 벽 UV: u = 수평 거리(m), v = 1 - (덩어리 안에서의 높이 m)
  //  →  v' = (덩어리 높이 + y0) / 전체 높이
  return (y0 = 0) => {
    const make = (src) => {
      const t = src.clone();
      t.repeat.set(1 / tile, -1 / totalHeight);
      t.offset.set(0, (1 + y0) / totalHeight);
      t.needsUpdate = true;
      return t;
    };
    return { map: make(baseColor), emissiveMap: make(baseGlow) };
  };
}

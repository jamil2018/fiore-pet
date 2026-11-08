// Reproducible native 48px Fiore artwork. Run: node scripts/dev/generate-sprites.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const out = fileURLToPath(new URL('../../public/sprites/', import.meta.url));
const FRAME = 48;
const DENSITY = FRAME / 32;
const C = {
  ink: '#493747', shade: '#dba77e', fur: '#f6d5a0', light: '#fff0cc',
  peach: '#ee9e93', pink: '#d87288', white: '#fff9e8', teal: '#599e98',
  darkTeal: '#386871', gold: '#efbd65', green: '#7eab7d', blue: '#829dbb',
};
const groups = {
  base: ['idle', 'walk', 'sit', 'notice', 'jump'],
  activity: ['code', 'think', 'write', 'browse'],
  music: ['dance', 'headbob'],
  petting: ['lean', 'happy', 'wag'],
  fullscreen: ['hide', 'appear'],
  outfits: ['twirl'],
  faces: ['stretch', 'yawn'],
};
const names = Object.values(groups).flat();
const once = new Set(['notice', 'jump', 'wag', 'hide', 'appear', 'twirl', 'stretch', 'yawn']);
const fps = { idle: 4, sit: 4, walk: 10, dance: 10, headbob: 8, jump: 40 / 3, wag: 10 };
const wave = [0, 0, -1, -1, 0, 0, 1, 0];

function bitmap(w, h) {
  const data = Buffer.alloc(w * h * 4);
  return {
    w, h, data,
    pixel(x, y, color) {
      x = Math.round(x); y = Math.round(y);
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      const n = Number.parseInt(color.slice(1), 16);
      const p = (y * w + x) * 4;
      data[p] = n >> 16; data[p + 1] = (n >> 8) & 255; data[p + 2] = n & 255; data[p + 3] = 255;
    },
    rect(x, y, width, height, color) {
      for (let j = y; j < y + height; j++) for (let i = x; i < x + width; i++) this.pixel(i, j, color);
    },
    ellipse(cx, cy, rx, ry, color) {
      for (let y = Math.floor(cy - ry); y <= cy + ry; y++) {
        for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
          if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) this.pixel(x, y, color);
        }
      }
    },
    poly(points, color) {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let inside = false;
        for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
          const [xi, yi] = points[i], [xj, yj] = points[j];
          if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
        }
        if (inside) this.pixel(x, y, color);
      }
    },
  };
}

function pose(name, i) {
  let x = 0, y = wave[i] / 3, squash = 0;
  if (['code', 'write', 'browse', 'think', 'sit', 'headbob', 'lean', 'stretch'].includes(name)) y = 0;
  if (name === 'walk') { x = [0, 0, 1, 1, 0, 0, -1, -1][i]; y = [0, -1, -1, 0, 0, -1, -1, 0][i]; }
  if (name === 'dance') { x = [-2, -2, 0, 2, 2, 2, 0, -2][i]; y = [0, -1, -2, -1, 0, -1, -2, -1][i]; }
  if (name === 'jump') { y = [1, 2, -2, -4, -4, -2, 1, 0][i]; squash = [0, 1, -1, -1, 0, 0, 1, 0][i]; }
  if (name === 'notice') y = [0, 1, -2, -2, -1, 0, 0, 0][i];
  if (name === 'happy') y = [0, -1, 0, -1, 0, -1, 0, 0][i];
  if (name === 'hide') { y = [0, -1, 0, 2, 6, 12, 24, 36][i]; squash = i === 3 ? 1 : 0; }
  if (name === 'appear') y = [36, 20, 7, -3, -2, 1, 0, 0][i];
  if (name === 'yawn') y = [0, 0, 1, 1, 1, 0, 0, 0][i];
  if (name === 'twirl') { x = [0, -1, -2, 0, 2, 1, 0, 0][i]; y = [0, -1, -1, -2, -1, 0, 0, 0][i]; }
  return { x, y, squash };
}

function headPose(name, i) {
  const base = pose(name, i);
  let x = base.x, y = base.y, angle = 0;
  if (name === 'sit') y += 4;
  if (name === 'headbob') { y += [0, -1, -2, -1, 1, 3, 2, 0][i]; angle = [0, -3, -5, -2, 3, 7, 4, 0][i]; }
  if (name === 'lean') { x += [1, 2, 3, 3, 3, 3, 2, 1][i]; y += 1; angle = [5, 9, 14, 17, 17, 14, 9, 5][i]; }
  if (name === 'think') { x -= 1; angle = [-7, -9, -12, -12, -12, -9, -7, -7][i]; }
  if (name === 'browse') { x += 1; angle = 5; }
  if (name === 'code') y += i % 2 ? 1 : 0;
  if (name === 'stretch') y -= [0, 0, 1, 2, 2, 1, 0, 0][i];
  return { x, y, angle };
}

// Rasterize geometry at native resolution, including sub-unit fur/eye detail.
// This is not a nearest-neighbor enlargement of the old 32px sheet.
function art() {
  const target = bitmap(FRAME, FRAME);
  const raw = { pixel: target.pixel.bind(target), rect: target.rect.bind(target), ellipse: target.ellipse.bind(target), poly: target.poly.bind(target) };
  target.pixel = (x, y, c) => raw.pixel(x * DENSITY, y * DENSITY, c);
  target.rect = (x, y, w, h, c) => {
    const x0 = Math.round(x * DENSITY), y0 = Math.round(y * DENSITY);
    for (let yy = y0; yy < Math.round((y + h) * DENSITY); yy++) for (let xx = x0; xx < Math.round((x + w) * DENSITY); xx++) raw.pixel(xx, yy, c);
  };
  target.ellipse = (cx, cy, rx, ry, c) => {
    for (let y = Math.floor((cy - ry) * DENSITY); y <= (cy + ry) * DENSITY; y++) for (let x = Math.floor((cx - rx) * DENSITY); x <= (cx + rx) * DENSITY; x++) {
      if (((x / DENSITY - cx) / rx) ** 2 + ((y / DENSITY - cy) / ry) ** 2 <= 1) raw.pixel(x, y, c);
    }
  };
  target.poly = (points, c) => {
    const scaled = points.map(([x, y]) => [x * DENSITY, y * DENSITY]);
    // Raw polygon calls pixel dynamically, so use a plain raster surface here.
    const layer = bitmap(FRAME, FRAME); layer.poly(scaled, c);
    for (let y = 0; y < FRAME; y++) for (let x = 0; x < FRAME; x++) if (layer.data[(y * FRAME + x) * 4 + 3]) raw.pixel(x, y, c);
  };
  return target;
}

function painter(img, p) {
  const a = (p.angle ?? 0) * Math.PI / 180;
  const point = (x, y) => [16 + (x - 16) * Math.cos(a) - (y - 20) * Math.sin(a) + p.x,
    20 + (x - 16) * Math.sin(a) + (y - 20) * Math.cos(a) + p.y];
  return {
    r: (x, y, w, h, c) => a ? img.poly([[x,y],[x+w,y],[x+w,y+h],[x,y+h]].map(([xx, yy]) => point(xx, yy)), c) : img.rect(x + p.x, y + p.y, w, h, c),
    e: (x, y, rx, ry, c) => a ? img.poly(Array.from({length:32}, (_, n) => point(x + rx * Math.cos(n * Math.PI / 16), y + ry * Math.sin(n * Math.PI / 16))), c) : img.ellipse(x + p.x, y + p.y, rx, ry, c),
    p: (points, c) => img.poly(points.map(([x, y]) => point(x, y)), c),
  };
}

function body(img, name, i) {
  if (name === 'hide' && i === 7) return;
  const pos = pose(name, i), d = painter(img, pos);
  const h = painter(img, headPose(name, i));
  const { r, e } = d;
  const stretch = name === 'stretch' ? [0, 0.25, 0.7, 1, 1, 0.7, 0.25, 0][i] : 0;
  const seated = name === 'sit';
  // Curled tail, rump, alternating feet, then the oversized head.
  const tail = (name === 'wag' || name === 'happy' ? [0, -2, -3, -1, 1, 2, 1, 0] : wave)[i];
  e(24, (seated ? 27 : 23) + tail, 5, seated ? 2 : 4, C.ink); e(24, (seated ? 26.5 : 22) + tail, 4, seated ? 1 : 3, C.shade);
  if (!seated) e(26, 21 + tail, 2, 2, C.light);
  const torsoY = seated ? 26 : 23 - stretch * 2;
  e(16, torsoY, seated ? 9 : 6 - stretch, seated ? 3 : 5 + stretch * 3, C.ink);
  e(16, torsoY - 0.5, seated ? 8 : 5 - stretch, seated ? 2 : 4 + stretch * 3, C.fur);
  e(15, torsoY - 1, 3, seated ? 1.5 : 3 + stretch * 2, C.light);
  const step = name === 'walk' ? (i < 4 ? 1 : -1) : 0;
  const footY = seated ? 29 : 28;
  e((seated ? 9 : 12) + step, footY, 3, 1.5, C.ink); r((seated ? 7 : 10) + step, footY - 1, 4, 1, C.light);
  e((seated ? 23 : 20) - step, footY, 3, 1.5, C.ink); r((seated ? 21 : 18) - step, footY - 1, 4, 1, C.fur);
  // Ears retain their pointed silhouette even when the head squashes.
  h.p([[7, 12], [7, 4], [9, 3], [14, 9]], C.ink);
  h.p([[8, 10], [8, 5], [9, 5], [12, 9]], C.fur);
  h.p([[9, 9], [9, 6], [11, 9]], C.peach);
  h.p([[19, 9], [24, 3], [26, 4], [26, 13]], C.ink);
  h.p([[21, 9], [24, 5], [25, 5], [25, 11]], C.fur);
  h.p([[22, 9], [24, 6], [24, 10]], C.peach);
  h.e(16, 13, 10 + pos.squash, 7.5 - pos.squash, C.ink);
  h.e(16, 13, 9.2 + pos.squash, 6.8 - pos.squash, C.shade);
  h.e(15, 12, 8.4 + pos.squash, 6 - pos.squash, C.fur);
  h.e(14, 11.5, 6.8, 4.7, C.light);
  h.r(12, 7, 1.3, 2, C.fur); h.r(16, 6.3, 1.3, 2.7, C.fur); h.r(20, 8, 1.3, 1.3, C.fur);
  h.r(8, 16, 2, 0.7, C.peach); h.r(22, 16, 2, 0.7, C.peach);
  h.r(8, 16, 4, 0.7, C.ink); h.r(21, 16, 4, 0.7, C.ink);
  h.r(8.7, 17.5, 3, 0.7, C.ink); h.r(21.3, 17.5, 3, 0.7, C.ink);
  const raised = ['dance', 'happy', 'stretch', 'notice'].includes(name) && i > 1 && i < 6;
  if (stretch > 0) {
    for (const x of [6, 26]) { r(x - 1, 22 - stretch * 16, 2, stretch * 16, C.ink); r(x - 0.3, 22 - stretch * 16, 0.7, stretch * 16, C.fur); e(x, 22 - stretch * 18, 2, 2, C.ink); e(x, 21.5 - stretch * 18, 1.2, 1.2, C.light); }
  } else if (name === 'think') {
    d.p([[20,24],[23,22],[21,18],[19,19]], C.ink); e(20, 19, 2, 1.5, C.light); e(10, 23, 2, 2, C.ink); e(10, 22.5, 1.3, 1.3, C.light);
  } else if (name === 'lean') {
    d.p([[20,22],[28,20],[29,22],[21,25]], C.ink); e(28,21,1.5,1.5,C.light); e(11,24,2,2,C.ink); e(11,23.5,1.3,1.3,C.light);
  } else {
    const pawY = seated ? 27 : raised ? 18 : 23;
    e(seated ? 13 : 9, pawY, 2, 2, C.ink); e(seated ? 13 : 9, pawY - 0.5, 1.3, 1.3, C.light);
    e(seated ? 19 : 23, pawY, 2, 2, C.ink); e(seated ? 19 : 23, pawY - 0.5, 1.3, 1.3, C.light);
  }
  if (name === 'happy' && i > 0 && i < 7) {
    const yy = 5 - Math.floor(i / 2);
    img.rect(1, yy, 2, 2, C.pink); img.rect(4, yy, 2, 2, C.pink);
    img.rect(2, yy + 1, 3, 2, C.pink); img.pixel(3, yy + 3, C.pink);
  }
  if (name === 'notice' && i > 1 && i < 6) {
    img.ellipse(27, 5, 4.5, 4.5, C.ink); img.ellipse(27, 5, 3.5, 3.5, C.white);
    img.rect(26.5, 2.5, 1.3, 3, C.pink); img.rect(26.5, 6.5, 1.3, 1.3, C.ink);
  }
  if (name === 'think') {
    img.ellipse(27, 5, 4, 4, C.ink); img.ellipse(27, 5, 3.3, 3.3, C.white);
    img.rect(26, 2.7, 2.7, 0.7, C.teal); img.rect(28, 3.3, 0.7, 2, C.teal); img.rect(26.7, 5, 2, 0.7, C.teal); img.pixel(26.7, 7, C.ink);
    img.ellipse(25, 10, 1, 1, C.white);
  }
  if (['hide', 'appear'].includes(name) && pos.y > 5) {
    img.rect(4, 28, 4, 1, C.shade); img.rect(23, 28, 5, 1, C.shade);
    if (i !== 7) { img.pixel(2, 26, C.fur); img.pixel(29, 26, C.fur); }
  }
  // Activity props remain visible when music takes the accessory slot.
  if (name === 'code' || name === 'think') prop(img, 'laptop', name, i);
  if (name === 'write') prop(img, 'notepad', name, i);
  if (name === 'browse') prop(img, 'tablet', name, i);
}

function face(img, mood, name, i) {
  const { r, e } = painter(img, headPose(name, i));
  const blink = (['idle', 'sit', 'code', 'browse', 'write'].includes(name) && i === 6);
  const happy = mood === 'happy' || name === 'happy';
  const yawning = name === 'yawn' && i >= 1 && i <= 6;
  if (yawning || blink || (name === 'stretch' && i > 1 && i < 6)) {
    r(10.7, 13.3, 0.7, 0.7, C.ink); r(11.3, 14, 2, 0.7, C.ink); r(13.3, 13.3, 0.7, 0.7, C.ink);
    r(19.7, 13.3, 0.7, 0.7, C.ink); r(20.3, 14, 2, 0.7, C.ink); r(22.3, 13.3, 0.7, 0.7, C.ink);
  } else if (happy) {
    r(10, 14, 1, 1, C.ink); r(11, 13, 2, 1, C.ink); r(13, 14, 1, 1, C.ink);
    r(19, 14, 1, 1, C.ink); r(20, 13, 2, 1, C.ink); r(22, 14, 1, 1, C.ink);
  } else if (mood === 'sleepy') {
    r(11, 13, 2, 1.3, C.ink); r(20, 13, 2, 1.3, C.ink);
    r(10.7, 12.3, 2.7, 0.7, C.shade); r(19.7, 12.3, 2.7, 0.7, C.shade);
  } else {
    const h = mood === 'calm' ? 2 : 3;
    const gaze = name === 'think' ? -0.7 : name === 'browse' ? 0.7 : 0;
    r(11 + gaze, 12, 2, h, C.ink); r(20 + gaze, 12, 2, h, C.ink);
    r(11 + gaze, 12, 0.7, 0.7, C.white); r(20 + gaze, 12, 0.7, 0.7, C.white);
  }
  r(16, 16, 2, 1, C.pink); r(16, 17, 1, 1, C.ink);
  if (name === 'yawn' && i > 1 && i < 6) {
    const opening = [0, 0, 0.8, 1.8, 1.8, 0.8, 0, 0][i];
    e(16.5, 18.5, 1.3, opening, C.ink);
    if (opening > 1) r(16, 19, 1.3, 0.7, C.pink);
  } else {
    r(14, 18, 2, 1, C.ink); r(17, 18, 2, 1, C.ink);
  }
}

function outfit(img, season, name, i) {
  const { r, e, p } = painter(img, headPose(name, i));
  const b = painter(img, { ...pose(name, i), y: pose(name, i).y + (name === 'sit' ? 4 : 0) });
  if (season === 'winter') {
    r(8, 5, 17, 3, C.ink); r(9, 4, 15, 3, C.teal); r(11, 2, 11, 3, C.teal);
    e(16, 2, 2, 1, C.white); r(9, 7, 15, 2, C.darkTeal); r(10, 7, 13, 1, C.blue);
    r(10, 21, 12, 2, C.ink); r(10, 21, 12, 1, C.teal); r(20, 22, 3, 5, C.darkTeal);
    r(20, 24, 3, 1, C.teal);
  } else if (season === 'spring') {
    r(9, 7, 15, 1, C.green);
    for (const x of [11, 17, 22]) { r(x - 1, 5, 3, 3, C.pink); r(x, 4, 1, 5, C.peach); r(x, 6, 1, 1, C.gold); }
  } else if (season === 'autumn') {
    b.r(11, 21, 11, 3, C.ink); b.r(12, 21, 9, 2, C.teal); b.r(14, 22, 0.7, 3, C.white); b.r(19, 22, 0.7, 3, C.white);
    b.p([[21, 20], [24, 19], [23, 23], [21, 23]], C.gold); b.r(21, 22, 0.7, 2, C.shade);
  } else if (season === 'summer') {
    r(7, 7, 20, 2, C.ink); r(7, 7, 20, 1, C.gold); r(11, 3, 12, 4, C.ink);
    r(12, 3, 10, 3, C.light); r(11, 6, 12, 1, C.pink);
  }
  // Glasses sit above the eye pixels so face layering remains readable.
  if (season === 'summer' || season === 'summer_glasses') {
    r(9, 11, 6, 2, C.darkTeal); r(18, 11, 6, 2, C.darkTeal); r(15, 11, 3, 1, C.ink);
    r(10, 11, 2, 1, C.blue); r(19, 11, 2, 1, C.blue);
  }
}

function prop(img, variant, name, i) {
  const { r, e } = painter(img, variant === 'headphones' ? headPose(name, i) : pose(name, i));
  if (variant === 'headphones') {
    r(8, 8, 2, 9, C.ink); r(24, 8, 2, 9, C.ink); r(10, 6, 14, 2, C.ink);
    r(11, 6, 12, 1, C.teal); r(6, 12, 4, 6, C.ink); r(24, 12, 4, 6, C.ink);
    r(7, 13, 2, 4, C.teal); r(25, 13, 2, 4, C.teal); r(7, 13, 1, 2, C.blue);
  } else if (variant === 'laptop') {
    if (name === 'think') {
      r(7, 28, 19, 2, C.ink); r(8, 28, 17, 0.7, C.blue); r(15, 28, 3, 0.7, C.white);
    } else {
      r(8, 21, 18, 7, C.ink); r(9, 22, 16, 4.7, C.darkTeal);
      r(10, 22.7, 3, 0.7, C.peach); r(14, 22.7, 6, 0.7, C.white);
      r(11, 24, 5, 0.7, C.teal); r(17, 24, 5, 0.7, C.gold);
      r(10, 25.3, 3 + i % 4, 0.7, C.white);
      r(6, 28, 22, 2, C.ink); r(8, 27.3, 18, 1.3, C.blue);
      for (let x = 10; x < 24; x += 2) r(x, 28, 0.7, 0.7, C.darkTeal);
      e(11, i % 2 ? 26 : 27.3, 2.3, 1.3, C.ink); e(11, i % 2 ? 25.5 : 26.8, 1.7, 0.7, C.light);
      e(22, i % 2 ? 27.3 : 26, 2.3, 1.3, C.ink); e(22, i % 2 ? 26.8 : 25.5, 1.7, 0.7, C.light);
    }
  } else if (variant === 'notepad') {
    r(11, 21, 12, 9, C.ink); r(12, 22, 10, 7, C.white);
    r(13, 23, 1, 6, C.peach); r(15, 24, 5, 1, C.blue); r(15, 26, 4, 1, C.blue);
    const x = 22 + (i % 3); r(x, 22, 1, 5, C.gold); r(x, 27, 1, 1, C.ink);
  } else {
    r(19, 17, 9, 13, C.ink); r(20, 18, 7, 10, C.white);
    r(20.7, 18.7, 5.3, 2.7, C.teal);
    const scroll = i % 4;
    for (let y = 22; y < 27; y += 2) { r(20.7, y - scroll / 3, 4.7, 0.7, C.blue); }
    r(22.7, 28.7, 1.3, 0.7, C.white);
    e(18.7, 23 + [0,1,2,1,0,-1,-2,-1][i], 1.7, 1.7, C.ink);
    e(19, 22.7 + [0,1,2,1,0,-1,-2,-1][i], 1, 1, C.light);
  }
}

function copy(src, dst, dx, dy, scale = 1) {
  for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) {
    const p = (y * src.w + x) * 4;
    if (!src.data[p + 3]) continue;
    const c = `#${src.data.subarray(p, p + 3).toString('hex')}`;
    dst.rect(dx + x * scale, dy + y * scale, scale, scale, c);
  }
}

function turn(frame, name, i, layer) {
  if (name !== 'twirl') return frame;
  const widths = [48, 36, 18, 36, 48, 18, 36, 48];
  const width = widths[i], result = bitmap(FRAME, FRAME), start = (FRAME - width) / 2;
  if (layer === 'face' && i >= 2 && i <= 4) return result;
  for (let y = 0; y < FRAME; y++) for (let x = 0; x < width; x++) {
    let sx = Math.floor(x * FRAME / width);
    if (i >= 3 && i <= 5) sx = FRAME - 1 - sx;
    const offset = (y * FRAME + sx) * 4;
    if (frame.data[offset + 3]) result.pixel(start + x, y, `#${frame.data.subarray(offset, offset + 3).toString('hex')}`);
  }
  return result;
}

function crc(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) { c ^= b; for (let j = 0; j < 8; j++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0); }
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, bytes) {
  const body = Buffer.concat([Buffer.from(type), bytes]);
  const size = Buffer.alloc(4), check = Buffer.alloc(4);
  size.writeUInt32BE(bytes.length); check.writeUInt32BE(crc(body));
  return Buffer.concat([size, body, check]);
}
function png(img) {
  const header = Buffer.alloc(13); header.writeUInt32BE(img.w); header.writeUInt32BE(img.h, 4); header[8] = 8; header[9] = 6;
  const scan = Buffer.alloc((img.w * 4 + 1) * img.h);
  for (let y = 0; y < img.h; y++) img.data.copy(scan, y * (img.w * 4 + 1) + 1, y * img.w * 4, (y + 1) * img.w * 4);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(scan)), chunk('IEND', Buffer.alloc(0))]);
}

mkdirSync(out, { recursive: true });
for (const [group, animations] of Object.entries(groups)) {
  const rows = [], sheets = [];
  function sheet(layer, variant, anims, draw) {
    const defs = {};
    for (const name of anims) {
      const row = rows.length;
      const frames = Array.from({ length: 8 }, (_, i) => { const img = art(); draw(img, name, i); return turn(img, name, i, layer); });
      rows.push(frames);
      defs[name] = { row, start: 0, count: 8, fps: fps[name] ?? 8, loop: !once.has(name),
        motionSplit: layer === 'face' || variant === 'headphones' ? FRAME : layer === 'accessory' ? 0 : layer === 'outfit' ? 30 : 32,
        ...(layer === 'body' ? { headOffset: Array.from({ length: 8 }, (_, i) => { const p = headPose(name, i); return [Math.round(p.x * DENSITY), Math.round(p.y * DENSITY)]; }) } : {}) };
    }
    sheets.push({ layer, image: `${group}.png`, ...(variant ? { variant } : {}), animations: defs });
  }
  sheet('body', null, animations, body);
  if (group === 'faces') for (const mood of ['energetic', 'content', 'calm', 'sleepy', 'happy']) sheet('face', mood, names, (img, n, i) => face(img, mood, n, i));
  if (group === 'outfits') for (const season of ['winter', 'spring', 'summer', 'autumn', 'summer_glasses']) sheet('outfit', season, names, (img, n, i) => outfit(img, season, n, i));
  if (group === 'music') sheet('accessory', 'headphones', names, (img, n, i) => prop(img, 'headphones', n, i));
  if (group === 'activity') for (const variant of ['laptop', 'notepad', 'tablet']) sheet('accessory', variant, names, (img, n, i) => prop(img, variant, n, i));
  const image = bitmap(8 * FRAME, rows.length * FRAME);
  rows.forEach((frames, y) => frames.forEach((frame, x) => copy(frame, image, x * FRAME, y * FRAME)));
  writeFileSync(`${out}/${group}.png`, png(image));
  writeFileSync(`${out}/${group}.json`, `${JSON.stringify({ version: 1, group, frame: { w: FRAME, h: FRAME }, sheets }, null, 2)}\n`);
}

// Contact sheet includes actual layer composites, not separately rendered concept art.
const preview = bitmap(8 * 96, names.length * 96);
names.forEach((name, y) => {
  for (let i = 0; i < 8; i++) {
    const img = bitmap(FRAME, FRAME);
    for (const [layer, draw] of [
      ['body', (frame) => body(frame, name, i)],
      ['outfit', (frame) => outfit(frame, 'autumn', name, i)],
      ['face', (frame) => face(frame, 'content', name, i)],
      ['accessory', (frame) => { if (name === 'dance') prop(frame, 'headphones', name, i); }],
    ]) {
      const frame = art(); draw(frame); copy(turn(frame, name, i, layer), img, 0, 0);
    }
    copy(img, preview, i * 96, y * 96, 2);
  }
});
writeFileSync(`${out}/preview.png`, png(preview));
const showcase = bitmap(6 * 96, 96);
['spring', 'summer', 'autumn', 'winter', 'summer_glasses', 'autumn'].forEach((season, x) => {
  const img = art(), name = x === 4 ? 'code' : x === 5 ? 'dance' : 'idle';
  body(img, name, 0); outfit(img, season, name, 0); face(img, x === 5 ? 'happy' : 'content', name, 0);
  if (x === 5) prop(img, 'headphones', name, 0);
  copy(img, showcase, x * 96, 0, 2);
});
writeFileSync(`${out}/showcase.png`, png(showcase));
writeFileSync(`${out}/preview.html`, `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Fiore — motion gallery</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f5efe3;color:#493747;font:15px/1.5 system-ui,sans-serif}
main{max-width:1120px;margin:auto;padding:48px 32px}header{display:flex;align-items:end;justify-content:space-between;gap:24px;margin-bottom:36px}
h1{font:500 54px/1.1 Georgia,serif;margin:8px 0}p{max-width:530px;color:#796976}small{font-size:11px;text-transform:uppercase;letter-spacing:2px}
button{border:1px solid #493747;border-radius:24px;background:transparent;color:inherit;padding:12px 22px;cursor:pointer}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px}.card{background:#fffaf0;border:1px solid #e2d8ca;border-radius:16px;padding:22px;text-align:center}
.pet{width:96px;height:96px;margin:0 auto 12px;background-image:url(preview.png);image-rendering:pixelated;animation:frames var(--duration) steps(8) infinite}
.name{font-weight:600;text-transform:capitalize}.note{font-size:11px;color:#897780;margin-top:4px}body.paused .pet{animation-play-state:paused}
@keyframes frames{to{background-position-x:-768px}}@media(prefers-reduced-motion:reduce){.pet{animation-play-state:paused}}
.wardrobe{display:block;width:100%;max-width:768px;image-rendering:pixelated;margin:30px auto}
</style><main><header><div><small>Fiore / Character & motion</small><h1>A little more alive.</h1>
<p>More detail. Clearer gestures. Native 48 × 48 pixel art at 2× scale, with a planted body, articulated head, and distinct activity poses.</p></div><button id="pause" type="button">Pause animations</button></header>
<section class="grid" aria-label="Animation gallery">${names.map((name, i) => `<article class="card"><div class="pet" role="img" aria-label="${name} animation" style="background-position-y:-${i * 96}px;--duration:${8 / (fps[name] ?? 8)}s"></div><div class="name">${name}</div><div class="note">8 frames · ${once.has(name) ? 'one-shot preview repeated' : 'loop'}</div></article>`).join('')}</section>
<h2>Through the seasons</h2><p>Spring blossoms, a summer hat, an autumn hoodie, a winter knit, focused work, and music.</p><img class="wardrobe" src="showcase.png" alt="Fiore's seasonal outfits and activity props">
</main><script>document.getElementById('pause').addEventListener('click',function(){const paused=document.body.classList.toggle('paused');this.textContent=paused?'Play animations':'Pause animations';this.setAttribute('aria-pressed',String(paused));});</script></html>`);
console.log(`Generated seven aligned atlases, ${names.length} animations, eight frames each.`);

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS = '0123456789';

const IMG_W = 1078;
const IMG_H = 908;

// Default masks
let maskCtx = null, maskWidth = 0, maskHeight = 0;
let wallsCtx = null, wallsWidth = 0, wallsHeight = 0;

// KGWO masks
let maskKgwoCtx = null, maskKgwoWidth = 0, maskKgwoHeight = 0;
let wallsKgwoCtx = null, wallsKgwoWidth = 0, wallsKgwoHeight = 0;

// 0M8 masks
let maskOm8Ctx = null, maskOm8Width = 0, maskOm8Height = 0;
let wallsOm8Ctx = null, wallsOm8Width = 0, wallsOm8Height = 0;

const MAX_ATTEMPTS = 500;
const RAY_COUNT = 360;
const LINE_MIN_PX = 75;
const LINE_MAX_PX = 150;

const SUBLABELS = ['VA', 'RWY5', 'VA RWY5'];

function loadImage(src, canvasId) {
  return new Promise((resolve) => {
    const img = new Image();
    img.src = src;
    img.onload = () => {
      const canvas = document.getElementById(canvasId);
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      resolve({ ctx, width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      console.warn(src + ' not found.');
      resolve(null);
    };
  });
}

function isKgwo() { return document.getElementById('kgwo-checkbox').checked; }
function isOm8()  { return document.getElementById('om8-checkbox').checked; }
function isEverything() { return document.getElementById('everything-checkbox').checked; }

// Mutually exclusive checkboxes — checking any one unchecks the others
const CHECKBOX_IDS = ['kgwo-checkbox', 'om8-checkbox', 'everything-checkbox'];
CHECKBOX_IDS.forEach(id => {
  document.getElementById(id).addEventListener('change', () => {
    if (document.getElementById(id).checked) {
      CHECKBOX_IDS.filter(b => b !== id).forEach(b => {
        document.getElementById(b).checked = false;
      });
    }
  });
});

// Pick the active mask/walls context based on active mode
function activeMask(mode) {
  if (mode === 'kgwo') return { ctx: maskKgwoCtx, w: maskKgwoWidth, h: maskKgwoHeight };
  if (mode === 'om8')  return { ctx: maskOm8Ctx,  w: maskOm8Width,  h: maskOm8Height  };
  return { ctx: maskCtx, w: maskWidth, h: maskHeight };
}

function activeWalls(mode) {
  if (mode === 'kgwo') return { ctx: wallsKgwoCtx, w: wallsKgwoWidth, h: wallsKgwoHeight };
  if (mode === 'om8')  return { ctx: wallsOm8Ctx,  w: wallsOm8Width,  h: wallsOm8Height  };
  return { ctx: wallsCtx, w: wallsWidth, h: wallsHeight };
}

// Determine which mode is active, respecting "everything" bias (60% default, 20% om8, 20% kgwo)
function getMode() {
  if (isEverything()) {
    const r = Math.random();
    if (r < 0.6) return 'default';
    if (r < 0.8) return 'om8';
    return 'kgwo';
  }
  if (isKgwo()) return 'kgwo';
  if (isOm8())  return 'om8';
  return 'default';
}

function isAllowedForMode(ix, iy, mode) {
  const { ctx, w, h } = activeMask(mode);
  if (!ctx) return true;
  const px = Math.floor((ix / IMG_W) * w);
  const py = Math.floor((iy / IMG_H) * h);
  if (px < 0 || py < 0 || px >= w || py >= h) return false;
  return ctx.getImageData(px, py, 1, 1).data[0] > 128;
}

function isWallForMode(ix, iy, mode) {
  const { ctx, w, h } = activeWalls(mode);
  if (!ctx) return false;
  const px = Math.floor((ix / IMG_W) * w);
  const py = Math.floor((iy / IMG_H) * h);
  if (px < 0 || py < 0 || px >= w || py >= h) return false;
  return ctx.getImageData(px, py, 1, 1).data[0] > 128;
}

// Cast one ray in a given direction, searching the full image distance
function castRay(startX, startY, dx, dy, mode) {
  const maxSteps = Math.max(IMG_W, IMG_H);
  for (let step = 1; step <= maxSteps; step++) {
    const x = startX + dx * step;
    const y = startY + dy * step;
    if (isWallForMode(x, y, mode)) {
      return { dist: step, endX: x, endY: y };
    }
  }
  return null;
}

// Find closest wall — used for default mode (75–150px enforcement)
function findClosestWall(startX, startY, mode) {
  let best = null;
  for (let i = 0; i < RAY_COUNT; i++) {
    const angle = (i / RAY_COUNT) * 2 * Math.PI;
    const hit = castRay(startX, startY, Math.cos(angle), Math.sin(angle), mode);
    if (hit && (!best || hit.dist < best.dist)) {
      best = hit;
    }
  }
  return best;
}

// Find wall in a random direction — used for no-limit modes so distance is unconstrained
function findRandomDirectionWall(startX, startY, mode) {
  const angle = Math.random() * 2 * Math.PI;
  return castRay(startX, startY, Math.cos(angle), Math.sin(angle), mode);
}

function randomName() {
  let name = 'N';
  const numCount = Math.floor(Math.random() * 2) + 2;
  for (let i = 0; i < numCount; i++) name += DIGITS[Math.floor(Math.random() * DIGITS.length)];
  const letCount = Math.floor(Math.random() * 2) + 1;
  for (let i = 0; i < letCount; i++) name += LETTERS[Math.floor(Math.random() * LETTERS.length)];
  return name;
}

function randomSublabel() {
  return SUBLABELS[Math.floor(Math.random() * SUBLABELS.length)];
}

function randomPosition(mode) {
  const margin = Math.floor(IMG_W * 0.02);
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const x = margin + Math.random() * (IMG_W - margin * 2);
    const y = margin + Math.random() * (IMG_H - margin * 2);
    if (isAllowedForMode(x, y, mode)) return { x, y };
  }
  console.warn('Could not find a valid position — placing at center.');
  return { x: IMG_W / 2, y: IMG_H / 2 };
}

function drawLine(startX, startY, endX, endY) {
  const svg = document.getElementById('line-overlay');
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line.setAttribute('x1', startX);
  line.setAttribute('y1', startY);
  line.setAttribute('x2', endX);
  line.setAttribute('y2', endY);
  line.setAttribute('stroke', '#FFE033');
  line.setAttribute('stroke-width', '1.5');
  line.setAttribute('stroke-linecap', 'round');
  svg.appendChild(line);
}

function generate() {
  const canvas = document.getElementById('canvas');
  const existing = canvas.querySelector('.dot-group');
  if (existing) existing.remove();

  const mode = getMode();
  let pos, wall;
  let tries = 0;

  if (mode === 'kgwo' || mode === 'om8') {
    // No distance limits — random direction, any wall distance
    while (tries < MAX_ATTEMPTS) {
      pos = randomPosition(mode);
      wall = findRandomDirectionWall(pos.x, pos.y, mode);
      if (wall) break;
      tries++;
    }
  } else {
    // Default mode: closest wall must be between LINE_MIN_PX and LINE_MAX_PX
    while (tries < MAX_ATTEMPTS) {
      pos = randomPosition(mode);
      wall = findClosestWall(pos.x, pos.y, mode);
      if (wall && wall.dist >= LINE_MIN_PX && wall.dist <= LINE_MAX_PX) break;
      wall = null;
      tries++;
    }
  }

  if (!wall) {
    console.warn('Could not find a valid position.');
    return;
  }

  drawLine(pos.x, pos.y, wall.endX, wall.endY);

  const group = document.createElement('div');
  group.className = 'dot-group';
  group.style.left = pos.x + 'px';
  group.style.top = pos.y + 'px';

  const dot = document.createElement('div');
  dot.className = 'dot';

  const label = document.createElement('span');
  label.className = 'dot-label';
  label.textContent = randomName();

  group.appendChild(dot);
  group.appendChild(label);

  // Sublabel line beneath the name — content depends on mode
  const sublabel = document.createElement('span');
  sublabel.className = 'dot-sublabel';
  if (mode === 'kgwo') {
    sublabel.textContent = randomSublabel();
    group.appendChild(sublabel);
    const sublabel2 = document.createElement('span');
    sublabel2.className = 'dot-sublabel2';
    sublabel2.textContent = 'KGWO';
    group.appendChild(sublabel2);
  } else if (mode === 'om8') {
    sublabel.textContent = '0M8';
    group.appendChild(sublabel);
  } else {
    sublabel.textContent = 'KXXX';
    group.appendChild(sublabel);
  }

  canvas.appendChild(group);
}

async function init() {
  const maskResult = await loadImage('mask.png', 'mask-canvas');
  if (maskResult) { maskCtx = maskResult.ctx; maskWidth = maskResult.width; maskHeight = maskResult.height; }

  const wallsResult = await loadImage('walls.png', 'walls-canvas');
  if (wallsResult) { wallsCtx = wallsResult.ctx; wallsWidth = wallsResult.width; wallsHeight = wallsResult.height; }

  const maskKgwoResult = await loadImage('mask_kgwo.png', 'mask-kgwo-canvas');
  if (maskKgwoResult) { maskKgwoCtx = maskKgwoResult.ctx; maskKgwoWidth = maskKgwoResult.width; maskKgwoHeight = maskKgwoResult.height; }

  const wallsKgwoResult = await loadImage('walls_kgwo.png', 'walls-kgwo-canvas');
  if (wallsKgwoResult) { wallsKgwoCtx = wallsKgwoResult.ctx; wallsKgwoWidth = wallsKgwoResult.width; wallsKgwoHeight = wallsKgwoResult.height; }

  const maskOm8Result = await loadImage('mask_om8.png', 'mask-om8-canvas');
  if (maskOm8Result) { maskOm8Ctx = maskOm8Result.ctx; maskOm8Width = maskOm8Result.width; maskOm8Height = maskOm8Result.height; }

  const wallsOm8Result = await loadImage('walls_om8.png', 'walls-om8-canvas');
  if (wallsOm8Result) { wallsOm8Ctx = wallsOm8Result.ctx; wallsOm8Width = wallsOm8Result.width; wallsOm8Height = wallsOm8Result.height; }

  generate();
}

init();

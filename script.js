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

// TRAFFIC mask (no walls)
let maskTrafficCtx = null, maskTrafficWidth = 0, maskTrafficHeight = 0;

const MAX_ATTEMPTS = 500;
const RAY_COUNT = 360;
const LINE_MIN_PX = 75;
const LINE_MAX_PX = 150;
const TRAFFIC_MIN_DIST = 100;
const TRAFFIC_MAX_DIST = 300;

const SUBLABELS = ['VA', 'VA RWY5'];

// Custom mode state
let customModeActive = false;
let customClickStep = 0;   // 0 = waiting for dot click, 1 = waiting for line end click
let customDotX = 0;
let customDotY = 0;
let customDotName = '';
let ghostDotEl = null;

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

function isKgwo()       { return document.getElementById('kgwo-checkbox').checked; }
function isOm8()        { return document.getElementById('om8-checkbox').checked; }
function isEverything() { return document.getElementById('everything-checkbox').checked; }
function isTraffic()    { return document.getElementById('traffic-checkbox').checked; }

// Mutually exclusive checkboxes
const CHECKBOX_IDS = ['kgwo-checkbox', 'om8-checkbox', 'everything-checkbox', 'traffic-checkbox'];
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

// Determine which mode is active
// Everything bias: 40% default, 20% om8, 20% kgwo, 20% traffic
function getMode() {
  if (isEverything()) {
    const r = Math.random();
    if (r < 0.40) return 'default';
    if (r < 0.60) return 'om8';
    if (r < 0.80) return 'kgwo';
    return 'traffic';
  }
  if (isKgwo())    return 'kgwo';
  if (isOm8())     return 'om8';
  if (isTraffic()) return 'traffic';
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

function isAllowedTraffic(ix, iy) {
  if (!maskTrafficCtx) return true;
  const px = Math.floor((ix / IMG_W) * maskTrafficWidth);
  const py = Math.floor((iy / IMG_H) * maskTrafficHeight);
  if (px < 0 || py < 0 || px >= maskTrafficWidth || py >= maskTrafficHeight) return false;
  return maskTrafficCtx.getImageData(px, py, 1, 1).data[0] > 128;
}

function isWallForMode(ix, iy, mode) {
  const { ctx, w, h } = activeWalls(mode);
  if (!ctx) return false;
  const px = Math.floor((ix / IMG_W) * w);
  const py = Math.floor((iy / IMG_H) * h);
  if (px < 0 || py < 0 || px >= w || py >= h) return false;
  return ctx.getImageData(px, py, 1, 1).data[0] > 128;
}

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

function findClosestWall(startX, startY, mode) {
  let best = null;
  for (let i = 0; i < RAY_COUNT; i++) {
    const angle = (i / RAY_COUNT) * 2 * Math.PI;
    const hit = castRay(startX, startY, Math.cos(angle), Math.sin(angle), mode);
    if (hit && (!best || hit.dist < best.dist)) best = hit;
  }
  return best;
}

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

// Find a position for the traffic dot by sampling radially from dot1
function findTrafficPosition(dot1X, dot1Y) {
  const useTrafficMask = maskTrafficCtx !== null;

  for (let i = 0; i < MAX_ATTEMPTS * 4; i++) {
    const angle = Math.random() * 2 * Math.PI;
    const dist = TRAFFIC_MIN_DIST + Math.random() * (TRAFFIC_MAX_DIST - TRAFFIC_MIN_DIST);
    const x = dot1X + Math.cos(angle) * dist;
    const y = dot1Y + Math.sin(angle) * dist;

    if (x < 0 || y < 0 || x >= IMG_W || y >= IMG_H) continue;

    // Use traffic mask if loaded, otherwise fall back to default mask
    const allowed = useTrafficMask
      ? isAllowedTraffic(x, y)
      : isAllowedForMode(x, y, 'default');

    if (allowed) return { x, y };
  }

  // Last resort: return any point at valid distance ignoring mask
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const angle = Math.random() * 2 * Math.PI;
    const dist = TRAFFIC_MIN_DIST + Math.random() * (TRAFFIC_MAX_DIST - TRAFFIC_MIN_DIST);
    const x = dot1X + Math.cos(angle) * dist;
    const y = dot1Y + Math.sin(angle) * dist;
    if (x >= 0 && y >= 0 && x < IMG_W && y < IMG_H) return { x, y };
  }

  return null;
}

// Compute the traffic dot's line endpoint:
// direction = from traffic dot toward midpoint of first dot's line
// length = random 75–150px
function trafficLineEnd(dot2X, dot2Y, line1MidX, line1MidY) {
  const dx = line1MidX - dot2X;
  const dy = line1MidY - dot2Y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return { endX: dot2X + LINE_MIN_PX, endY: dot2Y };

  const normX = dx / len;
  const normY = dy / len;
  const lineLen = LINE_MIN_PX + Math.random() * (LINE_MAX_PX - LINE_MIN_PX);

  return {
    endX: dot2X + normX * lineLen,
    endY: dot2Y + normY * lineLen
  };
}

function addLineToSVG(svg, x1, y1, x2, y2) {
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line.setAttribute('x1', x1);
  line.setAttribute('y1', y1);
  line.setAttribute('x2', x2);
  line.setAttribute('y2', y2);
  line.setAttribute('stroke', '#FFE033');
  line.setAttribute('stroke-width', '1.5');
  line.setAttribute('stroke-linecap', 'round');
  svg.appendChild(line);
}

function clearSVG() {
  const svg = document.getElementById('line-overlay');
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  return svg;
}

function makeDotGroup(x, y, name, sublabelText, sublabel2Text) {
  const group = document.createElement('div');
  group.className = 'dot-group';
  group.style.left = x + 'px';
  group.style.top = y + 'px';

  const dot = document.createElement('div');
  dot.className = 'dot';

  const label = document.createElement('span');
  label.className = 'dot-label';
  label.textContent = name;

  group.appendChild(dot);
  group.appendChild(label);

  if (sublabelText) {
    const sublabel = document.createElement('span');
    sublabel.className = 'dot-sublabel';
    sublabel.textContent = sublabelText;
    group.appendChild(sublabel);
  }

  if (sublabel2Text) {
    const sublabel2 = document.createElement('span');
    sublabel2.className = 'dot-sublabel2';
    sublabel2.textContent = sublabel2Text;
    group.appendChild(sublabel2);
  }

  return group;
}

function generate() {
  const canvas = document.getElementById('canvas');

  // Remove all existing dot groups
  canvas.querySelectorAll('.dot-group').forEach(el => el.remove());

  const svg = clearSVG();
  const mode = getMode();

  if (mode === 'traffic') {
    // --- First dot: default mode (mask + walls, 75–150px) ---
    let pos1, wall1;
    let tries = 0;
    while (tries < MAX_ATTEMPTS) {
      pos1 = randomPosition('default');
      wall1 = findClosestWall(pos1.x, pos1.y, 'default');
      if (wall1 && wall1.dist >= LINE_MIN_PX && wall1.dist <= LINE_MAX_PX) break;
      wall1 = null;
      tries++;
    }
    if (!wall1) {
      console.warn('Could not place first traffic dot.');
      return;
    }

    // Midpoint of first dot's line
    const mid1X = (pos1.x + wall1.endX) / 2;
    const mid1Y = (pos1.y + wall1.endY) / 2;

    // --- Second dot: traffic mask, 100–300px from dot1, line toward mid1 ---
    const pos2 = findTrafficPosition(pos1.x, pos1.y);
    if (!pos2) {
      console.warn('Could not place second traffic dot.');
      return;
    }

    const line2End = trafficLineEnd(pos2.x, pos2.y, mid1X, mid1Y);

    // Draw both lines
    addLineToSVG(svg, pos1.x, pos1.y, wall1.endX, wall1.endY);
    addLineToSVG(svg, pos2.x, pos2.y, line2End.endX, line2End.endY);

    // First dot group
    canvas.appendChild(makeDotGroup(pos1.x, pos1.y, randomName(), 'KXXX', null));

    // Second dot group
    canvas.appendChild(makeDotGroup(pos2.x, pos2.y, randomName(), 'KXXX', null));

  } else {
    // --- Single dot modes ---
    let pos, wall;
    let tries = 0;

    if (mode === 'kgwo' || mode === 'om8') {
      while (tries < MAX_ATTEMPTS) {
        pos = randomPosition(mode);
        wall = findRandomDirectionWall(pos.x, pos.y, mode);
        if (wall) break;
        tries++;
      }
    } else {
      while (tries < MAX_ATTEMPTS) {
        pos = randomPosition(mode);
        wall = findClosestWall(pos.x, pos.y, mode);
        if (wall && wall.dist >= LINE_MIN_PX && wall.dist <= LINE_MAX_PX) break;
        wall = null;
        tries++;
      }
    }

    if (!wall) { console.warn('Could not find a valid position.'); return; }

    addLineToSVG(svg, pos.x, pos.y, wall.endX, wall.endY);

    let sublabelText, sublabel2Text = null;
    if (mode === 'kgwo') {
      sublabelText = randomSublabel();
      sublabel2Text = 'KGWO';
    } else if (mode === 'om8') {
      sublabelText = '0M8';
    } else {
      sublabelText = 'KXXX';
    }

    canvas.appendChild(makeDotGroup(pos.x, pos.y, randomName(), sublabelText, sublabel2Text));
  }
}

// ── Custom Mode ──────────────────────────────────────────────

function toggleCustomMode() {
  customModeActive = !customModeActive;
  const btn = document.getElementById('custom-btn');
  const overlay = document.getElementById('custom-overlay');
  const hint = document.getElementById('custom-hint');
  const clearBtn = document.getElementById('clear-btn');
  const generateBtn = document.getElementById('generate-btn');

  if (customModeActive) {
    btn.classList.add('active');
    btn.textContent = 'Custom Mode ON';
    overlay.style.display = 'block';
    clearBtn.style.display = 'block';
    generateBtn.style.display = 'none';
    hint.style.display = 'block';
    hint.textContent = 'Click to place a dot';
    customClickStep = 0;
    // Clear generated dots when entering custom mode
    document.querySelectorAll('.dot-group:not(.custom-dot)').forEach(el => el.remove());
    clearSVG();
  } else {
    btn.classList.remove('active');
    btn.textContent = 'Custom Mode';
    overlay.style.display = 'none';
    hint.style.display = 'none';
    clearBtn.style.display = 'none';
    generateBtn.style.display = 'block';
    removeGhost();
    customClickStep = 0;
  }
}

function removeGhost() {
  if (ghostDotEl) {
    ghostDotEl.remove();
    ghostDotEl = null;
  }
}

function clearAll() {
  document.querySelectorAll('.dot-group').forEach(el => el.remove());
  clearSVG();
  removeGhost();
  customClickStep = 0;
  const hint = document.getElementById('custom-hint');
  if (hint) hint.textContent = 'Click to place a dot';
}

function getEventPos(e) {
  const rect = document.getElementById('custom-overlay').getBoundingClientRect();
  return {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top
  };
}

function addCustomLine(x1, y1, x2, y2) {
  const svg = document.getElementById('line-overlay');
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line.setAttribute('x1', x1);
  line.setAttribute('y1', y1);
  line.setAttribute('x2', x2);
  line.setAttribute('y2', y2);
  line.setAttribute('stroke', '#FFE033');
  line.setAttribute('stroke-width', '1.5');
  line.setAttribute('stroke-linecap', 'round');
  line.classList.add('custom-line');
  svg.appendChild(line);
}

function onCustomClick(e) {
  if (!customModeActive) return;
  const { x, y } = getEventPos(e);
  const hint = document.getElementById('custom-hint');

  if (customClickStep === 0) {
    // First click — place ghost dot, record position and assign name
    removeGhost();
    customDotX = x;
    customDotY = y;
    customDotName = randomName();

    ghostDotEl = document.createElement('div');
    ghostDotEl.className = 'ghost-dot';
    ghostDotEl.style.left = x + 'px';
    ghostDotEl.style.top = y + 'px';
    document.getElementById('canvas').appendChild(ghostDotEl);

    hint.textContent = 'Now click where the line should end';
    customClickStep = 1;

  } else if (customClickStep === 1) {
    // Second click — draw the real dot and line, remove ghost
    removeGhost();

    addCustomLine(customDotX, customDotY, x, y);

    const group = makeDotGroup(customDotX, customDotY, customDotName, null, null);
    group.classList.add('custom-dot');
    document.getElementById('canvas').appendChild(group);

    hint.textContent = 'Click to place a dot';
    customClickStep = 0;
  }
}

document.getElementById('custom-overlay').addEventListener('click', onCustomClick);

// ─────────────────────────────────────────────────────────────

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

  const maskTrafficResult = await loadImage('mask_traffic.png', 'mask-traffic-canvas');
  if (maskTrafficResult) { maskTrafficCtx = maskTrafficResult.ctx; maskTrafficWidth = maskTrafficResult.width; maskTrafficHeight = maskTrafficResult.height; }

  generate();
}

init();

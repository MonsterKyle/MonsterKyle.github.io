const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS = '0123456789';

let maskCtx = null;
let maskWidth = 0;
let maskHeight = 0;

let wallsCtx = null;
let wallsWidth = 0;
let wallsHeight = 0;

const MAX_ATTEMPTS = 500;
const RAY_COUNT = 72;
const LINE_MIN_PX = 75;
const LINE_MAX_PX = 150;

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

function isAllowedPx(px, py) {
  if (!maskCtx) return true;
  if (px < 0 || py < 0 || px >= maskWidth || py >= maskHeight) return false;
  return maskCtx.getImageData(px, py, 1, 1).data[0] > 128;
}

function isAllowed(xPct, yPct) {
  return isAllowedPx(
    Math.floor((xPct / 100) * maskWidth),
    Math.floor((yPct / 100) * maskHeight)
  );
}

function isWallPx(px, py) {
  if (!wallsCtx) return false;
  if (px < 0 || py < 0 || px >= wallsWidth || py >= wallsHeight) return false;
  return wallsCtx.getImageData(px, py, 1, 1).data[0] > 128;
}

// Cast a ray in screen pixels using walls.png.
// Returns the screen-pixel endpoint (clamped to LINE_MIN–LINE_MAX).
function castRay(startScreenX, startScreenY, dx, dy) {
  const screenW = window.innerWidth;
  const screenH = window.innerHeight;

  // Determine random target length for this ray
  const targetLen = LINE_MIN_PX + Math.random() * (LINE_MAX_PX - LINE_MIN_PX);

  for (let step = 1; step <= LINE_MAX_PX; step++) {
    const sx = startScreenX + dx * step;
    const sy = startScreenY + dy * step;

    // Convert screen pixel to walls.png pixel
    const wx = Math.floor((sx / screenW) * wallsWidth);
    const wy = Math.floor((sy / screenH) * wallsHeight);

    const hitWall = isWallPx(wx, wy);
    const reachedTarget = step >= targetLen;

    if (hitWall || reachedTarget) {
      return { sx, sy, dist: step, hitWall };
    }
  }

  // Fallback: end at max length
  return {
    sx: startScreenX + dx * LINE_MAX_PX,
    sy: startScreenY + dy * LINE_MAX_PX,
    dist: LINE_MAX_PX,
    hitWall: false
  };
}

// Pick a random direction and cast one ray from the dot's screen position.
function findLineEnd(dotXPct, dotYPct) {
  const screenX = (dotXPct / 100) * window.innerWidth;
  const screenY = (dotYPct / 100) * window.innerHeight;

  // Pick a random angle
  const angle = Math.random() * 2 * Math.PI;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);

  return castRay(screenX, screenY, dx, dy);
}

function randomName() {
  let name = 'N';
  const numCount = Math.floor(Math.random() * 2) + 2;
  for (let i = 0; i < numCount; i++) {
    name += DIGITS[Math.floor(Math.random() * DIGITS.length)];
  }
  const letCount = Math.floor(Math.random() * 2) + 1;
  for (let i = 0; i < letCount; i++) {
    name += LETTERS[Math.floor(Math.random() * LETTERS.length)];
  }
  return name;
}

function randomPosition() {
  const margin = 2;
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const x = margin + Math.random() * (100 - margin * 2);
    const y = margin + Math.random() * (100 - margin * 2);
    if (isAllowed(x, y)) return { x, y };
  }
  console.warn('Could not find a valid position in mask — placing at center.');
  return { x: 50, y: 50 };
}

function drawLine(dotXPct, dotYPct, endScreenX, endScreenY) {
  const svg = document.getElementById('line-overlay');
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  // Convert dot percent to screen px for SVG (SVG uses viewBox matching screen)
  const startScreenX = (dotXPct / 100) * window.innerWidth;
  const startScreenY = (dotYPct / 100) * window.innerHeight;

  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line.setAttribute('x1', startScreenX);
  line.setAttribute('y1', startScreenY);
  line.setAttribute('x2', endScreenX);
  line.setAttribute('y2', endScreenY);
  line.setAttribute('stroke', '#FFE033');
  line.setAttribute('stroke-width', '1.5');
  line.setAttribute('stroke-linecap', 'round');

  svg.appendChild(line);
}

function updateSVGViewBox() {
  const svg = document.getElementById('line-overlay');
  svg.setAttribute('viewBox', `0 0 ${window.innerWidth} ${window.innerHeight}`);
}

function generate() {
  updateSVGViewBox();
  const canvas = document.getElementById('canvas');

  const existing = canvas.querySelector('.dot-group');
  if (existing) existing.remove();

  const { x, y } = randomPosition();
  const name = randomName();

  const end = findLineEnd(x, y);
  drawLine(x, y, end.sx, end.sy);

  const group = document.createElement('div');
  group.className = 'dot-group';
  group.style.left = x + '%';
  group.style.top = y + '%';

  const dot = document.createElement('div');
  dot.className = 'dot';

  const label = document.createElement('span');
  label.className = 'dot-label';
  label.textContent = name;

  group.appendChild(dot);
  group.appendChild(label);
  canvas.appendChild(group);
}

async function init() {
  const maskResult = await loadImage('mask.png', 'mask-canvas');
  if (maskResult) {
    maskCtx = maskResult.ctx;
    maskWidth = maskResult.width;
    maskHeight = maskResult.height;
  }

  const wallsResult = await loadImage('walls.png', 'walls-canvas');
  if (wallsResult) {
    wallsCtx = wallsResult.ctx;
    wallsWidth = wallsResult.width;
    wallsHeight = wallsResult.height;
  }

  generate();
}

window.addEventListener('resize', updateSVGViewBox);
init();

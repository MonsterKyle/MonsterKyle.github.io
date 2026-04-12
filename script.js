const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS = '0123456789';

const IMG_W = 1078;
const IMG_H = 908;

let maskCtx = null;
let maskWidth = 0;
let maskHeight = 0;

let wallsCtx = null;
let wallsWidth = 0;
let wallsHeight = 0;

const MAX_ATTEMPTS = 500;
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

// Sample mask.png — white pixel = allowed zone
function isAllowedPx(px, py) {
  if (!maskCtx) return true;
  if (px < 0 || py < 0 || px >= maskWidth || py >= maskHeight) return false;
  return maskCtx.getImageData(px, py, 1, 1).data[0] > 128;
}

// Convert image coords (0–IMG_W/H) to mask pixel and check
function isAllowed(ix, iy) {
  const px = Math.floor((ix / IMG_W) * maskWidth);
  const py = Math.floor((iy / IMG_H) * maskHeight);
  return isAllowedPx(px, py);
}

// Sample walls.png — white pixel = wall
function isWallPx(px, py) {
  if (!wallsCtx) return false;
  if (px < 0 || py < 0 || px >= wallsWidth || py >= wallsHeight) return false;
  return wallsCtx.getImageData(px, py, 1, 1).data[0] > 128;
}

function isWall(ix, iy) {
  const px = Math.floor((ix / IMG_W) * wallsWidth);
  const py = Math.floor((iy / IMG_H) * wallsHeight);
  return isWallPx(px, py);
}

// Cast a ray from image-pixel (startX, startY) in direction (dx, dy).
// Stops at a wall or at a random length between LINE_MIN_PX and LINE_MAX_PX.
function castRay(startX, startY, dx, dy) {
  const targetLen = LINE_MIN_PX + Math.random() * (LINE_MAX_PX - LINE_MIN_PX);

  for (let step = 1; step <= LINE_MAX_PX; step++) {
    const x = startX + dx * step;
    const y = startY + dy * step;

    if (isWall(x, y) || step >= targetLen) {
      return { x, y };
    }
  }

  return {
    x: startX + dx * LINE_MAX_PX,
    y: startY + dy * LINE_MAX_PX
  };
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

// Returns position in image pixels (0–IMG_W, 0–IMG_H)
function randomPosition() {
  const margin = Math.floor(IMG_W * 0.02);
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const x = margin + Math.random() * (IMG_W - margin * 2);
    const y = margin + Math.random() * (IMG_H - margin * 2);
    if (isAllowed(x, y)) return { x, y };
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

  const { x, y } = randomPosition();
  const name = randomName();

  // Pick a random direction and cast ray
  const angle = Math.random() * 2 * Math.PI;
  const end = castRay(x, y, Math.cos(angle), Math.sin(angle));
  drawLine(x, y, end.x, end.y);

  // Position dot using image-pixel coords as percentages of the fixed canvas
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

init();

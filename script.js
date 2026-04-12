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
const RAY_COUNT = 360;
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

function isAllowed(ix, iy) {
  const px = Math.floor((ix / IMG_W) * maskWidth);
  const py = Math.floor((iy / IMG_H) * maskHeight);
  return isAllowedPx(px, py);
}

function isWall(ix, iy) {
  if (!wallsCtx) return false;
  const px = Math.floor((ix / IMG_W) * wallsWidth);
  const py = Math.floor((iy / IMG_H) * wallsHeight);
  if (px < 0 || py < 0 || px >= wallsWidth || py >= wallsHeight) return false;
  return wallsCtx.getImageData(px, py, 1, 1).data[0] > 128;
}

// Cast one ray, return distance to first wall hit (or Infinity if none within LINE_MAX_PX)
function castRay(startX, startY, dx, dy) {
  for (let step = 1; step <= LINE_MAX_PX; step++) {
    const x = startX + dx * step;
    const y = startY + dy * step;
    if (isWall(x, y)) {
      return { dist: step, endX: x, endY: y };
    }
  }
  return null; // no wall found within range
}

// Fire RAY_COUNT rays, return the closest wall hit — or null if none in range
function findClosestWall(startX, startY) {
  let best = null;
  for (let i = 0; i < RAY_COUNT; i++) {
    const angle = (i / RAY_COUNT) * 2 * Math.PI;
    const hit = castRay(startX, startY, Math.cos(angle), Math.sin(angle));
    if (hit && (!best || hit.dist < best.dist)) {
      best = hit;
    }
  }
  return best; // null if no wall found in any direction within LINE_MAX_PX
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

  // Keep trying new positions until we find one whose closest wall
  // is between LINE_MIN_PX and LINE_MAX_PX away
  let pos, wall;
  let tries = 0;
  while (tries < MAX_ATTEMPTS) {
    pos = randomPosition();
    wall = findClosestWall(pos.x, pos.y);

    if (wall && wall.dist >= LINE_MIN_PX && wall.dist <= LINE_MAX_PX) {
      break; // valid spot found
    }
    wall = null;
    tries++;
  }

  if (!wall) {
    console.warn('Could not find a position with a wall in the valid range.');
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

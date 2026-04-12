const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS = '0123456789';

// Holds the mask canvas context once the image is loaded
let maskCtx = null;
let maskWidth = 0;
let maskHeight = 0;
const MAX_ATTEMPTS = 500;

function loadMask() {
  return new Promise((resolve) => {
    const img = new Image();
    img.src = 'mask.png';
    img.onload = () => {
      const canvas = document.getElementById('mask-canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      maskWidth = img.naturalWidth;
      maskHeight = img.naturalHeight;
      maskCtx = canvas.getContext('2d');
      maskCtx.drawImage(img, 0, 0);
      resolve();
    };
    img.onerror = () => {
      console.warn('mask.png not found — dots will generate anywhere.');
      resolve();
    };
  });
}

function isAllowed(xPct, yPct) {
  if (!maskCtx) return true;
  const px = Math.floor((xPct / 100) * maskWidth);
  const py = Math.floor((yPct / 100) * maskHeight);
  const pixel = maskCtx.getImageData(px, py, 1, 1).data;
  // Allow if the pixel is more white than black (R > 128)
  return pixel[0] > 128;
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
  // Fallback: return center if no valid spot found after max attempts
  console.warn('Could not find a valid position in mask — placing at center.');
  return { x: 50, y: 50 };
}

function generate() {
  const canvas = document.getElementById('canvas');

  const existing = canvas.querySelector('.dot-group');
  if (existing) existing.remove();

  const { x, y } = randomPosition();
  const name = randomName();

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

// Load the mask first, then generate the first dot
loadMask().then(() => generate());

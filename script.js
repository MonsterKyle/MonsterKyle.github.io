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

// Wrap text elements in a block with a small drag handle
function makeDraggableTextBlock(initialOffsetX, initialOffsetY) {
  const block = document.createElement('div');
  block.className = 'dot-text-block';
  block.style.transform = `translate(${initialOffsetX}px, ${initialOffsetY}px)`;

  let offsetX = initialOffsetX;
  let offsetY = initialOffsetY;
  const LIMIT = 120;

  // Drag handle — appears top-right on hover
  const handle = document.createElement('div');
  handle.className = 'text-drag-handle';
  handle.title = 'Drag to reposition';
  handle.innerHTML = '⠿';
  block.appendChild(handle);

  // Delete button — appears top-right next to handle on hover
  const deleteBtn = document.createElement('div');
  deleteBtn.className = 'dot-delete-btn';
  deleteBtn.title = 'Delete';
  deleteBtn.innerHTML = '✕';
  block.appendChild(deleteBtn);

  deleteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    // Find parent dot-group and its dotId
    const group = block.closest('.dot-group');
    if (!group) return;
    const dotId = group.dataset.dotId;
    // Remove line and handle from SVG
    if (dotId) {
      document.querySelectorAll(`[data-dot-id="${dotId}"]`).forEach(el => {
        if (el !== group) el.remove();
      });
    }
    group.remove();
  });

  deleteBtn.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    altDropdownInteracting = true;
    setTimeout(() => { altDropdownInteracting = false; }, 300);
  });

  handle.addEventListener('mousedown', startTextDrag);
  handle.addEventListener('touchstart', (e) => {
    e.preventDefault();
    startTextDrag({ clientX: e.touches[0].clientX, clientY: e.touches[0].clientY,
                    stopPropagation: () => {}, preventDefault: () => {} });
  }, { passive: false });

  function startTextDrag(e) {
    e.stopPropagation();
    e.preventDefault();
    altDropdownInteracting = true;
    setTimeout(() => { altDropdownInteracting = false; }, 300);
    handle.style.cursor = 'grabbing';
    const scale = getScale();
    const startX = e.clientX / scale;
    const startY = e.clientY / scale;
    const origX = offsetX;
    const origY = offsetY;

    function onMove(ev) {
      const cx = ev.touches ? ev.touches[0].clientX : ev.clientX;
      const cy = ev.touches ? ev.touches[0].clientY : ev.clientY;
      let nx = origX + (cx / scale - startX);
      let ny = origY + (cy / scale - startY);
      const dist = Math.sqrt(nx * nx + ny * ny);
      if (dist > LIMIT) {
        nx = (nx / dist) * LIMIT;
        ny = (ny / dist) * LIMIT;
      }
      offsetX = nx;
      offsetY = ny;
      block.style.transform = `translate(${nx}px, ${ny}px)`;
    }

    function onUp() {
      handle.style.cursor = 'grab';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
    }

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onUp);
  }

  return block;
}


function makeEditableSpan(el) {
  el.style.cursor = 'text';
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    if (el.querySelector('input')) return; // already editing
    const current = el.textContent;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'alt-num-input';
    input.value = current;
    input.style.width = Math.max(40, current.length * 10) + 'px';
    el.textContent = '';
    el.appendChild(input);
    input.focus();
    input.select();

    function commit() {
      el.textContent = input.value.trim() || current;
    }
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); input.blur(); }
      if (e.key === 'Escape') { el.textContent = current; }
      e.stopPropagation();
    });
    input.addEventListener('click', e => e.stopPropagation());
  });
  return el;
}

function makeDotGroup(x, y, name, sublabelText, sublabel2Text, sublabel3Text) {
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

  if (sublabel3Text) {
    const sublabel3 = document.createElement('span');
    sublabel3.className = 'dot-sublabel3';
    sublabel3.textContent = sublabel3Text;
    group.appendChild(sublabel3);
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
  const normalOptions = document.getElementById('normal-options');
  const customOptions = document.getElementById('custom-options');

  if (customModeActive) {
    btn.classList.add('active');
    btn.textContent = 'Custom Mode ON';
    overlay.style.display = 'block';
    clearBtn.style.display = 'block';
    generateBtn.style.display = 'none';
    normalOptions.style.display = 'none';
    customOptions.style.display = 'flex';
    hint.style.display = 'block';
    hint.textContent = 'Click to place a dot';
    customClickStep = 0;
    document.getElementById('canvas').style.zIndex = '55';
    document.getElementById('canvas').style.cursor = 'crosshair';
    document.getElementById('line-overlay').style.zIndex = '60';
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
    normalOptions.style.display = 'flex';
    customOptions.style.display = 'none';
    document.getElementById('canvas').style.zIndex = '1';
    document.getElementById('canvas').style.cursor = 'default';
    document.getElementById('line-overlay').style.zIndex = '2';
    removeGhost();
    customClickStep = 0;
  }
}

function isCid() {
  return document.getElementById('cid-checkbox').checked;
}

function isLowAlt()    { return document.getElementById('low-alt-checkbox').checked; }
function isHighAlt()   { return document.getElementById('high-alt-checkbox').checked; }
function isCustomAlt() { return document.getElementById('custom-alt-checkbox').checked; }

// Populate custom altitude dropdown: 0–240 in multiples of 10
const customAltSelect = document.getElementById('custom-alt-select');
for (let v = 0; v <= 240; v += 10) {
  const opt = document.createElement('option');
  opt.value = v;
  opt.textContent = v + 'C';
  customAltSelect.appendChild(opt);
}

// All three altitude checkboxes are mutually exclusive
const ALT_CHECKBOX_IDS = ['low-alt-checkbox', 'high-alt-checkbox', 'custom-alt-checkbox'];
ALT_CHECKBOX_IDS.forEach(id => {
  document.getElementById(id).addEventListener('change', () => {
    if (document.getElementById(id).checked) {
      ALT_CHECKBOX_IDS.filter(b => b !== id).forEach(b => {
        document.getElementById(b).checked = false;
      });
    }
  });
});

function randomAltitude() {
  if (isLowAlt()) {
    const steps = (100 - 40) / 10;
    return (40 + Math.floor(Math.random() * (steps + 1)) * 10) + 'C';
  }
  if (isHighAlt()) {
    const steps = (230 - 130) / 10;
    return (130 + Math.floor(Math.random() * (steps + 1)) * 10) + 'C';
  }
  if (isCustomAlt()) {
    return document.getElementById('custom-alt-select').value + 'C';
  }
  return null;
}

// Track used CIDs so each dot gets a unique one per session
const usedCids = new Set();
function randomCid() {
  if (usedCids.size >= 101) usedCids.clear(); // reset if all used
  let cid;
  do {
    cid = String(Math.floor(Math.random() * 101)).padStart(3, '0');
  } while (usedCids.has(cid));
  usedCids.add(cid);
  return cid;
}

// Flag set when user interacts with a dropdown option — prevents accidental dot placement
let altDropdownInteracting = false;

const ALT_SYMBOLS = ['C', 'B', '↑', '↓', 'T'];

// Build an interactive altitude widget for custom dots
// altText is e.g. "70C" — number + symbol
function makeAltitudeWidget(altText) {
  // Parse number and symbol from altText
  const match = altText.match(/^(\d+)(C|B|↑|↓|T)$/);
  const initNum = match ? match[1] : altText.replace(/[^\d]/g, '') || '0';
  const initSym = match ? match[2] : 'C';

  const wrapper = document.createElement('span');
  wrapper.className = 'alt-widget';

  // Left number — click to edit inline
  const numLeft = document.createElement('span');
  numLeft.className = 'alt-num';
  numLeft.textContent = initNum;

  // Symbol — click to open dropdown
  const sym = document.createElement('span');
  sym.className = 'alt-sym';
  const symText = document.createTextNode(initSym);
  sym.appendChild(symText);

  // Right number — only visible when symbol is not C
  const numRight = document.createElement('span');
  numRight.className = 'alt-num';
  numRight.textContent = initNum;
  numRight.style.display = initSym === 'C' ? 'none' : 'inline';

  // Symbol dropdown
  const dropdown = document.createElement('div');
  dropdown.className = 'alt-sym-dropdown';
  dropdown.style.display = 'none';
  ALT_SYMBOLS.forEach(s => {
    const opt = document.createElement('div');
    opt.className = 'alt-sym-option';
    opt.textContent = s;
    opt.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      altDropdownInteracting = true;
      setTimeout(() => { altDropdownInteracting = false; }, 300);
      let chosen = s;

      // Auto-correct arrows based on left vs right number
      if (chosen === '↑' || chosen === '↓') {
        const leftVal  = parseFloat(numLeft.textContent)  || 0;
        const rightVal = parseFloat(numRight.textContent) || leftVal;
        if (rightVal > leftVal)  chosen = '↑';
        if (rightVal < leftVal)  chosen = '↓';
      }

      symText.nodeValue = chosen;
      numRight.style.display = chosen === 'C' ? 'none' : 'inline';
      dropdown.style.display = 'none';
    });
    dropdown.appendChild(opt);
  });
  dropdown.addEventListener('click', e => e.stopPropagation());
  dropdown.addEventListener('mousedown', e => e.stopPropagation());
  sym.appendChild(dropdown);

  // Open/close dropdown on symbol click
  sym.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = dropdown.style.display === 'flex';
    closeAllAltDropdowns();
    if (!isOpen) {
      dropdown.style.display = 'flex';
      dropdown.style.flexDirection = 'column';
    }
  });

  // Inline editing for left number
  numLeft.addEventListener('click', (e) => {
    e.stopPropagation();
    startNumEdit(numLeft);
  });

  // Inline editing for right number — re-checks arrow direction after commit
  numRight.addEventListener('click', (e) => {
    e.stopPropagation();
    const current = numRight.textContent;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'alt-num-input';
    input.value = current;
    numRight.textContent = '';
    numRight.appendChild(input);
    input.focus();
    input.select();

    function commitRight() {
      const val = input.value.trim() || current;
      numRight.textContent = val;
      // Auto-correct arrow if symbol is ↑ or ↓
      const curSym = symText.nodeValue;
      if (curSym === '↑' || curSym === '↓') {
        const leftVal  = parseFloat(numLeft.textContent)  || 0;
        const rightVal = parseFloat(val) || 0;
        if (rightVal > leftVal)  symText.nodeValue = '↑';
        if (rightVal < leftVal)  symText.nodeValue = '↓';
      }
    }

    input.addEventListener('blur', commitRight);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commitRight(); input.blur(); }
      if (e.key === 'Escape') { numRight.textContent = current; }
      e.stopPropagation();
    });
    input.addEventListener('click', e => e.stopPropagation());
  });

  wrapper.addEventListener('click', e => e.stopPropagation());
  wrapper.appendChild(numLeft);
  wrapper.appendChild(sym);
  wrapper.appendChild(numRight);

  return wrapper;
}

function startNumEdit(el) {
  const current = el.textContent;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'alt-num-input';
  input.value = current;
  el.textContent = '';
  el.appendChild(input);
  input.focus();
  input.select();

  function commit() {
    const val = input.value.trim() || current;
    el.textContent = val;
  }

  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); input.blur(); }
    if (e.key === 'Escape') { el.textContent = current; }
    e.stopPropagation();
  });
  input.addEventListener('click', e => e.stopPropagation());
}

function closeAllAltDropdowns() {
  document.querySelectorAll('.alt-sym-dropdown').forEach(d => d.style.display = 'none');
}

// Close dropdowns when clicking elsewhere
document.addEventListener('click', closeAllAltDropdowns);

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

function getScale() {
  const t = document.body.style.transform;
  return t ? parseFloat(t.replace('scale(', '').replace(')', '')) || 1 : 1;
}

function getEventPos(e) {
  const rect = document.getElementById('canvas').getBoundingClientRect();
  const scale = getScale();
  return {
    x: (e.clientX - rect.left) / scale,
    y: (e.clientY - rect.top)  / scale
  };
}

function addCustomLine(x1, y1, x2, y2, dotId) {
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
  line.dataset.dotId = dotId;
  svg.appendChild(line);

  // Draggable endpoint handle
  const handle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  handle.setAttribute('cx', x2);
  handle.setAttribute('cy', y2);
  handle.setAttribute('r', 6);
  handle.setAttribute('fill', '#FFE033');
  handle.setAttribute('fill-opacity', '0.01');
  handle.setAttribute('stroke', '#FFE033');
  handle.setAttribute('stroke-width', '1.5');
  handle.setAttribute('stroke-opacity', '0');
  handle.style.cursor = 'grab';
  handle.classList.add('line-handle');
  handle.dataset.dotId = dotId;
  svg.appendChild(handle);

  // Show handle ring on hover
  handle.addEventListener('mouseenter', () => {
    handle.setAttribute('stroke-opacity', '1');
    handle.setAttribute('fill-opacity', '0.2');
  });
  handle.addEventListener('mouseleave', () => {
    handle.setAttribute('stroke-opacity', '0');
    handle.setAttribute('fill-opacity', '0.01');
  });

  // Drag endpoint — mouse and touch
  handle.addEventListener('mousedown', startHandleDrag);
  handle.addEventListener('touchstart', (e) => {
    e.preventDefault();
    startHandleDrag({ clientX: e.touches[0].clientX, clientY: e.touches[0].clientY,
                      stopPropagation: () => {}, preventDefault: () => {} });
  }, { passive: false });

  function startHandleDrag(e) {
    e.stopPropagation();
    e.preventDefault();
    handle.style.cursor = 'grabbing';
    const svgRect = svg.getBoundingClientRect();
    const scale = getScale();

    function onMove(ev) {
      const cx = ev.touches ? ev.touches[0].clientX : ev.clientX;
      const cy = ev.touches ? ev.touches[0].clientY : ev.clientY;
      const nx = (cx - svgRect.left) / scale;
      const ny = (cy - svgRect.top)  / scale;
      line.setAttribute('x2', nx);
      line.setAttribute('y2', ny);
      handle.setAttribute('cx', nx);
      handle.setAttribute('cy', ny);
    }

    function onUp() {
      handle.style.cursor = 'grab';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
    }

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onUp);
  }

  return { line, handle };
}

function onCustomClick(e) {
  if (!customModeActive) return;
  if (altDropdownInteracting) return;
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

    const dotId = 'dot-' + Date.now();
    addCustomLine(customDotX, customDotY, x, y, dotId);

    const cidText = isCid() ? randomCid() : null;
    const altText = randomAltitude();

    const group = document.createElement('div');
    group.className = 'dot-group custom-dot';
    group.style.left = customDotX + 'px';
    group.style.top  = customDotY + 'px';
    group.dataset.dotId = dotId;

    const dot = document.createElement('div');
    dot.className = 'dot';
    dot.style.cursor = 'grab';
    group.appendChild(dot);

    dot.addEventListener('mousedown', (e) => {
      if (e.type === 'mousedown' && e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents) return;
      startDotDrag(e);
    });
    dot.addEventListener('touchstart', (e) => {
      e.preventDefault();
      startDotDrag({ clientX: e.touches[0].clientX, clientY: e.touches[0].clientY,
                     stopPropagation: () => {}, preventDefault: () => {} });
    }, { passive: false });

    function startDotDrag(e) {
      e.stopPropagation();
      e.preventDefault();
      dot.style.cursor = 'grabbing';
      const canvasRect = document.getElementById('canvas').getBoundingClientRect();
      const scale = getScale();
      const startX = (e.clientX - canvasRect.left) / scale;
      const startY = (e.clientY - canvasRect.top)  / scale;
      const origLeft = parseFloat(group.style.left);
      const origTop  = parseFloat(group.style.top);

      function onMove(ev) {
        const cx = ev.touches ? ev.touches[0].clientX : ev.clientX;
        const cy = ev.touches ? ev.touches[0].clientY : ev.clientY;
        const nx = (cx - canvasRect.left) / scale;
        const ny = (cy - canvasRect.top)  / scale;
        const dx = nx - startX;
        const dy = ny - startY;
        const newLeft = origLeft + dx;
        const newTop  = origTop  + dy;
        group.style.left = newLeft + 'px';
        group.style.top  = newTop  + 'px';
        const line = document.querySelector(`.custom-line[data-dot-id="${dotId}"]`);
        if (line) {
          line.setAttribute('x1', newLeft);
          line.setAttribute('y1', newTop);
        }
      }

      function onUp() {
        dot.style.cursor = 'grab';
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        window.removeEventListener('touchmove', onMove);
        window.removeEventListener('touchend', onUp);
      }

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      window.addEventListener('touchmove', onMove, { passive: false });
      window.addEventListener('touchend', onUp);
    }

    // Name — editable
    const nameEl = document.createElement('span');
    nameEl.className = 'dot-label';
    nameEl.textContent = customDotName;
    makeEditableSpan(nameEl);

    // Build text block — starts at default offset (16px right, -8px up)
    const textBlock = makeDraggableTextBlock(16, -8);
    textBlock.appendChild(nameEl);

    // Altitude — interactive widget
    if (altText) {
      const altEl = document.createElement('span');
      altEl.className = 'dot-sublabel';
      altEl.appendChild(makeAltitudeWidget(altText));
      textBlock.appendChild(altEl);

      if (cidText) {
        const cidEl = document.createElement('span');
        cidEl.className = 'dot-sublabel2';
        cidEl.textContent = cidText;
        makeEditableSpan(cidEl);
        textBlock.appendChild(cidEl);
      }
    } else if (cidText) {
      const cidEl = document.createElement('span');
      cidEl.className = 'dot-sublabel';
      cidEl.textContent = cidText;
      makeEditableSpan(cidEl);
      textBlock.appendChild(cidEl);
    }

    group.appendChild(textBlock);

    document.getElementById('canvas').appendChild(group);

    hint.textContent = 'Click to place a dot';
    customClickStep = 0;
  }
}

document.getElementById('canvas').addEventListener('click', (e) => {
  if (!customModeActive) return;
  if (altDropdownInteracting) return;
  const blocked = (e.target.closest('.dot-group') && !e.target.closest('.ghost-dot')) ||
                  e.target.closest('.alt-widget') ||
                  e.target.closest('.alt-sym-dropdown') ||
                  e.target.closest('.alt-sym-option') ||
                  e.target.closest('.dot-text-block') ||
                  e.target.closest('.text-drag-handle') ||
                  e.target.closest('.dot-label') ||
                  e.target.closest('.dot-sublabel') ||
                  e.target.closest('.dot-sublabel2') ||
                  e.target.closest('.dot-sublabel3');
  if (!blocked) onCustomClick(e);
});

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

// ── Viewport scaling ──────────────────────────────────────────
function scaleToViewport() {
  const scaleX = window.innerWidth  / 1078;
  const scaleY = window.innerHeight / 908;
  const scale  = Math.min(scaleX, scaleY);
  document.body.style.transform = `scale(${scale})`;
  document.body.style.marginLeft = '0px';
  document.body.style.marginTop  = '0px';
}
scaleToViewport();
window.addEventListener('resize', scaleToViewport);

// ── Touch support ─────────────────────────────────────────────
// Convert a TouchEvent into a synthetic mouse-like event with corrected coords
function touchToMouseEvent(te, type) {
  const t = te.changedTouches[0];
  return { clientX: t.clientX, clientY: t.clientY, target: te.target,
           stopPropagation: () => te.stopPropagation(),
           preventDefault:  () => te.preventDefault(),
           type };
}

// Forward single-tap on canvas as a click for custom placement
document.getElementById('canvas').addEventListener('touchend', (e) => {
  if (!customModeActive) return;
  e.preventDefault();
  const synth = touchToMouseEvent(e, 'click');
  document.getElementById('canvas').dispatchEvent(new MouseEvent('click', {
    clientX: synth.clientX, clientY: synth.clientY, bubbles: true
  }));
}, { passive: false });

// Touch dragging for dot circle
function addTouchDrag(element, onMoveCallback, onUpCallback) {
  element.addEventListener('touchstart', (e) => {
    e.stopPropagation();
    e.preventDefault();
    const t = e.touches[0];
    const mockDown = { clientX: t.clientX, clientY: t.clientY,
                       stopPropagation: () => {}, preventDefault: () => {} };
    element.dispatchEvent(new MouseEvent('mousedown', {
      clientX: t.clientX, clientY: t.clientY, bubbles: false
    }));
  }, { passive: false });
}

init();

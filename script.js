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
let customClickStep = 0;
let customDotX = 0;
let customDotY = 0;
let customDotName = '';
let ghostDotEl = null;
let placingEnabled = true;

function togglePlacing() {
  placingEnabled = !placingEnabled;
  const btn = document.getElementById('place-toggle-btn');
  if (placingEnabled) {
    btn.textContent = 'Placing: ON';
    btn.classList.remove('placing-off');
    document.body.classList.remove('placing-off');
    document.getElementById('canvas').style.cursor = 'crosshair';
    document.getElementById('custom-hint').textContent = 'Click to place a dot';
    document.getElementById('custom-hint').style.display = 'block';
    // Shrink line handles back to normal
    document.querySelectorAll('.line-handle').forEach(h => {
      h.setAttribute('r', '6');
    });
  } else {
    btn.textContent = 'Placing: OFF';
    btn.classList.add('placing-off');
    document.body.classList.add('placing-off');
    document.getElementById('canvas').style.cursor = 'default';
    document.getElementById('custom-hint').style.display = 'none';
    // Enlarge line handles for easier grabbing
    document.querySelectorAll('.line-handle').forEach(h => {
      h.setAttribute('r', '14');
    });
    // Cancel any in-progress placement
    removeGhost();
    customClickStep = 0;
  }
}

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
    e.stopPropagation();
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
    if (btn) btn.classList.add('active');
    if (btn) btn.textContent = 'Custom Mode ON';
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
    document.querySelectorAll('.dot-group:not(.custom-dot)').forEach(el => el.remove());
    clearSVG();
  }
  /* OFF branch temporarily disabled
  else {
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
  */
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

    function selectOption(e) {
      e.stopPropagation();
      e.preventDefault();
      altDropdownInteracting = true;
      setTimeout(() => { altDropdownInteracting = false; }, 300);
      let chosen = s;
      if (chosen === '↑' || chosen === '↓') {
        const leftVal  = parseFloat(numLeft.textContent)  || 0;
        const rightVal = parseFloat(numRight.textContent) || leftVal;
        if (rightVal > leftVal)  chosen = '↑';
        if (rightVal < leftVal)  chosen = '↓';
      }
      symText.nodeValue = chosen;
      numRight.style.display = chosen === 'C' ? 'none' : 'inline';
      dropdown.style.display = 'none';
    }

    opt.addEventListener('mousedown', selectOption);
    opt.addEventListener('touchend', selectOption, { passive: false });
    dropdown.appendChild(opt);
  });
  dropdown.addEventListener('click', e => e.stopPropagation());
  dropdown.addEventListener('mousedown', e => e.stopPropagation());
  dropdown.addEventListener('touchstart', e => e.stopPropagation(), { passive: true });
  sym.appendChild(dropdown);

  // Open/close dropdown on symbol click or tap
  function toggleDropdown(e) {
    e.stopPropagation();
    const isOpen = dropdown.style.display === 'flex';
    closeAllAltDropdowns();
    if (!isOpen) {
      dropdown.style.display = 'flex';
      dropdown.style.flexDirection = 'column';
    }
  }
  sym.addEventListener('click', toggleDropdown);
  sym.addEventListener('touchend', (e) => {
    e.preventDefault();
    toggleDropdown(e);
  }, { passive: false });

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
  handle.setAttribute('r', placingEnabled ? '6' : '14');
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
    e.stopPropagation();
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

function setupDotDrag(dot, group, dotId) {
  dot.addEventListener('mousedown', (e) => {
    if (e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents) return;
    startDotDrag(e);
  });
  dot.addEventListener('touchstart', (e) => {
    e.preventDefault();
    e.stopPropagation();
    touchWasDrag = true;
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
      const newLeft = origLeft + (nx - startX);
      const newTop  = origTop  + (ny - startY);
      group.style.left = newLeft + 'px';
      group.style.top  = newTop  + 'px';
      const line = document.querySelector(`.custom-line[data-dot-id="${dotId}"]`);
      if (line) { line.setAttribute('x1', newLeft); line.setAttribute('y1', newTop); }
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
}

function onCustomClick(e) {
  if (!customModeActive) return;
  if (!placingEnabled) return;
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
    setupDotDrag(dot, group, dotId);

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

// ── Share / Load ──────────────────────────────────────────────

// Compress bytes using DeflateRaw, return base64 string
// ── Compression ───────────────────────────────────────────────
// Base85 (ASCII85 variant) — 20% denser than Base64
const B85 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!#$%&()*+-;<=>?@^_`{|}~';
function toBase85(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 4) {
    let v = 0, n = 0;
    for (let j = 0; j < 4; j++) {
      v = v * 256 + (i + j < bytes.length ? bytes[i + j] : 0);
      if (i + j < bytes.length) n++;
    }
    const chars = [];
    for (let j = 0; j < 5; j++) { chars.unshift(B85[v % 85]); v = Math.floor(v / 85); }
    out += chars.slice(0, n + 1).join('');
  }
  return out;
}
function fromBase85(str) {
  const out = [];
  let i = 0;
  while (i < str.length) {
    let v = 0, n = Math.min(5, str.length - i);
    for (let j = 0; j < 5; j++) {
      v = v * 85 + (j < n ? B85.indexOf(str[i + j]) : 84);
    }
    for (let j = 3; j >= 0; j--) { if (j < n - 1) out.push((v >> (j * 8)) & 0xff); v = v; }
    // correct byte extraction
    const bytes4 = [(v >> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
    out.splice(out.length - (n - 1), n - 1, ...bytes4.slice(0, n - 1));
    i += n;
  }
  return new Uint8Array(out);
}

async function compressBytes(bytes) {
  const cs = new CompressionStream('deflate-raw');
  const writer = cs.writable.getWriter();
  writer.write(bytes);
  writer.close();
  const chunks = [];
  const reader = cs.readable.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) { out.set(c, offset); offset += c.length; }
  return out;
}

async function decompressBytes(bytes) {
  const ds = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter();
  writer.write(bytes);
  writer.close();
  const chunks = [];
  const reader = ds.readable.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) { out.set(c, offset); offset += c.length; }
  return out;
}

// Binary buffer writer/reader
function makeBuf() {
  const data = [];
  return {
    u16(v) { data.push((v >> 8) & 0xff, v & 0xff); },
    i16(v) { const u = v < 0 ? v + 65536 : v; data.push((u >> 8) & 0xff, u & 0xff); },
    u8(v)  { data.push(v & 0xff); },
    str(s) { const e = new TextEncoder().encode(s); data.push(e.length, ...e); },
    bytes() { return new Uint8Array(data); }
  };
}
function makeReader(bytes) {
  let p = 0;
  return {
    u16()   { return (bytes[p++] << 8) | bytes[p++]; },
    i16()   { const v = (bytes[p++] << 8) | bytes[p++]; return v > 32767 ? v - 65536 : v; },
    u8()    { return bytes[p++]; },
    peekU8(){ return bytes[p]; },
    str()   { const len = bytes[p++]; return new TextDecoder().decode(bytes.slice(p, p += len)); },
    done()  { return p >= bytes.length; }
  };
}

// ── Preset tables for ultra-compact encoding ──────────────────
// Known sublabel strings → single byte index
const SUBL_PRESETS = ['KXXX','0M8','KGWO','VA','VA RWY5','RWY5'];
// Alt multiples of 10 from 0-240 → index (0-24)
const ALT_VALS = Array.from({length:25}, (_,i) => String(i*10));
const SYM_CHARS = ['C','B','↑','↓','T'];
const LETTERS26 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS10   = '0123456789';

// Pack a name string.
// Standard N + 2-3 digits + 1-2 letters:
//   byte0: 0x80 | (numLetters-1)<<5 | upper5bits(digits)
//   byte1: lower5bits(digits)<<3 | upper3bits(l0)
//   byte2: lower2bits(l0)<<6 | l1 (0=none, 1-26)
// This handles digits 0-999 (10 bits) and l0 0-25 (5 bits) cleanly.
function packName(buf, name) {
  const m = name.match(/^N(\d{2,3})([A-Z]{1,2})$/);
  if (m) {
    const digits = parseInt(m[1], 10);  // 0-999, 10 bits
    const lets   = m[2];
    const l0 = LETTERS26.indexOf(lets[0]);          // 0-25, 5 bits
    const l1 = lets.length > 1 ? LETTERS26.indexOf(lets[1]) + 1 : 0; // 0=none, 1-26, 5 bits
    const nl = lets.length - 1; // 0 or 1

    // digits: 10 bits → split as upper5 | lower5
    const dHi = (digits >> 5) & 0x1F;
    const dLo = digits & 0x1F;
    // l0: 5 bits → split as upper3 | lower2
    const l0Hi = (l0 >> 2) & 0x07;
    const l0Lo = l0 & 0x03;

    buf.u8(0x80 | (nl << 5) | dHi);
    buf.u8((dLo << 3) | l0Hi);
    buf.u8((l0Lo << 6) | l1);
    return;
  }
  buf.str(name);
}

function unpackName(r) {
  const b0 = r.peekU8();
  if (b0 & 0x80) {
    r.u8();
    const b1 = r.u8();
    const b2 = r.u8();
    const nl   = (b0 >> 5) & 1;
    const dHi  = b0 & 0x1F;
    const dLo  = (b1 >> 3) & 0x1F;
    const l0Hi = b1 & 0x07;
    const l0Lo = (b2 >> 6) & 0x03;
    const l1   = b2 & 0x3F;

    const digits = (dHi << 5) | dLo;
    const l0     = (l0Hi << 2) | l0Lo;

    let name = 'N' + digits + LETTERS26[l0];
    if (nl) name += LETTERS26[l1 - 1];
    return name;
  }
  return r.str();
}

// Pack altitude number — if it's a multiple of 10 in 0-240, use 1-byte index
// otherwise raw string. Returns true if packed as index.
function packAltNum(buf, s) {
  const v = parseInt(s, 10);
  const idx = ALT_VALS.indexOf(String(v));
  if (idx >= 0 && String(v) === s) {
    buf.u8(0x80 | idx); // high bit = indexed
    return;
  }
  buf.str(s); // raw (high bit won't be set since len byte < 0x80)
}

function unpackAltNum(r) {
  const b = r.peekU8();
  if (b & 0x80) { r.u8(); return ALT_VALS[b & 0x7F]; }
  return r.str();
}

// Encode layout as compact binary
function packLayout() {
  const buf = makeBuf();
  const groups = [...document.querySelectorAll('.custom-dot')];
  buf.u8(groups.length);
  groups.forEach(group => {
    const dotId = group.dataset.dotId;
    const x  = Math.round(parseFloat(group.style.left));
    const y  = Math.round(parseFloat(group.style.top));
    const lineEl = document.querySelector(`.custom-line[data-dot-id="${dotId}"]`);
    const lx = lineEl ? Math.round(parseFloat(lineEl.getAttribute('x2'))) : x + 100;
    const ly = lineEl ? Math.round(parseFloat(lineEl.getAttribute('y2'))) : y;
    const block = group.querySelector('.dot-text-block');
    const transform = block ? block.style.transform : 'translate(16px, -8px)';
    const match = transform.match(/translate\(([^,]+)px,\s*([^)]+)px\)/);
    const tx = match ? Math.round(parseFloat(match[1])) : 16;
    const ty = match ? Math.round(parseFloat(match[2])) : -8;
    const nameEl = group.querySelector('.dot-label');
    const name = nameEl ? nameEl.textContent.trim() : '';
    const altWidget = group.querySelector('.alt-widget');
    const sublabels = [];
    group.querySelectorAll('.dot-sublabel,.dot-sublabel2,.dot-sublabel3').forEach(el => {
      if (!el.querySelector('.alt-widget')) { const t = el.textContent.trim(); if (t) sublabels.push(t); }
    });

    // Coordinates: x,y,lx,ly as u16; tx,ty as i16 only if non-default
    buf.u16(x); buf.u16(y); buf.u16(lx); buf.u16(ly);

    // Flags: bit0=hasAlt, bit1=textMoved, bit2=hasSubl
    const hasAlt    = altWidget ? 1 : 0;
    const textMoved = (tx !== 16 || ty !== -8) ? 1 : 0;
    const hasSubl   = sublabels.length > 0 ? 1 : 0;
    buf.u8((hasSubl << 2) | (textMoved << 1) | hasAlt);

    if (textMoved) { buf.i16(tx); buf.i16(ty); }

    packName(buf, name);

    if (hasAlt) {
      const nums   = altWidget.querySelectorAll('.alt-num');
      const symEl  = altWidget.querySelector('.alt-sym');
      const symNode = symEl ? [...symEl.childNodes].find(n => n.nodeType === 3) : null;
      const sym    = symNode ? symNode.nodeValue : 'C';
      const symIdx = SYM_CHARS.indexOf(sym);
      const rightVis = nums[1] && nums[1].style.display !== 'none' ? 1 : 0;
      // Pack sym + rightVis in one byte: bits 0-2 = symIdx, bit3 = rightVis
      buf.u8((rightVis << 3) | (symIdx < 0 ? 0 : symIdx));
      packAltNum(buf, nums[0] ? nums[0].textContent.trim() : '0');
      packAltNum(buf, nums[1] ? nums[1].textContent.trim() : '0');
    }

    if (hasSubl) {
      buf.u8(sublabels.length);
      sublabels.forEach(s => {
        const pi = SUBL_PRESETS.indexOf(s);
        if (pi >= 0) { buf.u8(0x80 | pi); } // preset index
        else         { buf.str(s); }          // raw string
      });
    }
  });
  return buf.bytes();
}

function unpackLayout(bytes) {
  const r = makeReader(bytes);
  const dots = [];
  const count = r.u8();
  for (let i = 0; i < count; i++) {
    const x = r.u16(), y = r.u16(), lx = r.u16(), ly = r.u16();
    const flags     = r.u8();
    const hasAlt    = flags & 1;
    const textMoved = (flags >> 1) & 1;
    const hasSubl   = (flags >> 2) & 1;
    const tx = textMoved ? r.i16() : 16;
    const ty = textMoved ? r.i16() : -8;
    const name = unpackName(r);
    let a = null;
    if (hasAlt) {
      const symByte  = r.u8();
      const symIdx   = symByte & 0x7;
      const rightVis = (symByte >> 3) & 1;
      const leftStr  = unpackAltNum(r);
      const rightStr = unpackAltNum(r);
      a = { l: leftStr, s: SYM_CHARS[symIdx] || 'C', r: rightStr, v: rightVis };
    }
    const sl = [];
    if (hasSubl) {
      const n = r.u8();
      for (let j = 0; j < n; j++) {
        const b = r.peekU8();
        if (b & 0x80) { r.u8(); sl.push(SUBL_PRESETS[b & 0x7F] || ''); }
        else           { sl.push(r.str()); }
      }
    }
    dots.push({ x, y, lx, ly, tx, ty, n: name, a, sl });
  }
  return dots;
}

async function compress(str) {
  const bytes = new TextEncoder().encode(str);
  const compressed = await compressBytes(bytes);
  return btoa(String.fromCharCode(...compressed));
}

async function decompress(b64) {
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const decompressed = await decompressBytes(bytes);
  return new TextDecoder().decode(decompressed);
}

function serializeLayout() {
  const dots = [];
  document.querySelectorAll('.custom-dot').forEach(group => {
    const dotId = group.dataset.dotId;
    const x = Math.round(parseFloat(group.style.left));
    const y = Math.round(parseFloat(group.style.top));
    const lineEl = document.querySelector(`.custom-line[data-dot-id="${dotId}"]`);
    const lx = lineEl ? Math.round(parseFloat(lineEl.getAttribute('x2'))) : x + 100;
    const ly = lineEl ? Math.round(parseFloat(lineEl.getAttribute('y2'))) : y;
    const block = group.querySelector('.dot-text-block');
    const transform = block ? block.style.transform : 'translate(16px, -8px)';
    const match = transform.match(/translate\(([^,]+)px,\s*([^)]+)px\)/);
    const tx = match ? Math.round(parseFloat(match[1])) : 16;
    const ty = match ? Math.round(parseFloat(match[2])) : -8;
    const nameEl = group.querySelector('.dot-label');
    const n = nameEl ? nameEl.textContent.trim() : '';
    const altWidget = group.querySelector('.alt-widget');
    let a = null;
    if (altWidget) {
      const nums = altWidget.querySelectorAll('.alt-num');
      const symEl = altWidget.querySelector('.alt-sym');
      const symText = symEl ? [...symEl.childNodes].find(nd => nd.nodeType === 3) : null;
      a = { l: nums[0] ? nums[0].textContent.trim() : '', s: symText ? symText.nodeValue : 'C',
            r: nums[1] ? nums[1].textContent.trim() : '', v: nums[1] ? (nums[1].style.display !== 'none' ? 1 : 0) : 0 };
    }
    const sl = [];
    group.querySelectorAll('.dot-sublabel,.dot-sublabel2,.dot-sublabel3').forEach(el => {
      if (!el.querySelector('.alt-widget')) { const t = el.textContent.trim(); if (t) sl.push(t); }
    });
    const entry = { x, y, lx, ly, n };
    if (tx !== 16 || ty !== -8) { entry.tx = tx; entry.ty = ty; }
    if (a) entry.a = a;
    if (sl.length) entry.sl = sl;
    dots.push(entry);
  });
  return JSON.stringify(dots);
}

async function shareLayout() {
  // Use binary packing + deflate + base64
  const packed = packLayout();
  const compressed = await compressBytes(packed);
  // Prefix with 'b' to distinguish from JSON-based format
  const code = 'b' + btoa(String.fromCharCode(...compressed));
  const out = document.getElementById('share-output');
  const input = document.getElementById('share-code');
  out.style.display = 'flex';
  input.value = code;
  input.select();
  document.getElementById('load-input-row').style.display = 'none';
}

async function loadLayout() {
  const raw = document.getElementById('load-code').value.trim();
  const err = document.getElementById('load-error');
  if (err) err.remove();

  let dots;
  try {
    if (raw.startsWith('b')) {
      // New binary format
      const bytes = Uint8Array.from(atob(raw.slice(1)), c => c.charCodeAt(0));
      const decompressed = await decompressBytes(bytes);
      dots = unpackLayout(decompressed);
    } else {
      // Legacy JSON+deflate format
      const json = await decompress(raw);
      dots = JSON.parse(json);
    }
    if (!Array.isArray(dots)) throw new Error();
  } catch {
    try {
      dots = JSON.parse(decodeURIComponent(escape(atob(raw))));
      if (!Array.isArray(dots)) throw new Error();
    } catch {
      const errEl = document.createElement('div');
      errEl.id = 'load-error';
      errEl.textContent = 'Invalid code.';
      document.getElementById('load-input-row').insertAdjacentElement('afterend', errEl);
      return;
    }
  }

  clearAll();
  const canvas = document.getElementById('canvas');

  dots.forEach(d => {
    const dotId = 'dot-' + Date.now() + '-' + Math.floor(Math.random() * 100000);
    const x  = d.x, y = d.y;
    const lx = d.lx ?? d.lx2 ?? x + 100;
    const ly = d.ly ?? d.ly2 ?? y;
    const tx = d.tx ?? 16;
    const ty = d.ty ?? -8;
    const name     = d.n ?? d.name ?? '';
    const altData  = d.a ?? (d.altData ? {
      l: d.altData.left, s: d.altData.sym, r: d.altData.right, v: d.altData.rightVisible ? 1 : 0
    } : null);
    const sublabels = d.sl ?? (d.sublabels ? d.sublabels.map(s => s.text ?? s) : []);

    addCustomLine(x, y, lx, ly, dotId);

    const group = document.createElement('div');
    group.className = 'dot-group custom-dot';
    group.style.left = x + 'px';
    group.style.top  = y + 'px';
    group.dataset.dotId = dotId;

    const dot = document.createElement('div');
    dot.className = 'dot';
    dot.style.cursor = 'grab';
    group.appendChild(dot);
    setupDotDrag(dot, group, dotId);

    const textBlock = makeDraggableTextBlock(tx, ty);

    const nameEl = document.createElement('span');
    nameEl.className = 'dot-label';
    nameEl.textContent = name;
    makeEditableSpan(nameEl);
    textBlock.appendChild(nameEl);

    if (altData) {
      const altEl = document.createElement('span');
      altEl.className = 'dot-sublabel';
      const widget = makeAltitudeWidget(altData.l + altData.s);
      const nums   = widget.querySelectorAll('.alt-num');
      const symEl  = widget.querySelector('.alt-sym');
      const symNode = symEl ? [...symEl.childNodes].find(nd => nd.nodeType === 3) : null;
      if (nums[1]) { nums[1].textContent = altData.r; nums[1].style.display = altData.v ? 'inline' : 'none'; }
      if (symNode) symNode.nodeValue = altData.s;
      altEl.appendChild(widget);
      textBlock.appendChild(altEl);
    }

    sublabels.forEach((t, i) => {
      const el = document.createElement('span');
      el.className = i === 0 && !altData ? 'dot-sublabel' : i === 0 ? 'dot-sublabel2' : 'dot-sublabel' + (i + 1);
      el.textContent = t;
      makeEditableSpan(el);
      textBlock.appendChild(el);
    });

    group.appendChild(textBlock);
    canvas.appendChild(group);
  });
  document.getElementById('load-input-row').style.display = 'none';
  document.getElementById('load-code').value = '';
}

function copyCode() {
  const input = document.getElementById('share-code');
  input.select();
  navigator.clipboard.writeText(input.value).catch(() => {
    document.execCommand('copy');
  });
  const btn = document.getElementById('copy-btn');
  btn.textContent = 'Copied!';
  setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
}

function toggleLoadInput() {
  const row = document.getElementById('load-input-row');
  const isOpen = row.style.display === 'flex';
  row.style.display = isOpen ? 'none' : 'flex';
  document.getElementById('share-output').style.display = 'none';
  const err = document.getElementById('load-error');
  if (err) err.remove();
}

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
let touchWasDrag = false;
let touchStartX = 0;
let touchStartY = 0;
const DRAG_THRESHOLD = 8; // px — movement less than this is a tap

document.getElementById('canvas').addEventListener('touchstart', (e) => {
  touchWasDrag = false;
  touchStartX = e.touches[0].clientX;
  touchStartY = e.touches[0].clientY;
}, { passive: true });

document.getElementById('canvas').addEventListener('touchmove', (e) => {
  const dx = Math.abs(e.touches[0].clientX - touchStartX);
  const dy = Math.abs(e.touches[0].clientY - touchStartY);
  if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) touchWasDrag = true;
}, { passive: true });

document.getElementById('canvas').addEventListener('touchend', (e) => {
  if (!customModeActive) return;
  if (!placingEnabled) return;
  if (touchWasDrag) return;
  e.preventDefault();

  const t = e.changedTouches[0];
  // Check what element is at the touch point
  const el = document.elementFromPoint(t.clientX, t.clientY);
  if (!el) return;

  const blocked = (el.closest('.dot-group') && !el.closest('.ghost-dot')) ||
                  el.closest('.alt-widget') ||
                  el.closest('.alt-sym-dropdown') ||
                  el.closest('.alt-sym-option') ||
                  el.closest('.dot-text-block') ||
                  el.closest('.text-drag-handle') ||
                  el.closest('.dot-delete-btn') ||
                  el.closest('.dot-label') ||
                  el.closest('.dot-sublabel') ||
                  el.closest('.dot-sublabel2') ||
                  el.closest('.dot-sublabel3');

  if (blocked) {
    // If tapping a text element, trigger its click for editing
    if (el.closest('.dot-label') || el.closest('.dot-sublabel') ||
        el.closest('.dot-sublabel2') || el.closest('.dot-sublabel3')) {
      el.click();
    }
    return;
  }

  // Safe to place a dot
  onCustomClick({ clientX: t.clientX, clientY: t.clientY,
                  target: el, stopPropagation: () => {}, preventDefault: () => {} });
}, { passive: false });

init().then(() => {
  // Start in custom mode by default
  toggleCustomMode();
});

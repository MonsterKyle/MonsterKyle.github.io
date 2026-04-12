const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function randomName() {
  const length = Math.floor(Math.random() * 4) + 4; // 4–7 chars including leading N
  let name = 'N';
  for (let i = 1; i < length; i++) {
    name += CHARS[Math.floor(Math.random() * CHARS.length)];
  }
  return name;
}

function randomPosition() {
  // Keep dot 5% away from edges so it's never clipped
  const margin = 5;
  const x = margin + Math.random() * (100 - margin * 2);
  const y = margin + Math.random() * (100 - margin * 2);
  return { x, y };
}

function generate() {
  const canvas = document.getElementById('canvas');

  // Remove existing dot group if present
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

// Generate one on load
generate();

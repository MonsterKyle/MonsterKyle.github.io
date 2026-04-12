# Yellow Dot Generator

A simple web app that generates a random yellow dot with a random name on a custom background. Each name starts with **N**, is 4–7 characters long, and contains random letters and numbers.

## Project Structure

```
yellow-dot-generator/
├── index.html
├── style.css
├── script.js
├── background.jpg   ← add your own image here
└── README.md
```

## Setup

### 1. Add your background image

Place your background image in the project root and name it **`background.jpg`**.

If you want to use a different filename or format (e.g. `background.png`), update this line in `style.css`:

```css
background-image: url('background.jpg');
```

### 2. Run locally

Just open `index.html` in a browser — no build step needed.

### 3. Deploy to GitHub Pages

1. Push this folder to a GitHub repository.
2. Go to **Settings → Pages**.
3. Under **Source**, select the `main` branch and `/ (root)` folder.
4. Click **Save** — your site will be live at `https://<your-username>.github.io/<repo-name>/`.

## How it works

- On load, one yellow dot + name is generated in a random position.
- Clicking **Generate** removes the old dot and places a new one in a new random spot.
- Names always start with `N`, followed by 3–6 random uppercase letters/digits (total length 4–7).

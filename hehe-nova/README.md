# Dance Catch-up

This is the starter scaffold for Dance Catch-up. It is a Vite, React, and TypeScript app with the MediaPipe Pose Landmarker assets bundled locally. App structure, design, and the backend approach are still being decided.

## Requirements

- Node **22.12 or newer** (the repo has an `.nvmrc`, so `nvm use` picks it up).
- Run `npm ci` and every npm command from the same environment. Vite ships native binaries per OS, so a `node_modules` installed in WSL will not run from Windows PowerShell and the other way around.

## Setup

```bash
nvm use
npm ci
cp .env.example .env.local
```

Then paste the team's OpenRouter key into `.env.local`:

```
OPENROUTER_API_KEY=sk-or-...
```

`.env.local` is gitignored. Never commit the key, never put it in a `VITE_` variable, and never put it in source files. Only server side code should read it. OpenRouter automatically disables keys that show up in a repo.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server on http://localhost:5173 |
| `npm run build` | Typecheck and production build into `dist/` |
| `npm run preview` | Serve `dist/` on http://localhost:4173 |
| `npm run typecheck` | `tsc -b` only |
| `npm run lint` | oxlint |
| `npm run copyWasm` | Refresh the MediaPipe WASM files in `public/mediapipe/wasm` |

## MediaPipe assets

These are served locally so the app does not depend on a CDN at demo time.

- Model: `public/models/pose_landmarker_lite.task`, served at `/models/pose_landmarker_lite.task`.
- WASM: `public/mediapipe/wasm/`, served at `/mediapipe/wasm`. The `.js` and `.wasm` files sit directly in that folder.

`@mediapipe/tasks-vision` is pinned to an exact version. If you ever change that version, run `npm run copyWasm` so the WASM files match the JavaScript package.

## Project layout

| Path | Purpose |
| --- | --- |
| `src/main.tsx` | Entry point |
| `src/App.tsx` | Placeholder root component |
| `src/index.css` | Global reset and shared styles |
| `public/models/` | Pose model file |
| `public/mediapipe/wasm/` | MediaPipe WASM runtime |
| `.env.example` | Template for `.env.local` |

## Code style

- Use camelCase for variables, functions, and file-local names, and PascalCase file names for components.
- Write comments as plain sentences, without dashes, banners, or decorative styles.

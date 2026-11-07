# Dance Catch-up

This is the functional foundation for Dance Catch-up, a role-aware rehearsal coach. It supports phrase and role selection, reference-video review, formation paths, webcam or prerecorded learner input, MediaPipe whole-body tracking, calibrated landing evaluation, posture comparison, prioritized feedback, retry, and the same-attempt/two-role judging reveal.

The repository currently uses labeled placeholder choreography metadata. Real reference and learner videos can be selected from the interface while the final asset package and annotations are being prepared.

## Requirements

- Node **22.12 or newer**. Check with `node -v`. The repo has an `.nvmrc` for anyone using nvm.
- Run `npm ci` and every npm command from the same environment. Vite ships native binaries per OS, so a `node_modules` installed in WSL will not run from Windows PowerShell and the other way around. If you switch, delete `node_modules` and run `npm ci` again.

## Setup

Windows PowerShell:

```powershell
npm ci
Copy-Item .env.example .env.local
```

macOS, Linux, or WSL:

```bash
npm ci
cp .env.example .env.local
```

An OpenRouter key is optional and is not used by the current deterministic evaluator. If a server-side correction-rephrasing endpoint is added later, place the team's key in `.env.local`:

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
| `npm test` | Run deterministic geometry and evaluation tests |
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
| `src/App.tsx` | Minimal end-to-end learning and practice interface |
| `src/demoData.ts` | Replaceable placeholder rehearsal and attempt manifests |
| `src/domain.ts` | Shared rehearsal, pose, calibration, and result types |
| `src/geometry.ts` | Floor calibration, homography, and formation scaling |
| `src/evaluation.ts` | Landing, formation, posture, and correction evaluation |
| `src/usePoseInput.ts` | Shared MediaPipe input for webcam and learner videos |
| `src/index.css` | Global reset and shared styles |
| `public/models/` | Pose model file |
| `public/mediapipe/wasm/` | MediaPipe WASM runtime |
| `.env.example` | Template for `.env.local` |

## Code style

- Use camelCase for variables, functions, and file-local names, and PascalCase file names for components.
- Write comments as plain sentences, without dashes, banners, or decorative styles.

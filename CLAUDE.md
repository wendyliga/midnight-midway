# Repository Guidelines

## Project Structure & Module Organization

Midnight Midway is a Vite single-page browser game. Core gameplay, Three.js rendering, Rapier physics, UI state, and persistence live in `src/main.js`. Synthesized sound and music controls live in `src/audio.js`. The document shell, HUD, menus, modals, CSS, favicon links, and Open Graph metadata live in `index.html`.

Static source media is in `assets/`. Generated favicon, app icon, manifest, and social-preview files are in `public/`; regenerate them with `scripts/gen-icons.mjs` instead of editing generated images by hand. Production output is written to `dist/` and should be treated as generated build output.

## Build, Test, and Development Commands

```bash
npm install       # install dependencies
npm run dev       # start Vite at http://localhost:5173
npm run build     # build the single-file site into dist/
npm run preview   # serve the production build locally
./build.sh        # install deps if needed, regenerate icons/preview, stamp build info, build dist/
```

Use `./build.sh` before shipping because it refreshes generated public assets and commit-linked build metadata.

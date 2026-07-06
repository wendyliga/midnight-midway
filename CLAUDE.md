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

## Coding Style & Naming Conventions

Use modern ES modules, two-space indentation, semicolons, and the existing plain JavaScript style. Keep changes surgical and local to the requested behavior. Prefer descriptive constants in `UPPER_SNAKE_CASE` for tuning values and camelCase for functions and mutable state. Keep CSS selectors consistent with the current ID/class patterns in `index.html`.

## Testing Guidelines

There is no automated test suite or lint script configured. Verify changes with `npm run build`. For UI changes, also run `npm run dev`, inspect the app in a browser, and confirm the specific interaction or layout you changed. For icon/social-preview work, run `./build.sh` and confirm the expected files exist in `dist/`.

## Commit & Pull Request Guidelines

Recent history uses short imperative commit subjects, for example `Update README` and `Add GitHub control button`. Keep commit messages concise and focused on one change.

Pull requests should include a brief summary, the commands run, and screenshots or browser notes for visual changes. Mention any generated assets touched by `build.sh` and avoid committing unrelated local output.

## Configuration & Deployment Notes

The deployed origin is baked into social metadata in `index.html`, and build links are derived in `vite.config.js`/`build.sh`. Do not add secrets; all persistence is local browser storage.

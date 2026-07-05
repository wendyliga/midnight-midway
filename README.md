# Midnight Midway — after-hours penny falls

A coin dozer / penny pusher simulator that runs entirely in the browser,
offline, from a single HTML file. The concept: a carnival penny-falls cabinet
still running after the midway has closed — one hot tungsten spotlight, a
string of half-dying marquee bulbs, and the endless mechanical breath of the
pusher.

## Play

Open `dist/index.html` in any modern browser — double-clicking the file works;
no server, no internet connection needed.

- **Slide** the pointer to aim the dropper carriage, **click / tap** (or
  Space, with arrow keys to aim) to drop a coin onto the pusher shelf.
- Coins shoved off the front edge fall into the full-width payout tray and
  come back to your purse. But narrow channels run along each side of the
  felt (marked with a brass lip and a red glow) — coins that drift off the
  sides are kept by the house, just like the real machine.
- A brass **Lucky Ring** glides across the drop path. Thread your coin
  through it and the coin comes out gilded — glowing, and paying **×3** when
  it lands in the tray. The ring is physically simulated: clip its rim and
  your coin ricochets.
- Every 12th drop is a **Lucky Token** (+5), every 60th a **Jackpot Medal**
  (+25 and a coin shower onto the field).
- Four or more coins falling within a couple of seconds pays a **cascade
  bonus**.
- Every 25 coins won earns a **volley charge** (bank up to 2): press V or tap
  the bottom-right button to drop 5 coins in a horizontal row at once.
- The **?** button opens an illustrated field guide explaining every coin,
  the ring, the gutters, and the volley.
- Broke? The tip jar takes pity every 45 seconds.
- Balance, winnings, volley charges, and mute state persist between sessions.

## Simulation

This is a real rigid-body simulation, not an animation:

- [Rapier](https://rapier.rs) (Rust → WASM) simulates every coin as a cylinder
  at 120 Hz with continuous collision detection, real-world scale (1 unit =
  1 cm, gravity 981 cm/s²) and realistic friction/restitution.
- The machine works the way a genuine penny falls does: dropped coins land on
  the oscillating shelf, the fixed scraper wall walks them forward on each
  retract stroke, they spill onto the field, and the shelf's front face
  pushes the bed toward the edge.
- All audio (coin clinks pitched by impact force, payout chimes, jackpot
  fanfare, room-tone ambience, and a slow music-box waltz for background
  music) is synthesized live with the Web Audio API — no sound files.
- Rendering is Three.js: one shadow-casting spotlight, emissive bulbs, ACES
  tone mapping.
- The main menu is a night alleyway photograph (Aaron Chavez, Unsplash),
  embedded in the file and dressed with a slow push-in, drifting haze, a
  flickering lamp, and film grain.
- Neighbouring arcade machines flank the cabinet at the edge of vision —
  painted on canvas, pre-blurred for depth of field, their screens
  shimmering and tinting the dark.

## Development

```
npm install
npm run dev       # Vite dev server with HMR on http://localhost:5173
npm run build     # single-file dist/index.html via vite-plugin-singlefile
npm run preview   # serve the built file
```

In Claude Code, `.claude/launch.json` starts the Vite dev server for the
preview panel, so changes hot-reload while debugging.

`src/main.js` — scene, physics, gameplay. `src/audio.js` — synthesized
sound. `index.html` — shell, HUD, styling. The build inlines everything
(script, physics WASM, the alleyway photo) into one self-contained file.

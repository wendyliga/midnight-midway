# Midnight Midway

An after-hours coin dozer / penny falls simulator that runs entirely in your browser. Drop coins into a physically simulated arcade cabinet, thread the lucky ring, build volley charges, and push winnings over the edge — no account, no server processing, and a single-file offline build.

## Features

- **Real physics** — Rapier simulates every coin as a cylinder at 120 Hz with real-world scale, friction, restitution, and continuous collision detection
- **Authentic pusher action** — coins land on an oscillating shelf, hit the fixed scraper, walk forward, pile up, and spill into the payout tray
- **House rules** — the menu lets you toggle side gutters, deflector pins, the lucky ring, and volley skill; fresh games default to Lucky Ring + Volley Skill
- **Arcade payouts** — lucky tokens appear every 15th drop, jackpot medals every 75th drop, cascade bonuses reward bursts, and the lucky ring pays triple
- **Volley skill** — every 30 coins won earns a volley charge; bank up to 2 and fire 5 coins across the drop lane
- **Fully local** — balance, winnings, volley charges, mute state, and house rules persist in local storage only
- **Single-file game build** — Vite and `vite-plugin-singlefile` inline the JavaScript, physics WASM, and alley artwork into `dist/index.html`
- **Share-ready metadata** — generated favicons, app icons, Safari pinned-tab icon, manifest icons, and a 1200x630 Open Graph preview ship beside the built HTML

## Development

```bash
npm install
npm run dev      # start Vite at http://localhost:5173
npm run preview  # serve the production build locally
```

The main files are:

- `src/main.js` — scene, physics, gameplay, UI state, and persistence
- `src/audio.js` — synthesized coin sounds, chimes, ambience, and music
- `index.html` — document shell, HUD, menu, credits modal, styling, favicons, and social metadata
- `scripts/gen-icons.mjs` — generated favicon/app-icon/social-preview assets

## Build

```bash
npm run build  # Vite build only
./build.sh     # install deps if needed, regenerate icons/preview, stamp build info, build dist/
```

`build.sh` regenerates the favicon set and Open Graph preview, stamps the visible build hash with the current Git commit, and writes the static output to `dist/`.

## Deployment

Deploy the contents of `dist/` to any static host.

```bash
./build.sh
# upload or serve dist/
```

The build uses a relative Vite base (`./`), so the game works from a domain root, a project subpath, or a local file. Favicons and social-preview assets are copied next to `dist/index.html`; URL preview crawlers such as WhatsApp, iMessage, Slack, Discord, and X should use the absolute Open Graph/Twitter image URL for the hosted site.

## License

No license file is currently included.

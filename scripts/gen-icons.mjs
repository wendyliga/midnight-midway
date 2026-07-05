// Generate favicons + Open Graph preview into public/.
// Runs from build.sh before `vite build`; idempotent.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

const outDir = path.resolve('public');
fs.mkdirSync(outDir, { recursive: true });

// The coin favicon — a small gilded roundel with a five-point star.
// Designed to still read at 16×16, so the star is chunky and the rim is high
// contrast.
const coinSvg = (size, big = false) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${size}" height="${size}">
  <defs>
    <radialGradient id="face" cx="35%" cy="30%" r="80%">
      <stop offset="0%" stop-color="#ffe6a3"/>
      <stop offset="55%" stop-color="#e0b055"/>
      <stop offset="100%" stop-color="#8a5f1a"/>
    </radialGradient>
    <radialGradient id="hi" cx="35%" cy="28%" r="35%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.6"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <circle cx="50" cy="50" r="46" fill="url(#face)" stroke="#5a3d10" stroke-width="4"/>
  <circle cx="50" cy="50" r="40" fill="none" stroke="#a37628" stroke-width="1.5" opacity="0.7"/>
  <path d="M50 24 L57 43 L77 43 L61 55 L67 74 L50 62 L33 74 L39 55 L23 43 L43 43 Z"
        fill="#7a4f14" opacity="${big ? 0.85 : 0.9}"/>
  <circle cx="50" cy="50" r="46" fill="url(#hi)"/>
</svg>
`.trim();

async function png(size, file, big = false) {
  await sharp(Buffer.from(coinSvg(size, big)))
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(path.join(outDir, file));
  console.log(`  ${file}  ${size}×${size}`);
}

console.log('coin icons:');
await png(16, 'favicon-16.png');
await png(32, 'favicon-32.png');
await png(48, 'favicon-48.png');
await png(180, 'apple-touch-icon.png', true);
await png(192, 'icon-192.png', true);
await png(512, 'icon-512.png', true);

// Multi-resolution .ico for legacy Windows / older browsers.
const icoBuf = await pngToIco([16, 32, 48].map(s => path.join(outDir, `favicon-${s}.png`)));
fs.writeFileSync(path.join(outDir, 'favicon.ico'), icoBuf);
console.log('  favicon.ico  16/32/48');

// SVG favicon — modern browsers (Chrome/Firefox/Edge) prefer this.
fs.writeFileSync(path.join(outDir, 'favicon.svg'), coinSvg(64, true) + '\n');
console.log('  favicon.svg');

// 1200×630 OG preview. A hand-composed frame: alley photo darkened as
// backdrop, a wall of coins along the bottom, and the title over a spotlight.
console.log('open-graph preview:');
const alleyBuf = fs.readFileSync('assets/alley.jpg');
const alleyOG = await sharp(alleyBuf)
  .resize(1200, 630, { fit: 'cover', position: 'centre' })
  .modulate({ brightness: 0.42, saturation: 0.85 })
  .composite([{
    input: Buffer.from(`
      <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
        <defs>
          <radialGradient id="spot" cx="50%" cy="42%" r="42%">
            <stop offset="0%" stop-color="#ffe4b3" stop-opacity="0.4"/>
            <stop offset="45%" stop-color="#ffb570" stop-opacity="0.13"/>
            <stop offset="100%" stop-color="#000" stop-opacity="0"/>
          </radialGradient>
          <linearGradient id="dim" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#000" stop-opacity="0.55"/>
            <stop offset="55%" stop-color="#000" stop-opacity="0.2"/>
            <stop offset="100%" stop-color="#000" stop-opacity="0.7"/>
          </linearGradient>
        </defs>
        <rect width="1200" height="630" fill="url(#dim)"/>
        <rect width="1200" height="630" fill="url(#spot)"/>
      </svg>`),
    top: 0, left: 0,
  }])
  .png()
  .toBuffer();

// Title + tagline + rule + coin ornament.
const titleSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
  <defs>
    <radialGradient id="c" cx="35%" cy="30%" r="80%">
      <stop offset="0%" stop-color="#ffe6a3"/>
      <stop offset="60%" stop-color="#d9a441"/>
      <stop offset="100%" stop-color="#7a5a1e"/>
    </radialGradient>
    <filter id="glow" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="8" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <g transform="translate(600 250)" text-anchor="middle" font-family="Palatino, 'Palatino Linotype', Georgia, serif" fill="#e8c476" filter="url(#glow)">
    <text font-size="86" letter-spacing="24" font-weight="500">MIDNIGHT MIDWAY</text>
  </g>
  <g transform="translate(600 320)" text-anchor="middle" font-family="Palatino, Georgia, serif" fill="#9b8a6a">
    <text font-size="26" letter-spacing="14">AFTER-HOURS PENNY FALLS</text>
  </g>
  <line x1="480" y1="360" x2="720" y2="360" stroke="#9b8a6a" stroke-width="1" opacity="0.65"/>
  <g transform="translate(600 440)">
    <circle r="42" fill="url(#c)" stroke="#5a3d10" stroke-width="3"/>
    <circle r="34" fill="none" stroke="#a37628" stroke-width="1" opacity="0.65"/>
    <path d="M0 -22 L6.5 -6.8 L23 -6.8 L9.5 3 L15 19 L0 9 L-15 19 L-9.5 3 L-23 -6.8 L-6.5 -6.8 Z"
          fill="#7a4f14"/>
  </g>
</svg>`;

await sharp(alleyOG)
  .composite([{ input: Buffer.from(titleSvg), top: 0, left: 0 }])
  .jpeg({ quality: 88 })
  .toFile(path.join(outDir, 'preview.jpg'));
console.log('  preview.jpg  1200×630');

console.log('\ndone.');

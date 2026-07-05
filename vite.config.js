import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// The deliverable: one self-contained index.html that runs offline, plus a
// handful of side files (favicons, manifest, OG preview) copied from public/
// so browsers and social-preview crawlers can fetch them by URL when hosted.
export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  build: {
    target: 'es2020',
    // Inline every asset the bundler sees (JS, CSS, the alleyway photo)
    // into index.html. public/ is copied verbatim and not touched.
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 100_000_000,
  },
});

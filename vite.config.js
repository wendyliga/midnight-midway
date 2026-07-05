import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { execSync } from 'child_process';

const FALLBACK_REPO_URL = 'https://github.com/wendyliga/midnight-midway';

function githubRepoUrl() {
  if (process.env.GITHUB_REPOSITORY) {
    return `https://github.com/${process.env.GITHUB_REPOSITORY}`;
  }

  try {
    const remoteUrl = execSync('git remote get-url origin').toString().trim();
    if (remoteUrl.startsWith('git@github.com:')) {
      return `https://github.com/${remoteUrl.replace(/^git@github\.com:/, '').replace(/\.git$/, '')}`;
    }
    if (remoteUrl.startsWith('https://github.com/')) {
      return remoteUrl.replace(/\.git$/, '');
    }
  } catch {
    // Fall back below.
  }

  return FALLBACK_REPO_URL;
}

// Auto-populate build info so both `npm run dev` and `./build.sh` show a real hash.
if (!process.env.VITE_BUILD_HASH) {
  try {
    process.env.VITE_BUILD_HASH = execSync('git rev-parse --short=8 HEAD').toString().trim();
  } catch {
    process.env.VITE_BUILD_HASH = 'dev';
  }
}
if (!process.env.VITE_BUILD_COMMIT) {
  try {
    process.env.VITE_BUILD_COMMIT = execSync('git rev-parse HEAD').toString().trim();
  } catch {
    process.env.VITE_BUILD_COMMIT = '';
  }
}
if (!process.env.VITE_GITHUB_REPO_URL) {
  process.env.VITE_GITHUB_REPO_URL = githubRepoUrl();
}
if (!process.env.VITE_BUILD_HREF) {
  process.env.VITE_BUILD_HREF = process.env.VITE_BUILD_COMMIT
    ? `${process.env.VITE_GITHUB_REPO_URL}/commit/${process.env.VITE_BUILD_COMMIT}`
    : process.env.VITE_GITHUB_REPO_URL;
}

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

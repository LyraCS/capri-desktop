import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `base: './'` keeps every asset URL relative, so the same build works from disk
// (site/dist/index.html opened directly) and from a GitHub Pages project path
// (/capri-desktop/) without a rebuild.
export default defineConfig({
  base: './',
  plugins: [react()],
});

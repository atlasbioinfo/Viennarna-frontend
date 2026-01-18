import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages 部署: https://<username>.github.io/Viennarna-frontend/
  base: '/Viennarna-frontend/',
  plugins: [vue()],
  optimizeDeps: {
    exclude: ['rnafold.js']
  },
  build: {
    target: 'esnext'
  },
  assetsInclude: ['**/*.wasm']
})

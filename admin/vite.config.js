import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { sri } from 'vite-plugin-sri3'

export default defineConfig({
  // V-046: add Subresource Integrity (sha384) to every <script> and
  // stylesheet tag in the built index.html so a compromised CDN or
  // static host cannot swap the bundle without the browser noticing.
  // Only runs on build; dev server is unaffected.
  plugins: [react(), sri()],
  build: {
    rolldownOptions: {
      output: {
        // One 1.5 MB bundle meant every deploy re-downloaded antd and
        // React along with the app. Vendor code changes far less often,
        // so it gets its own long-cacheable chunks; sri() hashes each.
        codeSplitting: {
          groups: [
            {
              name: 'react-vendor',
              // Not the copies nested under @react-three (fiber ships its
              // own scheduler): those belong to the lazy 'three' chunk.
              test: /^(?!.*node_modules[\/]@react-three[\/]).*node_modules[\/](react|react-dom|react-router|react-router-dom|scheduler)[\/]/,
              priority: 20,
            },
            {
              name: 'antd',
              test: /node_modules[\/](antd|@ant-design|@rc-component|rc-[\w-]+)[\/]/,
              priority: 10,
            },
            {
              // Charts only load with the dashboard; keep d3 and recharts
              // out of the entry bundle and cacheable on their own.
              name: 'charts',
              test: /node_modules[\/](recharts|d3-[\w-]+|victory-vendor|internmap|decimal\.js-light)[\/]/,
              priority: 10,
            },
            {
              // three.js + react-three-fiber/drei: only the lazily loaded
              // 3D warehouse page (/warehouse-3d) imports them, so this
              // chunk is fetched on that route and never by the entry.
              name: 'three',
              test: /node_modules[\/](three|three-[\w-]+|@react-three|@use-gesture|@monogrid|@mediapipe|react-reconciler|its-fine|suspend-react|zustand|react-use-measure|camera-controls|maath|meshline|troika-[\w-]+|bidi-js|webgl-sdf-generator|stats-gl|stats\.js|detect-gpu|hls\.js|tunnel-rat|glsl-noise)[\/]/,
              priority: 10,
            },
          ],
        },
      },
    },
  },
  server: {
    port: 4000,
    proxy: {
      '/api': process.env.VITE_API_PROXY || 'http://127.0.0.1:5000',
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.js',
    // Rendering a page now pulls in Ant Design, and vitest runs test files
    // in parallel workers on a machine that is also compiling them. A test
    // that takes under a second on its own can cross the 5s default purely
    // through CPU contention, which showed up as two tests failing at
    // random. The assertions are unchanged; only the patience is.
    testTimeout: 20000,
  }
})

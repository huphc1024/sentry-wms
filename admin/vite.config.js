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
              test: /node_modules[\/](react|react-dom|react-router|react-router-dom|scheduler)[\/]/,
              priority: 20,
            },
            {
              name: 'antd',
              test: /node_modules[\/](antd|@ant-design|@rc-component|rc-[\w-]+)[\/]/,
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

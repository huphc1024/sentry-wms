import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { sri } from 'vite-plugin-sri3'

export default defineConfig({
  // Same V-046 rationale as admin/vite.config.js: sha384 Subresource
  // Integrity on every built <script>/<link> so a compromised static
  // host cannot swap the bundle unnoticed. Build-only; dev is untouched.
  plugins: [react(), sri()],
  server: {
    // 4100, not admin's 4000: both dev servers must be runnable at once
    // (an operator comparing what a customer sees against the admin view).
    port: 4100,
    proxy: {
      '/api': process.env.VITE_API_PROXY || 'http://127.0.0.1:5000',
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.js',
  }
})

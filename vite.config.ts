import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  root: 'src/renderer',
  build: {
    outDir: path.resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        entryFileNames: '[name].js'
      }
    }
  },
  server: {
    port: 5173,
    strictPort: true
  },
  test: {
    environment: 'node',
    include: ['**/*.test.{ts,tsx}']
  }
})

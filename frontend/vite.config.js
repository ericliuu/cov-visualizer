import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/load-cfg-dir": "http://localhost:5000",
      "/load-coverage-path": "http://localhost:5000",
      "/functions": "http://localhost:5000",
      "/function": "http://localhost:5000",
    }
  }
})

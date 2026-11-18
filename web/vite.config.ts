import path from "node:path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// `npm run dev` proxies the same two paths nginx does in the container, so
// the app talks to one origin everywhere: /api -> gateway, /jaeger-api -> Jaeger.
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
      "/jaeger-api": {
        target: "http://localhost:16686",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/jaeger-api/, "/api"),
      },
    },
  },
})

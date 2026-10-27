import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Only VITE_E2E is ever read in the client, and it is not a secret.
  // envDir stays at web/ (the default), so the repo-root .env is never parsed by the client build.
  envPrefix: "VITE_",
  server: { port: 5173, proxy: { "/api": "http://localhost:8787" } },
  build: { outDir: "dist", sourcemap: true },
});

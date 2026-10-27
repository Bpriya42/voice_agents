import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => {
  // `vite --mode e2e` turns on the fake voice adapter (?fake=1). VITE_E2E is not a secret; it is set
  // here rather than in a web/.env.e2e file so no dotenv file is ever needed for the client.
  if (mode === "e2e") process.env["VITE_E2E"] = "1";
  return {
    plugins: [react(), tailwindcss()],
    // Only VITE_E2E is ever read in the client, and it is not a secret.
    // envDir stays at web/ (the default), so the repo-root .env is never parsed by the client build.
    envPrefix: "VITE_",
    // WEB_PORT/PORT let e2e run on its own ports, so it never reuses a plain dev server.
    server: {
      port: Number(process.env["WEB_PORT"] ?? 5173),
      strictPort: true,
      proxy: { "/api": `http://localhost:${process.env["PORT"] ?? 8787}` },
    },
    build: { outDir: "dist", sourcemap: true },
  };
});

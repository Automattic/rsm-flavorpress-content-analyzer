import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const emptyNodeFs = new URL("../../scripts/browser-empty-fs.js", import.meta.url).pathname;

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  resolve: {
    alias: {
      fs: emptyNodeFs,
    },
  },
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});

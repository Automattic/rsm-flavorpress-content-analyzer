import { defineConfig } from "vite";

const emptyNodeFs = new URL("../../scripts/browser-empty-fs.js", import.meta.url).pathname;

export default defineConfig({
  resolve: {
    alias: {
      fs: emptyNodeFs,
    },
  },
  build: {
    emptyOutDir: false,
    minify: false,
    lib: {
      entry: "src/block.ts",
      name: "FlavorPressContentAnalyzerBlock",
      formats: ["iife"],
      fileName: () => "block.js",
    },
    outDir: "assets",
    rollupOptions: {
      output: {
        extend: true,
      },
    },
  },
});

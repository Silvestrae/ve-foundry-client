// noinspection JSUnusedGlobalSymbols

import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import path from "path";

export default defineConfig({
  base: "./",
  root: __dirname,
  plugins: [vue()],
  build: {
    outDir: path.resolve(__dirname, ".vite/renderer/main_window"),
    target: "es2022",
    minify: "esbuild",
    sourcemap: false,
    emptyOutDir: false,
    cssCodeSplit: false,
    chunkSizeWarningLimit: 1024,
    rollupOptions: {
      external: ["ws"],
      output: {
        compact: true,
        manualChunks(id) {
          if (!id.includes("node_modules")) {
            return;
          }

          if (
            id.includes("node_modules/vue") ||
            id.includes("node_modules/@vue") ||
            id.includes("node_modules/pinia")
          ) {
            return "vendor-vue";
          }

          if (
            id.includes("node_modules/element-plus") ||
            id.includes("node_modules/@element-plus")
          ) {
            return "vendor-element-plus";
          }

          if (id.includes("node_modules/zod")) {
            return "vendor-zod";
          }

          return "vendor";
        },
      },
    },
  },
  esbuild: {
    //drop: ["console", "debugger"],
  },
  optimizeDeps: {
    exclude: ["electron"],
  },
});

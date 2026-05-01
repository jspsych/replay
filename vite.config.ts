import { defineConfig } from "vite";

export default defineConfig({
  base: process.env["NODE_ENV"] === "production" ? "/replay/" : "./",
  build: {
    outDir: "dist",
    target: "es2020",
  },
  test: {
    environment: "jsdom",
    globals: true,
  },
});

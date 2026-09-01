import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiTarget = process.env.TENSOR_BOOK_DEV_API ?? "http://127.0.0.1:4311";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 4310,
    strictPort: true,
    proxy: {
      "/api": apiTarget,
    },
  },
  preview: {
    host: "127.0.0.1",
    port: 4310,
    strictPort: true,
  },
});

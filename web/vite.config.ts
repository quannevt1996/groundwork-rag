import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    // In development the API runs separately (npm run dev starts both).
    proxy: { "/api": "http://localhost:8787" },
  },
});

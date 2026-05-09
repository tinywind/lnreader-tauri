import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "react-vendor",
              test: /node_modules[\\/](react|react-dom|scheduler)/,
              priority: 40,
            },
            {
              name: "mantine-vendor",
              test: /node_modules[\\/]@mantine/,
              priority: 35,
            },
            {
              name: "tanstack-vendor",
              test: /node_modules[\\/]@tanstack/,
              priority: 30,
            },
            {
              name: "pdf-vendor",
              test: /node_modules[\\/]pdfjs-dist/,
              priority: 25,
              maxSize: 400_000,
            },
            {
              name: "tauri-vendor",
              test: /node_modules[\\/]@tauri-apps/,
              priority: 20,
            },
            {
              name: "html-vendor",
              test:
                /node_modules[\\/](cheerio|htmlparser2|parse5|domhandler|domutils|css-select|css-what|entities|encoding-sniffer|whatwg-encoding)/,
              priority: 15,
            },
            {
              name: "vendor",
              test: /node_modules/,
              priority: 10,
              maxSize: 400_000,
            },
          ],
        },
      },
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: "ws", host, port: 1421 }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});

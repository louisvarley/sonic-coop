import { defineConfig } from "vite";
import fs from "node:fs";
import path from "node:path";

const dataDir = path.resolve(__dirname, "../../data");
const apiTarget = process.env.API_TARGET ?? "http://localhost:2567";

export default defineConfig({
  server: {
    host: true,
    port: Number(process.env.CLIENT_PORT ?? 5173),
    proxy: {
      "/api": { target: apiTarget, ws: true, rewrite: (p) => p.replace(/^\/api/, "") },
    },
    fs: { allow: [path.resolve(__dirname, "../..")] },
  },
  build: { target: "es2022", sourcemap: true, rollupOptions: {
    input: { main: path.resolve(__dirname, "index.html"), sonic3: path.resolve(__dirname, "sonic3.html") },
  } },
  plugins: [
    {
      // In development the extracted game data is served straight from ../../data (in production nginx does it).
      name: "ringlink-data",
      configureServer(server) {
        server.middlewares.use("/data", (req, res, next) => {
          const file = path.join(dataDir, decodeURIComponent((req.url ?? "").split("?")[0]));
          if (!file.startsWith(dataDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return next();
          res.setHeader("Content-Length", fs.statSync(file).size);
          fs.createReadStream(file).pipe(res);
        });
      },
    },
  ],
});

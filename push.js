/**
 * Bitburner sync server — keeps connection open.
 * On connect: cleans old files, pushes all scripts.
 * Then watches for local file changes and auto-pushes them.
 *
 * Usage:
 *   node push.js
 *
 * Then in Bitburner: Options → Remote API → port 12525 → Connect
 * Leave it running — it will auto-sync whenever you edit scripts locally.
 */
import { WebSocketServer } from "ws";
import { readFileSync, readdirSync, statSync, watch } from "fs";
import { join, relative, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 12525;
const SERVER = "home";
const SKIP = new Set(["push.js", "serve.js", "bootstrap.js", "package.json", "package-lock.json", "node_modules"]);

function collectFiles(dir, base = dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...collectFiles(full, base));
    } else if (entry.endsWith(".js")) {
      files.push({ filename: relative(base, full), content: readFileSync(full, "utf-8") });
    }
  }
  return files;
}

function rpc(ws, method, params = {}) {
  const id = rpc.nextId++;
  ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
  return new Promise((resolve) => {
    ws.once("message", (data) => resolve(JSON.parse(data.toString())));
  });
}
rpc.nextId = 1;

const wss = new WebSocketServer({ port: PORT });
console.log(`Sync server listening on ws://localhost:${PORT}`);
console.log(`→ In Bitburner: Options → Remote API → port ${PORT} → Connect\n`);

let activeWs = null;

wss.on("connection", async (ws) => {
  activeWs = ws;
  console.log("Game connected!\n");

  // Step 1: Delete ALL existing files for a clean slate
  console.log("Cleaning up...");
  const files = collectFiles(__dirname);

  const resp = await rpc(ws, "getFileNames", { server: SERVER });
  const existing = resp.result || [];

  for (const filename of existing) {
    const del = await rpc(ws, "deleteFile", { filename, server: SERVER });
    if (del.result === "OK") console.log(`  🗑 ${filename}`);
  }

  // Step 2: Push all scripts
  console.log("\nPushing scripts...");
  for (const file of files) {
    const r = await rpc(ws, "pushFile", { filename: file.filename, content: file.content, server: SERVER });
    console.log(r.result === "OK" ? `  ✓ ${file.filename}` : `  ✗ ${file.filename}: ${r.error || ""}`);
  }

  console.log("\n✓ Sync complete. Watching for changes... (Ctrl+C to stop)\n");

  ws.on("close", () => {
    console.log("Game disconnected. Waiting for reconnect...");
    activeWs = null;
  });
});

// Watch for local file changes and auto-push
const debounce = new Map();
function watchDir(dir) {
  watch(dir, { recursive: true }, (event, filename) => {
    if (!filename || !filename.endsWith(".js") || !activeWs) return;
    // Skip non-game files
    const base = relative(__dirname, join(dir, filename));
    if (SKIP.has(base.split("/")[0]) || SKIP.has(base)) return;

    // Debounce: wait 500ms after last change
    if (debounce.has(base)) clearTimeout(debounce.get(base));
    debounce.set(base, setTimeout(async () => {
      debounce.delete(base);
      try {
        const fullPath = join(__dirname, base);
        const content = readFileSync(fullPath, "utf-8");
        const r = await rpc(activeWs, "pushFile", { filename: base, content, server: SERVER });
        const time = new Date().toLocaleTimeString();
        console.log(r.result === "OK" ? `[${time}] ↑ ${base}` : `[${time}] ✗ ${base}: ${r.error || ""}`);
      } catch {}
    }, 500));
  });
}
watchDir(__dirname);

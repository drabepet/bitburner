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

// Proper RPC: matches responses to requests by ID
let nextId = 1;
const pending = new Map();

function rpc(ws, method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    // Timeout after 10s to avoid hanging forever
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`RPC timeout: ${method}`));
      }
    }, 10000);
  });
}

function handleMessage(data) {
  let msg;
  try { msg = JSON.parse(data.toString()); } catch { return; }
  if (msg.id != null && pending.has(msg.id)) {
    const { resolve } = pending.get(msg.id);
    pending.delete(msg.id);
    resolve(msg);
  }
  // Ignore unsolicited messages (game pushes notifications sometimes)
}

const wss = new WebSocketServer({ port: PORT });
console.log(`Sync server listening on ws://localhost:${PORT}`);
console.log(`→ In Bitburner: Options → Remote API → port ${PORT} → Connect\n`);

let activeWs = null;
let syncing = false;

wss.on("connection", async (ws) => {
  activeWs = ws;
  ws.on("message", handleMessage);
  ws.on("close", () => {
    console.log("Game disconnected. Waiting for reconnect...");
    // Reject all pending RPCs
    for (const { reject } of pending.values()) {
      reject(new Error("WebSocket closed"));
    }
    pending.clear();
    activeWs = null;
    syncing = false;
  });

  console.log("Game connected!\n");
  syncing = true;

  try {
    // Step 1: Delete ALL existing files for a clean slate
    console.log("Cleaning up...");
    const resp = await rpc(ws, "getFileNames", { server: SERVER });
    const existing = resp.result || [];

    for (const filename of existing) {
      try {
        const del = await rpc(ws, "deleteFile", { filename, server: SERVER });
        if (del.result === "OK") console.log(`  🗑 ${filename}`);
      } catch (e) {
        console.log(`  ✗ delete ${filename}: ${e.message}`);
      }
    }

    // Step 2: Push all scripts
    console.log("\nPushing scripts...");
    const files = collectFiles(__dirname);
    for (const file of files) {
      try {
        const r = await rpc(ws, "pushFile", { filename: file.filename, content: file.content, server: SERVER });
        console.log(r.result === "OK" ? `  ✓ ${file.filename}` : `  ✗ ${file.filename}: ${JSON.stringify(r.error || "")}`);
      } catch (e) {
        console.log(`  ✗ ${file.filename}: ${e.message}`);
      }
    }

    console.log("\n✓ Sync complete. Watching for changes... (Ctrl+C to stop)\n");
  } catch (e) {
    console.error("Sync failed:", e.message);
  } finally {
    syncing = false;
  }
});

// Watch for local file changes and auto-push
const debounce = new Map();
function watchDir(dir) {
  watch(dir, { recursive: true }, (event, filename) => {
    if (!filename || !filename.endsWith(".js") || !activeWs || syncing) return;
    const base = relative(__dirname, join(dir, filename));
    if (SKIP.has(base.split("/")[0]) || SKIP.has(base)) return;

    if (debounce.has(base)) clearTimeout(debounce.get(base));
    debounce.set(base, setTimeout(async () => {
      debounce.delete(base);
      if (!activeWs || syncing) return;
      try {
        const fullPath = join(__dirname, base);
        const content = readFileSync(fullPath, "utf-8");
        const r = await rpc(activeWs, "pushFile", { filename: base, content, server: SERVER });
        const time = new Date().toLocaleTimeString();
        console.log(r.result === "OK" ? `[${time}] ↑ ${base}` : `[${time}] ✗ ${base}: ${JSON.stringify(r.error || "")}`);
      } catch (e) {
        const time = new Date().toLocaleTimeString();
        console.log(`[${time}] ✗ ${base}: ${e.message}`);
      }
    }, 500));
  });
}
watchDir(__dirname);

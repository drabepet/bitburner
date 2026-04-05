/**
 * Simple HTTP server to serve scripts for Bitburner's wget command.
 *
 * Usage: node serve.js
 * Then in Bitburner terminal:
 *   wget http://localhost:8888/main.js main.js
 *   wget http://localhost:8888/bootstrap.js bootstrap.js
 *   etc.
 */
import { createServer } from "http";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 8888;

const server = createServer((req, res) => {
  // Strip leading slash
  const filePath = join(__dirname, decodeURIComponent(req.url.slice(1)));

  if (existsSync(filePath) && filePath.endsWith(".js") && !filePath.includes("node_modules") && !filePath.includes("serve.js") && !filePath.includes("push.js")) {
    const content = readFileSync(filePath, "utf-8");
    res.writeHead(200, {
      "Content-Type": "text/plain",
      "Access-Control-Allow-Origin": "*"
    });
    res.end(content);
    console.log(`  ✓ Served ${req.url}`);
  } else {
    res.writeHead(404);
    res.end("Not found");
    console.log(`  ✗ 404 ${req.url}`);
  }
});

server.listen(PORT, () => {
  console.log(`Serving scripts on http://localhost:${PORT}\n`);
  console.log("Paste these commands into the Bitburner terminal:\n");

  const scripts = [
    "scripts/hack.js",
    "scripts/grow.js",
    "scripts/weaken.js",
    "modules/singularity-buy.js",
    "modules/purchaser.js",
    "modules/hacknet-mgr.js",
    "modules/singularity-aug.js",
    "bootstrap.js",
    "main.js",
  ];

  for (const s of scripts) {
    console.log(`wget http://localhost:${PORT}/${s} ${s}`);
  }
  console.log("\nThen: run main.js");
});

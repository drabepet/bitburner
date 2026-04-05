/** @param {NS} ns
 *  Auto-backdoor faction servers. Run manually (kills main.js to free RAM).
 *  After backdooring, restarts main.js automatically.
 *
 *  Usage: run backdoor.js
 */
export async function main(ns) {
  ns.disableLog("ALL");

  // Faction servers to backdoor (in order of hack level requirement)
  const targets = [
    { host: "CSEC", faction: "CyberSec", hackReq: 58 },
    { host: "avmnite-02h", faction: "NiteSec", hackReq: 202 },
    { host: "I.I.I.I", faction: "The Black Hand", hackReq: 340 },
    { host: "run4theh111z", faction: "BitRunners", hackReq: 505 },
  ];

  const hackLevel = ns.getHackingLevel();
  let didSomething = false;

  for (const t of targets) {
    if (hackLevel < t.hackReq) continue;
    if (!ns.hasRootAccess(t.host)) continue;
    if (ns.getServer(t.host).backdoorInstalled) {
      ns.tprint("INFO " + t.host + " already backdoored (" + t.faction + ")");
      continue;
    }

    // Find path from home to target
    const path = findPath(ns, "home", t.host);
    if (!path) {
      ns.tprint("WARN Could not find path to " + t.host);
      continue;
    }

    // Navigate to the server
    ns.tprint("INFO Connecting to " + t.host + " for " + t.faction + "...");
    for (const hop of path) {
      ns.singularity.connect(hop);
    }

    // Install backdoor (takes time based on hack level vs server level)
    ns.tprint("INFO Installing backdoor on " + t.host + "...");
    await ns.singularity.installBackdoor();
    ns.tprint("SUCCESS Backdoored " + t.host + " — " + t.faction + " faction invite incoming!");
    didSomething = true;

    // Go back home
    ns.singularity.connect("home");
  }

  if (!didSomething) {
    ns.tprint("INFO No servers to backdoor at hack level " + hackLevel);
  }

  // Restart main.js
  ns.tprint("INFO Restarting main.js...");
  ns.spawn("main.js");
}

/** BFS to find path from source to target */
function findPath(ns, source, target) {
  const visited = new Set([source]);
  const queue = [[source]];
  while (queue.length > 0) {
    const path = queue.shift();
    const current = path[path.length - 1];
    for (const neighbor of ns.scan(current)) {
      if (neighbor === target) return [...path.slice(1), neighbor];
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push([...path, neighbor]);
      }
    }
  }
  return null;
}

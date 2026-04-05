/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL");
  ns.tail();

  while (true) {
    const homeRam  = ns.getServerMaxRam("home");
    const homeUsed = ns.getServerUsedRam("home");
    const homeFree = homeRam - homeUsed;
    const hackLevel = ns.getHackingLevel();
    const money     = ns.getServerMoneyAvailable("home");

    // 1. Scan network
    const allServers = deepScan(ns);

    // 2. Open ports + nuke newly accessible servers
    const numPorts = countPortOpeners(ns);
    openAndNuke(ns, allServers, numPorts);

    // 3. Pick best target
    const target = selectTarget(ns, allServers, hackLevel);
    ns.print(`INFO Hack ${hackLevel} | RAM ${homeRam} GB | $${ns.formatNumber(money)} | Target: ${target}`);

    // 4. Launch modules FIRST (before workers eat RAM)
    if (homeFree >= 6)  maybeExec(ns, "modules/hacknet-mgr.js");
    if (homeFree >= 55) maybeExec(ns, "modules/singularity-buy.js");
    if (homeFree >= 8)  maybeExec(ns, "modules/purchaser.js");
    if (hackLevel >= 800 && money >= 1e9 && homeFree >= 90) {
      maybeExec(ns, "modules/singularity-aug.js");
    }

    // 5. HWGW batcher on 128+ GB home (replaces looping workers)
    const batcherRunning = ns.isRunning("modules/batcher.js", "home");
    if (homeRam >= 128) {
      if (!batcherRunning) {
        const pid = ns.exec("modules/batcher.js", "home");
        if (pid > 0) ns.print("INFO Launched batcher");
      }
    }

    // 6. Deploy looping workers when batcher is NOT running
    if (!batcherRunning) {
      // Copy once-* scripts too (batcher uses them when it starts later)
      const allWorkers = [
        "scripts/hack.js", "scripts/grow.js", "scripts/weaken.js",
        "scripts/once-hack.js", "scripts/once-grow.js", "scripts/once-weaken.js",
      ];
      for (const server of allServers) {
        if (server === "home") continue;
        if (ns.hasRootAccess(server) && ns.getServerMaxRam(server) > 0) {
          ns.scp(allWorkers, server, "home");
          deployTo(ns, server, target);
        }
      }
      if (homeRam >= 64) deployTo(ns, "home", target);
    }

    // 7. Guide the player when Singularity is too expensive
    if (homeFree < 55) {
      showGuidance(ns, hackLevel, money, homeRam);
    }

    await ns.sleep(10000);
  }
}

function deepScan(ns) {
  const visited = new Set(["home"]);
  const queue = ["home"];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const neighbor of ns.scan(current)) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }
  visited.delete("home");
  return [...visited];
}

function countPortOpeners(ns) {
  let count = 0;
  if (ns.fileExists("BruteSSH.exe",  "home")) count++;
  if (ns.fileExists("FTPCrack.exe",  "home")) count++;
  if (ns.fileExists("relaySMTP.exe", "home")) count++;
  if (ns.fileExists("HTTPWorm.exe",  "home")) count++;
  if (ns.fileExists("SQLInject.exe", "home")) count++;
  return count;
}

function openAndNuke(ns, servers, numPorts) {
  for (const host of servers) {
    if (ns.hasRootAccess(host)) continue;
    if (ns.getServerNumPortsRequired(host) > numPorts) continue;
    try { ns.brutessh(host);  } catch {}
    try { ns.ftpcrack(host);  } catch {}
    try { ns.relaysmtp(host); } catch {}
    try { ns.httpworm(host);  } catch {}
    try { ns.sqlinject(host); } catch {}
    try { ns.nuke(host); ns.print(`SUCCESS Rooted ${host}`); } catch {}
  }
}

/** Score = expected $/sec per thread: accounts for steal%, hack chance, and speed.
 *  This correctly favours fast low-security servers (n00dles) over slow high-security
 *  ones even when max money is higher, because hackAnalyze and hackChance drop with
 *  higher security and hackTime increases. */
function selectTarget(ns, servers, hackLevel) {
  let best = "n00dles";
  let bestScore = -1;
  for (const host of servers) {
    if (!ns.hasRootAccess(host)) continue;
    if (ns.getServerRequiredHackingLevel(host) > hackLevel / 2) continue;
    const maxMoney = ns.getServerMaxMoney(host);
    if (maxMoney === 0) continue;
    const score = (maxMoney * ns.hackAnalyzeChance(host) * ns.hackAnalyze(host))
                  / ns.getHackTime(host);
    if (score > bestScore) { bestScore = score; best = host; }
  }
  return best;
}

function deployTo(ns, server, target) {
  const procs = ns.ps(server);
  const workerFiles = new Set(["scripts/hack.js", "scripts/grow.js", "scripts/weaken.js"]);
  const workerProcs = procs.filter(p => workerFiles.has(p.filename));

  if (workerProcs.length > 0) {
    if (workerProcs.every(p => p.args[0] === target)) return;
    for (const p of workerProcs) ns.kill(p.pid);
  }

  const freeRam = ns.getServerMaxRam(server) - ns.getServerUsedRam(server);
  if (freeRam < 1.70) return;

  const security = ns.getServerSecurityLevel(target);
  const minSec   = ns.getServerMinSecurityLevel(target);
  const money    = ns.getServerMoneyAvailable(target);
  const maxMoney = ns.getServerMaxMoney(target);
  const maxThreads = Math.floor(freeRam / 1.75);

  if (ns.getServerMaxRam(server) < 8) {
    ns.exec("scripts/hack.js", server, Math.max(1, Math.floor(freeRam / 1.70)), target);
    return;
  }

  if (security > minSec + 10) {
    const w = Math.ceil(maxThreads * 0.6);
    const h = maxThreads - w;
    if (w > 0) ns.exec("scripts/weaken.js", server, w, target);
    if (h > 0) ns.exec("scripts/hack.js",   server, h, target);
  } else if (money < maxMoney * 0.25) {
    const g = Math.ceil(maxThreads * 0.7);
    const h = maxThreads - g;
    if (g > 0) ns.exec("scripts/grow.js", server, g, target);
    if (h > 0) ns.exec("scripts/hack.js", server, h, target);
  } else {
    const h = Math.max(1, Math.floor(maxThreads * 0.75));
    const g = Math.max(1, Math.floor(maxThreads * 0.15));
    const w = Math.max(0, maxThreads - h - g);
    if (h > 0) ns.exec("scripts/hack.js",   server, h, target);
    if (g > 0) ns.exec("scripts/grow.js",   server, g, target);
    if (w > 0) ns.exec("scripts/weaken.js", server, w, target);
  }
}

function showGuidance(ns, hackLevel, money, homeRam) {
  const tips = [];
  if (homeRam < 16) {
    tips.push("ACTION: Buy hacknet nodes from the Hacknet menu (left sidebar) — passive $$$!");
    tips.push("ACTION: Upgrade home RAM at City → Alpha Enterprises (need 16+ GB for hacknet automation)");
  }
  if (hackLevel < 10) {
    tips.push("ACTION: Go to Sector-12 → Rothman University → Study 'Algorithms' to level hacking fast!");
  } else if (hackLevel < 50) {
    tips.push("ACTION: Keep studying 'Algorithms' at Rothman University until hack level 50+");
  }
  if (homeRam >= 16 && homeRam < 64) {
    tips.push("ACTION: Upgrade home RAM to 64+ GB at Alpha Enterprises for full automation");
  }
  if (!ns.hasTorRouter() && money >= 200000) {
    tips.push("ACTION: Go to City → Alpha Enterprises → Buy TOR Router ($200k)");
  }
  if (ns.hasTorRouter()) {
    if (!ns.fileExists("BruteSSH.exe", "home")) tips.push("ACTION: Buy BruteSSH.exe from darkweb");
    else if (!ns.fileExists("FTPCrack.exe", "home")) tips.push("ACTION: Buy FTPCrack.exe from darkweb");
  }
  if (hackLevel >= 50 && homeRam >= 32) {
    tips.push("TIP: Join CyberSec faction (backdoor CSEC server) and work for them");
  }
  for (const tip of tips) ns.print("WARN " + tip);
}

function maybeExec(ns, script) {
  if (!ns.isRunning(script, "home")) {
    const pid = ns.exec(script, "home");
    if (pid > 0) ns.print(`INFO Launched ${script}`);
  }
}

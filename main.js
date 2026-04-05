/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL");
  ns.tail();

  const WORKERS = ["scripts/hack.js", "scripts/grow.js", "scripts/weaken.js"];

  while (true) {
    const homeRam = ns.getServerMaxRam("home");
    const homeUsed = ns.getServerUsedRam("home");
    const homeFree = homeRam - homeUsed;
    const hackLevel = ns.getHackingLevel();
    const money = ns.getServerMoneyAvailable("home");

    // 1. Scan network
    const allServers = deepScan(ns);

    // 2. Open ports + nuke
    const numPorts = countPortOpeners(ns);
    openAndNuke(ns, allServers, numPorts);

    // 3. Pick best target
    const target = selectTarget(ns, allServers, hackLevel, numPorts);
    ns.print(`INFO Hack ${hackLevel} | RAM ${homeRam} GB | $${ns.formatNumber(money)} | Target: ${target}`);

    // 4. Launch modules FIRST (before workers eat all the RAM)
    if (homeFree >= 6)  maybeExec(ns, "modules/hacknet-mgr.js");
    if (homeFree >= 55) maybeExec(ns, "modules/singularity-buy.js");
    if (homeFree >= 8)  maybeExec(ns, "modules/purchaser.js");
    if (hackLevel >= 800 && money >= 1e9 && homeFree >= 90) {
      maybeExec(ns, "modules/singularity-aug.js");
    }

    // 5. Deploy workers to rooted servers (skip home — reserve RAM for modules)
    for (const server of allServers) {
      if (server === "home") continue;
      if (ns.hasRootAccess(server) && ns.getServerMaxRam(server) > 0) {
        deployTo(ns, server, target);
      }
    }
    // Only use home for hacking if we have plenty of RAM (64+ GB)
    if (homeRam >= 64) {
      deployTo(ns, "home", target);
    }

    // 6. Guide the player when Singularity is too expensive to run
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
  if (ns.fileExists("BruteSSH.exe", "home")) count++;
  if (ns.fileExists("FTPCrack.exe", "home")) count++;
  if (ns.fileExists("relaySMTP.exe", "home")) count++;
  if (ns.fileExists("HTTPWorm.exe", "home")) count++;
  if (ns.fileExists("SQLInject.exe", "home")) count++;
  return count;
}

function openAndNuke(ns, servers, numPorts) {
  for (const host of servers) {
    if (ns.hasRootAccess(host)) continue;
    if (ns.getServerNumPortsRequired(host) > numPorts) continue;
    try { ns.brutessh(host); } catch {}
    try { ns.ftpcrack(host); } catch {}
    try { ns.relaysmtp(host); } catch {}
    try { ns.httpworm(host); } catch {}
    try { ns.sqlinject(host); } catch {}
    try { ns.nuke(host); ns.print(`SUCCESS Rooted ${host}`); } catch {}
  }
}

function selectTarget(ns, servers, hackLevel, numPorts) {
  let best = "n00dles";
  let bestScore = 0;
  for (const host of servers) {
    if (!ns.hasRootAccess(host)) continue;
    const reqLevel = ns.getServerRequiredHackingLevel(host);
    if (reqLevel > hackLevel) continue;
    // Only target servers where we have at least 2x the required level
    // This ensures we can hack efficiently (good success chance)
    if (reqLevel > hackLevel / 2) continue;
    const maxMoney = ns.getServerMaxMoney(host);
    if (maxMoney === 0) continue;
    const score = maxMoney / (ns.getHackTime(host) * Math.max(ns.getServerMinSecurityLevel(host), 1));
    if (score > bestScore) { bestScore = score; best = host; }
  }
  return best;
}

function deployTo(ns, server, target) {
  ns.scp(["scripts/hack.js", "scripts/grow.js", "scripts/weaken.js"], server, "home");
  const freeRam = ns.getServerMaxRam(server) - ns.getServerUsedRam(server);
  if (freeRam < 1.70) return;

  const security = ns.getServerSecurityLevel(target);
  const minSec = ns.getServerMinSecurityLevel(target);
  const money = ns.getServerMoneyAvailable(target);
  const maxMoney = ns.getServerMaxMoney(target);
  const maxThreads = Math.floor(freeRam / 1.75);

  // Small servers (< 8 GB): just hack, simple and effective
  if (ns.getServerMaxRam(server) < 8) {
    ns.exec("scripts/hack.js", server, Math.floor(freeRam / 1.70), target);
    return;
  }

  // Larger servers: balanced approach
  // Only weaken if security is way too high
  if (security > minSec + 10) {
    const t = Math.ceil(maxThreads * 0.5);
    const h = maxThreads - t;
    if (t > 0) ns.exec("scripts/weaken.js", server, t, target);
    if (h > 0) ns.exec("scripts/hack.js", server, h, target);
  } else if (money < maxMoney * 0.5) {
    // Grow + hack together
    const g = Math.ceil(maxThreads * 0.5);
    const h = maxThreads - g;
    if (g > 0) ns.exec("scripts/grow.js", server, g, target);
    if (h > 0) ns.exec("scripts/hack.js", server, h, target);
  } else {
    // Good state: mostly hack, some grow/weaken maintenance
    const h = Math.max(1, Math.floor(maxThreads * 0.6));
    const g = Math.max(1, Math.floor(maxThreads * 0.2));
    const w = Math.max(0, maxThreads - h - g);
    if (h > 0) ns.exec("scripts/hack.js", server, h, target);
    if (g > 0) ns.exec("scripts/grow.js", server, g, target);
    if (w > 0) ns.exec("scripts/weaken.js", server, w, target);
  }
}

/** Print guidance for the player when Singularity API is too expensive */
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
    if (!ns.fileExists("BruteSSH.exe", "home")) tips.push("ACTION: Buy BruteSSH.exe from darkweb (buy BruteSSH.exe in terminal)");
    else if (!ns.fileExists("FTPCrack.exe", "home")) tips.push("ACTION: Buy FTPCrack.exe from darkweb");
  }

  if (hackLevel >= 50 && homeRam >= 32) {
    tips.push("TIP: Join CyberSec faction (backdoor CSEC server) and work for them");
  }

  for (const tip of tips) {
    ns.print("WARN " + tip);
  }
}

function maybeExec(ns, script) {
  if (!ns.isRunning(script, "home")) {
    const pid = ns.exec(script, "home");
    if (pid > 0) ns.print(`INFO Launched ${script}`);
  }
}

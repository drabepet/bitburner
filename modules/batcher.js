/** @param {NS} ns
 *  HWGW batch hacker with parallel batches.
 *  Launches as many simultaneous batches as RAM allows, staggered every
 *  SPACER*4 ms so each batch's operations land cleanly in order:
 *    Hack → Weaken1 → Grow → Weaken2  (50 ms apart)
 *  Distributes threads across all rooted servers including purchased ones.
 */
export async function main(ns) {
  ns.disableLog("ALL");
  ns.tail();

  const SPACER       = 50;   // ms gap between each operation landing
  const BATCH_PERIOD = SPACER * 4;  // 200 ms between batch starts
  const HACK_FRAC    = 0.5;  // steal 50 % per batch (auto-scaled down if needed)

  // BFS all usable servers
  function getServers() {
    const list    = [];
    const visited = new Set(["home"]);
    const queue   = ["home"];
    while (queue.length) {
      const cur = queue.shift();
      for (const s of ns.scan(cur)) {
        if (!visited.has(s)) {
          visited.add(s);
          queue.push(s);
          if (ns.hasRootAccess(s) && ns.getServerMaxRam(s) > 0) list.push(s);
        }
      }
    }
    list.unshift("home");
    return list;
  }

  function syncWorkers(servers) {
    const scripts = ["scripts/once-hack.js", "scripts/once-grow.js", "scripts/once-weaken.js"];
    for (const s of servers) {
      if (s !== "home") ns.scp(scripts, s, "home");
    }
  }

  // Allocate threads across servers; returns unallocated remainder
  function alloc(servers, threads, script, ...args) {
    let rem = threads;
    for (const s of servers) {
      if (rem <= 0) break;
      const free = Math.floor((ns.getServerMaxRam(s) - ns.getServerUsedRam(s)) / 1.75);
      if (free <= 0) continue;
      const use = Math.min(rem, free);
      if (ns.exec(script, s, use, ...args) > 0) rem -= use;
    }
    return rem;
  }

  function killAll(servers) {
    const names = new Set(["scripts/once-hack.js", "scripts/once-grow.js", "scripts/once-weaken.js"]);
    for (const s of servers) {
      for (const p of ns.ps(s)) {
        if (names.has(p.filename)) ns.kill(p.pid);
      }
    }
  }

  async function prep(target, servers) {
    ns.print(`INFO Prepping ${target}...`);
    for (let i = 0; i < 200; i++) {
      const sec      = ns.getServerSecurityLevel(target);
      const minSec   = ns.getServerMinSecurityLevel(target);
      const money    = ns.getServerMoneyAvailable(target);
      const maxMoney = ns.getServerMaxMoney(target);
      if (sec <= minSec + 0.5 && money >= maxMoney * 0.99) break;
      killAll(servers);
      if (sec > minSec + 0.5) {
        const wT = Math.max(1, Math.ceil((sec - minSec) / 0.05));
        alloc(servers, wT, "scripts/once-weaken.js", target, 0);
        await ns.sleep(ns.getWeakenTime(target) + 500);
      } else {
        const factor = Math.max(1.001, maxMoney / Math.max(money, 1));
        const gT     = Math.max(1, Math.ceil(ns.growthAnalyze(target, factor)));
        const wT     = Math.max(1, Math.ceil(gT * 0.004 / 0.05));
        alloc(servers, gT, "scripts/once-grow.js",   target, 0);
        alloc(servers, wT, "scripts/once-weaken.js", target, ns.getGrowTime(target) + 100);
        await ns.sleep(ns.getWeakenTime(target) + 500);
      }
    }
    ns.print(`INFO ${target} prepped!`);
  }

  const target = "n00dles";
  let servers  = [];
  let batchId  = 0;
  let prepared = false;

  while (true) {
    servers = getServers();
    syncWorkers(servers);

    if (!prepared) {
      killAll(servers);
      await prep(target, servers);
      prepared = true;
    }

    const wTime = ns.getWeakenTime(target);
    const gTime = ns.getGrowTime(target);
    const hTime = ns.getHackTime(target);

    // Total free RAM across all servers
    const totalRam = servers.reduce(
      (sum, s) => sum + Math.max(0, ns.getServerMaxRam(s) - ns.getServerUsedRam(s)), 0);

    // Max parallel batches the time window can hold
    const maxByTime = Math.max(1, Math.floor(wTime / BATCH_PERIOD));

    // Find hack fraction where at least 1 batch fits
    let hackFrac = HACK_FRAC;
    let hT, w1T, gT, w2T, batchRam;
    for (let i = 0; i < 25; i++) {
      hT       = Math.max(1, Math.floor(ns.hackAnalyzeThreads(target, hackFrac)));
      w1T      = Math.max(1, Math.ceil(hT * 0.002 / 0.05));
      gT       = Math.max(1, Math.ceil(ns.growthAnalyze(target, 1 / (1 - hackFrac))));
      w2T      = Math.max(1, Math.ceil(gT * 0.004 / 0.05));
      batchRam = (hT + w1T + gT + w2T) * 1.75;
      if (batchRam <= totalRam * 0.9) break;
      hackFrac *= 0.7;
    }

    if (batchRam > totalRam) {
      ns.print(`WARN Not enough RAM (need ${batchRam.toFixed(0)} GB, have ${totalRam.toFixed(0)} GB)`);
      await ns.sleep(5000);
      continue;
    }

    // How many parallel batches fit in available RAM?
    const maxByRam    = Math.max(1, Math.floor(totalRam * 0.9 / batchRam));
    const numBatches  = Math.min(maxByTime, maxByRam);

    // Re-prep if target drifted
    const sec      = ns.getServerSecurityLevel(target);
    const minSec   = ns.getServerMinSecurityLevel(target);
    const money    = ns.getServerMoneyAvailable(target);
    const maxMoney = ns.getServerMaxMoney(target);
    if (sec > minSec + 5 || money < maxMoney * 0.1) {
      ns.print(`WARN Out of sync — re-prepping (sec +${(sec - minSec).toFixed(1)}, ` +
               `$${ns.formatNumber(money)}/${ns.formatNumber(maxMoney)})`);
      prepared = false;
      continue;
    }

    ns.print(`INFO ${numBatches}x batches [${(hackFrac * 100).toFixed(0)}%] ` +
             `H:${hT} W1:${w1T} G:${gT} W2:${w2T} | ${(batchRam * numBatches).toFixed(0)} GB used`);

    // Launch all batches staggered by BATCH_PERIOD
    for (let b = 0; b < numBatches; b++) {
      const off = b * BATCH_PERIOD;
      const tag = batchId++;
      // Timing: W1 starts at off, H lands SPACER before W1, G lands SPACER after, W2 lands 2*SPACER after
      alloc(servers, w1T, "scripts/once-weaken.js", target, off,                              tag);
      alloc(servers, hT,  "scripts/once-hack.js",   target, off + wTime - hTime - SPACER,     tag);
      alloc(servers, gT,  "scripts/once-grow.js",   target, off + wTime - gTime + SPACER,     tag);
      alloc(servers, w2T, "scripts/once-weaken.js", target, off + SPACER * 2,                 tag);
    }

    // Wait for all batches to finish
    await ns.sleep(wTime + numBatches * BATCH_PERIOD + 500);
  }
}

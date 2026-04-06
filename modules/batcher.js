/** @param {NS} ns
 *  Multi-target HWGW batch hacker.
 *  - Selects top N targets by expected $/sec/thread
 *  - Preps each target (min security + max money)
 *  - Runs parallel HWGW batches across all rooted servers
 *  - Primary target gets first pick of RAM; secondary targets use remainder
 *  - Kills looping workers from main.js on startup to reclaim RAM
 */
export async function main(ns) {
  ns.disableLog("ALL");
  ns.tail();

  const SPACER       = 50;
  const BATCH_PERIOD = SPACER * 4;   // 200 ms between batch starts
  const MAX_TARGETS  = 3;

  // ── Helpers ──────────────────────────────────────────────────────────────

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

  // Kill ALL worker scripts — both looping (hack.js etc.) and once-*
  function killAll(servers) {
    const names = new Set([
      "scripts/hack.js", "scripts/grow.js", "scripts/weaken.js",
      "scripts/once-hack.js", "scripts/once-grow.js", "scripts/once-weaken.js",
    ]);
    for (const s of servers) {
      for (const p of ns.ps(s)) {
        if (names.has(p.filename)) ns.kill(p.pid);
      }
    }
  }

  // Kill only once-* workers targeting a specific host
  function killTarget(servers, target) {
    const names = new Set(["scripts/once-hack.js", "scripts/once-grow.js", "scripts/once-weaken.js"]);
    for (const s of servers) {
      for (const p of ns.ps(s)) {
        if (names.has(p.filename) && p.args[0] === target) ns.kill(p.pid);
      }
    }
  }

  function hasRunningBatch(servers, target) {
    const names = new Set(["scripts/once-hack.js", "scripts/once-grow.js", "scripts/once-weaken.js"]);
    for (const s of servers) {
      for (const p of ns.ps(s)) {
        if (names.has(p.filename) && p.args[0] === target) return true;
      }
    }
    return false;
  }

  function isPrepped(target) {
    return ns.getServerSecurityLevel(target) <= ns.getServerMinSecurityLevel(target) + 0.5
        && ns.getServerMoneyAvailable(target) >= ns.getServerMaxMoney(target) * 0.99;
  }

  // Top N targets by expected $/sec/thread
  function selectTargets(servers, hackLevel) {
    const candidates = [];
    for (const host of servers) {
      if (host === "home") continue;
      if (!ns.hasRootAccess(host)) continue;
      if (ns.getServerRequiredHackingLevel(host) > hackLevel / 2) continue;
      const maxMoney = ns.getServerMaxMoney(host);
      if (maxMoney === 0) continue;
      const score = (maxMoney * ns.hackAnalyzeChance(host) * ns.hackAnalyze(host))
                    / ns.getHackTime(host);
      candidates.push({ host, score });
    }
    candidates.sort((a, b) => b.score - a.score);
    return candidates.slice(0, MAX_TARGETS).map(c => c.host);
  }

  // Prep a single target: weaken to min sec, grow to max money
  async function prep(target, servers) {
    ns.print(`INFO Prepping ${target}...`);
    killTarget(servers, target);
    for (let i = 0; i < 200; i++) {
      if (isPrepped(target)) break;
      const sec      = ns.getServerSecurityLevel(target);
      const minSec   = ns.getServerMinSecurityLevel(target);
      const money    = ns.getServerMoneyAvailable(target);
      const maxMoney = ns.getServerMaxMoney(target);
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
      killTarget(servers, target);
    }
    ns.print(`INFO ${target} prepped!`);
  }

  // Launch parallel HWGW batches for target using current free RAM; returns expected sleep time
  let batchId = 0;
  function launchBatches(target, servers, label = "") {
    const wTime   = ns.getWeakenTime(target);
    const gTime   = ns.getGrowTime(target);
    const hTime   = ns.getHackTime(target);
    const avail   = servers.reduce(
      (sum, s) => sum + Math.max(0, ns.getServerMaxRam(s) - ns.getServerUsedRam(s)), 0);

    // Scale hack fraction down until one batch fits
    let hackFrac = 0.5;
    let hT, w1T, gT, w2T, batchRam;
    for (let i = 0; i < 25; i++) {
      hT       = Math.max(1, Math.floor(ns.hackAnalyzeThreads(target, hackFrac)));
      w1T      = Math.max(1, Math.ceil(hT * 0.002 / 0.05));
      gT       = Math.max(1, Math.ceil(ns.growthAnalyze(target, 1 / (1 - hackFrac))));
      w2T      = Math.max(1, Math.ceil(gT * 0.004 / 0.05));
      batchRam = (hT + w1T + gT + w2T) * 1.75;
      if (batchRam <= avail * 0.95) break;
      hackFrac *= 0.7;
    }

    if (batchRam > avail) return 0;

    const maxByTime  = Math.max(1, Math.floor(wTime / BATCH_PERIOD));
    const maxByRam   = Math.max(1, Math.floor(avail * 0.9 / batchRam));
    const numBatches = Math.min(maxByTime, maxByRam);

    const delayH  = Math.max(0, wTime - hTime - SPACER);
    const delayG  = Math.max(0, wTime - gTime + SPACER);
    const delayW2 = SPACER * 2;

    for (let b = 0; b < numBatches; b++) {
      const off = b * BATCH_PERIOD;
      const tag = batchId++;
      alloc(servers, w1T, "scripts/once-weaken.js", target, off,                tag);
      alloc(servers, hT,  "scripts/once-hack.js",   target, off + delayH,       tag);
      alloc(servers, gT,  "scripts/once-grow.js",   target, off + delayG,       tag);
      alloc(servers, w2T, "scripts/once-weaken.js", target, off + delayW2,      tag);
    }

    ns.print(`INFO ${label}${target} [${(hackFrac*100).toFixed(0)}%] ` +
             `${numBatches}x | H:${hT} W:${w1T} G:${gT} W:${w2T} | ` +
             `${(batchRam*numBatches).toFixed(0)}GB`);

    return wTime + numBatches * BATCH_PERIOD + 500;
  }

  // ── Main loop ─────────────────────────────────────────────────────────────

  let servers = [];
  let firstRun = true;

  while (true) {
    servers = getServers();
    syncWorkers(servers);

    const hackLevel = ns.getHackingLevel();
    const targets   = selectTargets(servers, hackLevel);

    if (!targets.length) { await ns.sleep(5000); continue; }

    // On first run, kill all looping workers to reclaim RAM
    if (firstRun) {
      ns.print("INFO Clearing looping workers...");
      killAll(servers);
      firstRun = false;
    }

    // Prep any target that isn't ready
    for (const t of targets) {
      if (!isPrepped(t)) await prep(t, servers);
    }

    // Primary target: launch batches first, gets first pick of RAM
    const primarySleep = launchBatches(targets[0], servers, "★ ");

    // Secondary targets: use leftover RAM, skip if their previous batch still running
    for (let i = 1; i < targets.length; i++) {
      const t = targets[i];
      if (!hasRunningBatch(servers, t)) {
        launchBatches(t, servers, `[${i + 1}] `);
      }
    }

    await ns.sleep(Math.max(primarySleep, 1000));
  }
}

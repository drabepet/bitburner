/** @param {NS} ns
 *  HWGW batch hacker — precisely timed operations for maximum income.
 *  Operations land in order: Hack → Weaken1 → Grow → Weaken2, 50ms apart.
 *  Distributes threads across all rooted servers.
 *  Requires ~128+ GB home RAM to run alongside singularity modules.
 */
export async function main(ns) {
  ns.disableLog("ALL");
  ns.tail();

  const SPACER = 50;          // ms gap between each operation landing
  const HACK_FRACTION = 0.5;  // start at 50%, auto-scaled down to fit RAM

  // BFS scan for all usable servers (rooted, have RAM)
  function getServers() {
    const list = [];
    const visited = new Set(["home"]);
    const queue = ["home"];
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

  // Push once-* workers to all non-home servers
  function syncWorkers(servers) {
    const scripts = ["scripts/once-hack.js", "scripts/once-grow.js", "scripts/once-weaken.js"];
    for (const s of servers) {
      if (s !== "home") ns.scp(scripts, s, "home");
    }
  }

  // Distribute threads across servers; returns count of unallocated threads
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

  // Kill all once-* workers across all servers
  function killAll(servers) {
    const names = new Set(["scripts/once-hack.js", "scripts/once-grow.js", "scripts/once-weaken.js"]);
    for (const s of servers) {
      for (const p of ns.ps(s)) {
        if (names.has(p.filename)) ns.kill(p.pid);
      }
    }
  }

  // Pick best target: highest expected $/sec/thread
  function selectTarget(servers) {
    const hackLevel = ns.getHackingLevel();
    let best = "n00dles";
    let bestScore = -1;
    for (const host of servers) {
      if (host === "home") continue;
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

  // Prep: bring target to min security + max money
  async function prep(target, servers) {
    ns.print(`INFO Prepping ${target}...`);
    for (let i = 0; i < 200; i++) {
      const sec    = ns.getServerSecurityLevel(target);
      const minSec = ns.getServerMinSecurityLevel(target);
      const money  = ns.getServerMoneyAvailable(target);
      const maxMoney = ns.getServerMaxMoney(target);
      if (sec <= minSec + 0.5 && money >= maxMoney * 0.99) break;

      killAll(servers);

      if (sec > minSec + 0.5) {
        const threads = Math.max(1, Math.ceil((sec - minSec) / 0.05));
        alloc(servers, threads, "scripts/once-weaken.js", target, 0);
        await ns.sleep(ns.getWeakenTime(target) + 500);
      } else {
        const factor  = Math.max(1.001, ns.getServerMaxMoney(target) / Math.max(money, 1));
        const gT = Math.max(1, Math.ceil(ns.growthAnalyze(target, factor)));
        const wT = Math.max(1, Math.ceil(gT * 0.004 / 0.05));
        alloc(servers, gT, "scripts/once-grow.js",   target, 0);
        alloc(servers, wT, "scripts/once-weaken.js", target, ns.getGrowTime(target) + 100);
        await ns.sleep(ns.getWeakenTime(target) + 500);
      }
    }
    ns.print(`INFO ${target} prepped!`);
  }

  let target = null;
  let servers = [];
  let batchNum = 0;

  while (true) {
    servers = getServers();
    syncWorkers(servers);

    // Re-evaluate target every 20 batches
    if (batchNum % 20 === 0) {
      const best = selectTarget(servers);
      if (best !== target) {
        if (target) ns.print(`INFO Target: ${target} → ${best}`);
        target = best;
        killAll(servers);
        await prep(target, servers);
      }
    }

    const wTime = ns.getWeakenTime(target);
    const gTime = ns.getGrowTime(target);
    const hTime = ns.getHackTime(target);

    // Total free RAM across all servers
    const totalRam = servers.reduce(
      (sum, s) => sum + Math.max(0, ns.getServerMaxRam(s) - ns.getServerUsedRam(s)), 0);

    // Scale hack fraction down until batch fits in available RAM
    let hackFrac = HACK_FRACTION;
    let hT, w1T, gT, w2T, batchRam;
    for (let i = 0; i < 25; i++) {
      hT  = Math.max(1, Math.floor(ns.hackAnalyzeThreads(target, hackFrac)));
      w1T = Math.max(1, Math.ceil(hT * 0.002 / 0.05));
      gT  = Math.max(1, Math.ceil(ns.growthAnalyze(target, 1 / (1 - hackFrac))));
      w2T = Math.max(1, Math.ceil(gT * 0.004 / 0.05));
      batchRam = (hT + w1T + gT + w2T) * 1.75;
      if (batchRam <= totalRam * 0.9) break;
      hackFrac *= 0.7;
    }

    if (batchRam > totalRam) {
      ns.print(`WARN Not enough RAM (need ${batchRam.toFixed(0)} GB, have ${totalRam.toFixed(0)} GB)`);
      await ns.sleep(5000);
      continue;
    }

    // Check if target drifted out of ideal state
    const sec    = ns.getServerSecurityLevel(target);
    const minSec = ns.getServerMinSecurityLevel(target);
    const money  = ns.getServerMoneyAvailable(target);
    const maxMon = ns.getServerMaxMoney(target);
    if (sec > minSec + 5 || money < maxMon * 0.1) {
      ns.print(`WARN ${target} out of sync — re-prepping (sec +${(sec-minSec).toFixed(1)}, money ${ns.formatNumber(money)}/${ns.formatNumber(maxMon)})`);
      killAll(servers);
      await prep(target, servers);
      continue;
    }

    // Timing: operations land in order H → W1 → G → W2, SPACER ms apart
    // W1 starts at t=0, finishes at wTime
    // H   finishes SPACER before W1:  delay = wTime - hTime - SPACER
    // G   finishes SPACER after  W1:  delay = wTime - gTime + SPACER
    // W2  finishes 2*SPACER after W1: delay = 2*SPACER
    const delayW1 = 0;
    const delayH  = Math.max(0, wTime - hTime - SPACER);
    const delayG  = Math.max(0, wTime - gTime + SPACER);
    const delayW2 = SPACER * 2;

    const tag = batchNum++;
    alloc(servers, w1T, "scripts/once-weaken.js", target, delayW1, tag);
    alloc(servers, hT,  "scripts/once-hack.js",   target, delayH,  tag);
    alloc(servers, gT,  "scripts/once-grow.js",   target, delayG,  tag);
    alloc(servers, w2T, "scripts/once-weaken.js", target, delayW2, tag);

    ns.print(`INFO #${tag} ${target} [${(hackFrac*100).toFixed(0)}%steal] H:${hT} W1:${w1T} G:${gT} W2:${w2T} | ${batchRam.toFixed(0)}GB`);

    // Wait for this batch to complete before launching next
    await ns.sleep(wTime + SPACER * 4 + 200);
  }
}

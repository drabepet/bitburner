/** @param {NS} ns
 *  Singularity module: manage player actions, buy TOR/programs/RAM, join factions,
 *  auto-backdoor faction servers.
 *
 *  On 128+ GB home: runs as a persistent loop (5s interval).
 *  On smaller home: runs once and exits (main.js relaunches every 10s).
 */
export async function main(ns) {
  ns.disableLog("ALL");

  const homeRam   = ns.getServerMaxRam("home");
  const shouldLoop = homeRam >= 128;

  do {
    const money     = () => ns.getServerMoneyAvailable("home");
    const hackLevel = ns.getHackingLevel();

    // === WORK MANAGEMENT ===
    const currentWork = ns.singularity.getCurrentWork();

    if (hackLevel < 50) {
      // Early: study for hacking XP
      if (!currentWork || currentWork.type !== "CLASS") {
        const city = ns.getPlayer().city;
        if (city !== "Sector-12" && money() >= 200000) {
          ns.singularity.travelToCity("Sector-12");
        }
        if (ns.getPlayer().city === "Sector-12") {
          ns.singularity.universityCourse("Rothman University", "Algorithms", true);
          ns.tprint("INFO Studying Algorithms (hack lvl " + hackLevel + ")");
        }
      }
    } else {
      // Mid/late: prioritize faction work for rep → augmentations
      const bestFaction = bestFactionToWork(ns);
      if (bestFaction) {
        if (!currentWork || currentWork.type === "CLASS" ||
            (currentWork.type === "FACTION" && currentWork.factionName !== bestFaction)) {
          if (ns.singularity.workForFaction(bestFaction, "hacking", true)) {
            ns.tprint("INFO Working for " + bestFaction + " (hacking)");
          }
        }
      } else if (hackLevel < 100 && (!currentWork || currentWork.type !== "CLASS")) {
        // No faction yet — keep studying
        if (ns.getPlayer().city === "Sector-12") {
          ns.singularity.universityCourse("Rothman University", "Algorithms", true);
        }
      } else if (!currentWork) {
        tryCompanyWork(ns);
      }
    }

    // === PURCHASES ===

    // Priority 1: Home RAM (biggest impact — more RAM = more workers/modules)
    const ramCost = ns.singularity.getUpgradeHomeRamCost();
    if (ramCost !== Infinity && ramCost < money() * 0.5) {
      if (ns.singularity.upgradeHomeRam()) {
        ns.tprint("SUCCESS Upgraded home RAM to " + ns.getServerMaxRam("home") + " GB");
      }
    }

    // Priority 2: Home cores
    const coreCost = ns.singularity.getUpgradeHomeCoresCost();
    if (coreCost !== Infinity && coreCost < money() * 0.3) {
      if (ns.singularity.upgradeHomeCores()) {
        ns.tprint("SUCCESS Upgraded home cores");
      }
    }

    // Priority 3: TOR router
    if (!ns.hasTorRouter() && money() >= 200000) {
      if (ns.singularity.purchaseTor()) {
        ns.tprint("SUCCESS Purchased TOR router");
      }
    }

    // Priority 4: Programs (port openers first, then utility)
    const programs = [
      "BruteSSH.exe", "FTPCrack.exe", "relaySMTP.exe", "HTTPWorm.exe", "SQLInject.exe",
      "ServerProfiler.exe", "DeepscanV1.exe", "DeepscanV2.exe", "AutoLink.exe",
    ];
    for (const prog of programs) {
      if (!ns.fileExists(prog, "home")) {
        if (ns.singularity.purchaseProgram(prog)) {
          ns.tprint("SUCCESS Purchased " + prog);
        }
      }
    }

    // Priority 5: Join pending faction invitations
    const invites = ns.singularity.checkFactionInvitations();
    const wantedFactions = new Set([
      "CyberSec", "Tian Di Hui", "Netburners",
      "NiteSec", "The Black Hand", "BitRunners",
      "Sector-12", "Aevum", "Volhaven", "Chongqing", "New Tokyo", "Ishima",
      "Bachman & Associates", "ECorp", "MegaCorp", "Daedalus",
    ]);
    for (const faction of invites) {
      if (wantedFactions.has(faction)) {
        ns.singularity.joinFaction(faction);
        ns.tprint("SUCCESS Joined faction: " + faction);
      }
    }

    // Priority 6: Auto-backdoor faction servers
    await tryBackdoor(ns);

    if (shouldLoop) await ns.sleep(5000);
  } while (shouldLoop);
}

/** Pick the faction we should work for: most available augs we haven't bought yet,
 *  prioritising ones we're closest to affording. */
function bestFactionToWork(ns) {
  const hackFactions = [
    "BitRunners", "The Black Hand", "NiteSec", "CyberSec",
    "Tian Di Hui", "Netburners", "Daedalus",
    "ECorp", "MegaCorp", "Bachman & Associates",
    "Sector-12", "Aevum",
  ];
  const playerFactions = new Set(ns.getPlayer().factions);
  const ownedAugs      = new Set(ns.singularity.getOwnedAugmentations(true));
  const money          = ns.getServerMoneyAvailable("home");

  let bestFaction = null;
  let bestScore   = -1;

  for (const faction of hackFactions) {
    if (!playerFactions.has(faction)) continue;
    const augs = ns.singularity.getAugmentationsFromFaction(faction);
    const rep  = ns.singularity.getFactionRep(faction);

    let score = 0;
    for (const aug of augs) {
      if (ownedAugs.has(aug)) continue;
      const repReq  = ns.singularity.getAugmentationRepReq(aug);
      const augCost = ns.singularity.getAugmentationPrice(aug);
      // Weight by how close we are to both rep and money requirements
      const repProgress  = Math.min(1, rep / repReq);
      const costProgress = augCost <= money ? 1 : Math.min(1, money / augCost);
      score += repProgress + costProgress;
    }

    if (score > bestScore) { bestScore = score; bestFaction = faction; }
  }

  return bestFaction;
}

function tryCompanyWork(ns) {
  const companies = ["ECorp", "MegaCorp", "Blade Industries", "Four Sigma", "KuaiGong International",
                     "NWO", "OmniTek Incorporated", "Fulcrum Technologies"];
  for (const company of companies) {
    ns.singularity.applyToCompany(company, "Software");
    if (ns.singularity.workForCompany(company, true)) {
      ns.tprint("INFO Working at " + company);
      return true;
    }
  }
  return false;
}

/** BFS path from home to target */
function findPath(ns, target) {
  const visited = new Set(["home"]);
  const queue = [["home"]];
  while (queue.length) {
    const path = queue.shift();
    const cur  = path[path.length - 1];
    for (const neighbor of ns.scan(cur)) {
      if (neighbor === target) return [...path.slice(1), neighbor];
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push([...path, neighbor]);
      }
    }
  }
  return null;
}

/** Auto-backdoor faction servers when hack level is sufficient */
async function tryBackdoor(ns) {
  const targets = [
    { host: "CSEC",         hackReq: 58  },
    { host: "avmnite-02h",  hackReq: 202 },
    { host: "I.I.I.I",     hackReq: 340 },
    { host: "run4theh111z", hackReq: 505 },
  ];

  const hackLevel = ns.getHackingLevel();

  for (const t of targets) {
    if (hackLevel < t.hackReq) continue;
    if (!ns.hasRootAccess(t.host)) continue;
    if (ns.getServer(t.host).backdoorInstalled) continue;

    const path = findPath(ns, t.host);
    if (!path) continue;

    ns.tprint("INFO Auto-backdooring " + t.host + "...");
    for (const hop of path) ns.singularity.connect(hop);
    await ns.singularity.installBackdoor();
    ns.singularity.connect("home");
    ns.tprint("SUCCESS Backdoored " + t.host + "!");
  }
}

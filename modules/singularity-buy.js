/** @param {NS} ns
 *  Singularity module: manage player actions, buy TOR, programs, upgrade home.
 *  High RAM cost (~50 GB in BN1) — launched by main.js when affordable.
 *  Runs once and exits.
 */
export async function main(ns) {
  ns.disableLog("ALL");

  const money = () => ns.getServerMoneyAvailable("home");
  const hackLevel = ns.getHackingLevel();
  const currentWork = ns.singularity.getCurrentWork();

  // === PLAYER ACTION MANAGEMENT ===
  // Decide what the player should be doing right now

  if (hackLevel < 50) {
    // Early game: study at university for fast hacking XP
    if (!currentWork || currentWork.type !== "CLASS") {
      // Travel to Sector-12 for Rothman University (cheapest travel)
      const city = ns.getPlayer().city;
      if (city !== "Sector-12" && money() >= 200000) {
        ns.singularity.travelToCity("Sector-12");
        ns.tprint("INFO Traveled to Sector-12 for university");
      }
      if (ns.getPlayer().city === "Sector-12") {
        ns.singularity.universityCourse("Rothman University", "Algorithms", true);
        ns.tprint("INFO Studying Algorithms at Rothman University (hack lvl " + hackLevel + ")");
      }
    }
  } else if (hackLevel < 100) {
    // Mid-early: study if no faction work available, otherwise faction work
    const started = tryFactionWork(ns);
    if (!started && (!currentWork || currentWork.type !== "CLASS")) {
      if (ns.getPlayer().city === "Sector-12") {
        ns.singularity.universityCourse("Rothman University", "Algorithms", true);
        ns.tprint("INFO Studying Algorithms (no faction work yet)");
      }
    }
  } else {
    // Past level 100: prioritize faction work for reputation → augmentations
    if (!currentWork || currentWork.type === "CLASS") {
      const started = tryFactionWork(ns);
      if (!started) {
        // No faction to work for yet — try company work for money
        tryCompanyWork(ns);
      }
    }
  }

  // === PURCHASES ===

  // Priority 1: Upgrade home RAM (biggest impact)
  const ramCost = ns.singularity.getUpgradeHomeRamCost();
  if (ramCost < money() * 0.5) {
    if (ns.singularity.upgradeHomeRam()) {
      ns.tprint("SUCCESS Upgraded home RAM to " + ns.getServerMaxRam("home") + " GB");
    }
  }

  // Priority 2: Upgrade home cores
  const coreCost = ns.singularity.getUpgradeHomeCoresCost();
  if (coreCost < money() * 0.3) {
    if (ns.singularity.upgradeHomeCores()) {
      ns.tprint("SUCCESS Upgraded home cores");
    }
  }

  // Priority 3: Buy TOR router
  if (!ns.hasTorRouter()) {
    if (money() >= 200000) {
      if (ns.singularity.purchaseTor()) {
        ns.tprint("SUCCESS Purchased TOR router");
      }
    }
  }

  // Priority 4: Buy programs
  const programs = [
    "BruteSSH.exe", "FTPCrack.exe", "relaySMTP.exe",
    "HTTPWorm.exe", "SQLInject.exe",
    "ServerProfiler.exe", "DeepscanV1.exe", "DeepscanV2.exe", "AutoLink.exe",
  ];
  for (const prog of programs) {
    if (!ns.fileExists(prog, "home")) {
      if (ns.singularity.purchaseProgram(prog)) {
        ns.tprint("SUCCESS Purchased " + prog);
      }
    }
  }

  // Priority 5: Join factions
  const invitations = ns.singularity.checkFactionInvitations();
  const goodFactions = [
    "CyberSec", "Tian Di Hui", "Netburners",
    "NiteSec", "The Black Hand", "BitRunners",
    "Sector-12", "Aevum", "Volhaven", "Chongqing",
    "New Tokyo", "Ishima",
    "Bachman & Associates", "ECorp", "MegaCorp",
    "Daedalus",
  ];
  for (const faction of invitations) {
    if (goodFactions.includes(faction)) {
      ns.singularity.joinFaction(faction);
      ns.tprint("SUCCESS Joined faction: " + faction);
    }
  }
}

/** Try to work for the best hacking faction. Returns true if started. */
function tryFactionWork(ns) {
  const hackFactions = [
    "BitRunners", "The Black Hand", "NiteSec", "CyberSec",
    "Tian Di Hui", "Netburners", "Daedalus",
    "Sector-12", "Aevum",
  ];
  const playerFactions = ns.getPlayer().factions;
  for (const faction of hackFactions) {
    if (!playerFactions.includes(faction)) continue;
    if (ns.singularity.workForFaction(faction, "hacking", true)) {
      ns.tprint("INFO Working for " + faction + " (hacking)");
      return true;
    }
  }
  return false;
}

/** Try to get a company job and work it for money. */
function tryCompanyWork(ns) {
  // Apply to software jobs at good companies
  const companies = ["ECorp", "MegaCorp", "Blade Industries", "Four Sigma", "KuaiGong International"];
  for (const company of companies) {
    ns.singularity.applyToCompany(company, "Software");
    if (ns.singularity.workForCompany(company, true)) {
      ns.tprint("INFO Working at " + company);
      return true;
    }
  }
  return false;
}

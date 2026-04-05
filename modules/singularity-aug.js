/** @param {NS} ns
 *  Augmentation buyer — endgame module.
 *  Buys hacking augmentations from joined factions, installs when ready.
 *  Very high RAM cost (~85 GB in BN1). Only launched in Phase 4.
 */
export async function main(ns) {
  ns.disableLog("ALL");

  const money = () => ns.getServerMoneyAvailable("home");
  const player = ns.getPlayer();

  // Priority augmentations (hacking-focused)
  const priorityAugs = [
    "Neurotrainer I", "Neurotrainer II", "Neurotrainer III",
    "CashRoot Starter Kit",
    "Cranial Signal Processors - Gen I", "Cranial Signal Processors - Gen II",
    "Cranial Signal Processors - Gen III", "Cranial Signal Processors - Gen IV",
    "Cranial Signal Processors - Gen V",
    "Neural-Retention Enhancement",
    "Embedded Netburner Module",
    "Embedded Netburner Module Core Implant",
    "Embedded Netburner Module Core V2 Upgrade",
    "Embedded Netburner Module Core V3 Upgrade",
    "Embedded Netburner Module Analyze Engine",
    "Embedded Netburner Module Direct Memory Access Upgrade",
    "Artificial Bio-neural Network Implant",
    "Artificial Synaptic Potentiation",
    "Enhanced Myelin Sheathing",
    "BitWire",
    "Synaptic Enhancement Implant",
    "The Black Hand",
    "DataJack",
  ];

  // Always buy NeuroFlux Governor (stacks infinitely)
  const ownedAugs = ns.singularity.getOwnedAugmentations(true);
  let boughtSomething = false;

  // Buy priority augs from factions
  for (const faction of player.factions) {
    const available = ns.singularity.getAugmentationsFromFaction(faction);
    for (const aug of available) {
      if (ownedAugs.includes(aug)) continue;

      const cost = ns.singularity.getAugmentationPrice(aug);
      const repReq = ns.singularity.getAugmentationRepReq(aug);
      const factionRep = ns.singularity.getFactionRep(faction);

      if (factionRep < repReq) continue;
      if (cost > money() * 0.5) continue;

      // Buy priority augs or anything cheap
      if (priorityAugs.includes(aug) || cost < money() * 0.1) {
        if (ns.singularity.purchaseAugmentation(faction, aug)) {
          ns.tprint("SUCCESS Bought augmentation: " + aug + " from " + faction);
          boughtSomething = true;
        }
      }
    }
  }

  // Buy NeuroFlux Governor from any faction with enough rep
  for (const faction of player.factions) {
    const available = ns.singularity.getAugmentationsFromFaction(faction);
    if (!available.includes("NeuroFlux Governor")) continue;

    const cost = ns.singularity.getAugmentationPrice("NeuroFlux Governor");
    const repReq = ns.singularity.getAugmentationRepReq("NeuroFlux Governor");
    const factionRep = ns.singularity.getFactionRep(faction);

    if (factionRep >= repReq && cost < money() * 0.3) {
      if (ns.singularity.purchaseAugmentation(faction, "NeuroFlux Governor")) {
        ns.tprint("SUCCESS Bought NeuroFlux Governor from " + faction);
        boughtSomething = true;
      }
    }
    break; // only try one faction for NFG
  }

  // Check if we should install augmentations
  const pendingAugs = ns.singularity.getOwnedAugmentations(true).length -
                      ns.singularity.getOwnedAugmentations(false).length;

  if (pendingAugs >= 5 && !boughtSomething) {
    ns.tprint("WARN Installing " + pendingAugs + " augmentations in 30 seconds...");
    await ns.sleep(30000);
    ns.singularity.installAugmentations("main.js");
  }
}

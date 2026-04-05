/** @param {NS} ns
 *  Hacknet node management: buy nodes, upgrade level/RAM/cores.
 *  Kept minimal for low RAM. Runs once and exits.
 */
export async function main(ns) {
  const money = ns.getServerMoneyAvailable("home");
  const budget = money * 0.10;

  if (ns.hacknet.getPurchaseNodeCost() < budget) {
    ns.hacknet.purchaseNode();
  }

  const n = ns.hacknet.numNodes();
  for (let i = 0; i < n; i++) {
    if (ns.hacknet.getLevelUpgradeCost(i, 5) < budget) ns.hacknet.upgradeLevel(i, 5);
    if (ns.hacknet.getRamUpgradeCost(i, 1) < budget) ns.hacknet.upgradeRam(i, 1);
    if (ns.hacknet.getCoreUpgradeCost(i, 1) < budget) ns.hacknet.upgradeCore(i, 1);
  }
}

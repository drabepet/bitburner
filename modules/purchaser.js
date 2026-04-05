/** @param {NS} ns
 *  Buy and upgrade private servers.
 *  Runs once and exits. Re-launched by main.js each cycle.
 */
export async function main(ns) {
  ns.disableLog("ALL");

  const money = () => ns.getServerMoneyAvailable("home");
  const MAX_SERVERS = ns.getPurchasedServerLimit(); // usually 25
  const purchased = ns.getPurchasedServers();

  // Determine target RAM based on available money
  function getTargetRam() {
    const m = money();
    // Start small, scale up
    if (m < 500000) return 8;
    if (m < 2000000) return 16;
    if (m < 10000000) return 32;
    if (m < 50000000) return 64;
    if (m < 200000000) return 128;
    if (m < 1e9) return 256;
    if (m < 5e9) return 512;
    if (m < 20e9) return 1024;
    if (m < 100e9) return 4096;
    if (m < 500e9) return 16384;
    if (m < 2e12) return 65536;
    return 262144; // 256 TB
  }

  const targetRam = getTargetRam();

  // Buy new servers if we have room
  if (purchased.length < MAX_SERVERS) {
    const cost = ns.getPurchasedServerCost(targetRam);
    if (cost < money() * 0.1) { // spend at most 10% of money on a new server
      const name = ns.purchaseServer("pserv-" + purchased.length, targetRam);
      if (name) {
        ns.tprint("SUCCESS Purchased server " + name + " (" + targetRam + " GB)");
        // Copy workers to new server
        ns.scp(["scripts/hack.js", "scripts/grow.js", "scripts/weaken.js"], name, "home");
      }
    }
    return;
  }

  // All slots full — upgrade the smallest server
  let smallest = null;
  let smallestRam = Infinity;
  for (const server of purchased) {
    const ram = ns.getServerMaxRam(server);
    if (ram < smallestRam) {
      smallestRam = ram;
      smallest = server;
    }
  }

  if (smallest && smallestRam < targetRam) {
    const upgradeCost = ns.getPurchasedServerUpgradeCost(smallest, targetRam);
    if (upgradeCost < money() * 0.15) {
      if (ns.upgradePurchasedServer(smallest, targetRam)) {
        ns.tprint("SUCCESS Upgraded " + smallest + " to " + targetRam + " GB");
      }
    }
  }
}

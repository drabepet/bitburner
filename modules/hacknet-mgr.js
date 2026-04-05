/** @param {NS} ns
 *  Hacknet node management with ROI logic.
 *  Skips upgrades that take longer than 30 min to pay back.
 *  Uses ratio-based production estimates from actual game values.
 */
export async function main(ns) {
  const money = ns.getServerMoneyAvailable("home");
  const budget = money * 0.10;
  const MAX_PAYBACK_SECS = 30 * 60;

  function fmtTime(secs) {
    if (secs < 60) return Math.round(secs) + "s";
    return (secs / 60).toFixed(1) + "m";
  }

  // Buy new node — compare cost vs cheapest existing node's production
  const newNodeCost = ns.hacknet.getPurchaseNodeCost();
  const numNodes = ns.hacknet.numNodes();
  if (newNodeCost < budget && numNodes < 20) {
    // Estimate: new node at level 1 produces roughly $0.75/sec base
    // Use first node's production ratio if available
    let estProd = 0.75;
    if (numNodes > 0) {
      const s = ns.hacknet.getNodeStats(0);
      estProd = s.production / s.level; // production per level for reference
    }
    const payback = newNodeCost / estProd;
    if (payback < MAX_PAYBACK_SECS) {
      ns.hacknet.purchaseNode();
      ns.tprint("HACKNET: Bought node #" + numNodes + " ($" + ns.formatNumber(newNodeCost) + ", est payback " + fmtTime(payback) + ")");
    } else {
      ns.print("HACKNET: Skip new node — est payback " + fmtTime(payback) + " > 30m");
    }
  }

  // Upgrade existing nodes using ratio-based production estimates
  const n = ns.hacknet.numNodes();
  for (let i = 0; i < n; i++) {
    const s = ns.hacknet.getNodeStats(i);
    const curProd = s.production;
    if (curProd <= 0) continue;

    // Level +5: production scales linearly with level
    const lvlCost = ns.hacknet.getLevelUpgradeCost(i, 5);
    if (lvlCost < budget && lvlCost !== Infinity) {
      const newProd = curProd * ((s.level + 5) / s.level);
      const payback = lvlCost / (newProd - curProd);
      if (payback < MAX_PAYBACK_SECS) {
        ns.hacknet.upgradeLevel(i, 5);
        ns.print("HACKNET: Node " + i + " lvl+" + 5 + " ($" + ns.formatNumber(lvlCost) + ", payback " + fmtTime(payback) + ")");
      } else {
        ns.print("HACKNET: Skip node " + i + " lvl — payback " + fmtTime(payback));
      }
    }

    // RAM: production multiplier is pow(1.035, ram-1), doubling ram adds pow(1.035, ram) factor
    const ramCost = ns.hacknet.getRamUpgradeCost(i, 1);
    if (ramCost < budget && ramCost !== Infinity) {
      const ratio = Math.pow(1.035, s.ram) / Math.pow(1.035, s.ram - 1);
      const newProd = curProd * ratio;
      const payback = ramCost / (newProd - curProd);
      if (payback < MAX_PAYBACK_SECS) {
        ns.hacknet.upgradeRam(i, 1);
        ns.print("HACKNET: Node " + i + " RAM x2 ($" + ns.formatNumber(ramCost) + ", payback " + fmtTime(payback) + ")");
      } else {
        ns.print("HACKNET: Skip node " + i + " RAM — payback " + fmtTime(payback));
      }
    }

    // Cores: production multiplier is (cores+5)/6
    const coreCost = ns.hacknet.getCoreUpgradeCost(i, 1);
    if (coreCost < budget && coreCost !== Infinity) {
      const newProd = curProd * ((s.cores + 6) / (s.cores + 5));
      const payback = coreCost / (newProd - curProd);
      if (payback < MAX_PAYBACK_SECS) {
        ns.hacknet.upgradeCore(i, 1);
        ns.print("HACKNET: Node " + i + " core+1 ($" + ns.formatNumber(coreCost) + ", payback " + fmtTime(payback) + ")");
      } else {
        ns.print("HACKNET: Skip node " + i + " core — payback " + fmtTime(payback));
      }
    }
  }
}

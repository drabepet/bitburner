# Bitburner Automation Scripts

Fully automated Bitburner game progression — from fresh BN1 start to augmentation install. Just `run main.js` and watch it go.

## Scripts

### Core
| Script | RAM | Description |
|--------|-----|-------------|
| `main.js` | ~5 GB | Orchestrator — scans network, nukes servers, selects targets, deploys workers, launches modules |
| `backdoor.js` | ~35 GB | Backdoors faction servers (CSEC, avmnite-02h, etc.) — run manually, restarts main.js when done |

### Workers (deployed to all rooted servers)
| Script | RAM | Description |
|--------|-----|-------------|
| `scripts/hack.js` | 1.70 GB | Single hack operation |
| `scripts/grow.js` | 1.75 GB | Single grow operation |
| `scripts/weaken.js` | 1.75 GB | Single weaken operation |

### Modules (launched by main.js when enough RAM)
| Script | RAM needed | Description |
|--------|------------|-------------|
| `modules/hacknet-mgr.js` | ~6 GB free | Buys/upgrades hacknet nodes with 30-min ROI limit |
| `modules/purchaser.js` | ~8 GB free | Buys and upgrades private servers |
| `modules/singularity-buy.js` | ~55 GB free | Buys TOR, programs, upgrades home RAM, joins factions, manages work |
| `modules/singularity-aug.js` | ~90 GB free | Buys augmentations and installs them |

### Tools
| Script | Description |
|--------|-------------|
| `push.js` | Node.js WebSocket server — syncs scripts to game via Remote API. Also watches for local file changes. |
| `serve.js` | Node.js HTTP server — alternative sync via Bitburner's `wget` command |

## Quick Start

```bash
# Install dependencies
npm install

# Start sync server
node push.js
```

Then in Bitburner: **Options → Remote API → port 12525 → Connect** (turn off "Use wss").

```
run main.js
```

## How It Works

### Phases
1. **Bootstrap** (hack < 50, RAM < 32 GB) — hacks n00dles/foodnstuff on remote servers, shows guidance for manual actions
2. **Expansion** (hack 50+, RAM 32+ GB) — buys private servers, hacknet nodes, more programs
3. **Scaling** (hack 200+, RAM 128+ GB) — upgrades servers, joins factions, works for reputation
4. **Endgame** (hack 800+, $1B+, RAM 512+ GB) — buys augmentations, installs to reset

### Target Selection
Picks the best server to hack based on `maxMoney / (hackTime × minSecurity)`, filtered to servers where your hack level is at least 2× the requirement for good success rate.

### Worker Deployment
- Small servers (< 8 GB): hack only — simple and effective
- Larger servers: balanced 60% hack / 20% grow / 20% weaken
- Home server: reserved for modules until 64+ GB RAM

### Hacknet ROI
Only buys nodes/upgrades that pay for themselves within 30 minutes based on actual production rates.

### Guidance System
When home RAM is too low for Singularity automation, main.js prints ACTION tips telling you what to do manually (study at university, upgrade RAM, buy programs, etc.).

## Manual Steps (early game, < 64 GB home RAM)
1. Study "Algorithms" at Rothman University (Sector-12) for fast hacking XP
2. Buy hacknet nodes from the Hacknet sidebar
3. Upgrade home RAM at Alpha Enterprises
4. Run `kill main.js; run backdoor.js` to backdoor faction servers
5. Join factions and do hacking work for reputation

Once home RAM reaches 64+ GB, `singularity-buy.js` automates all of the above.

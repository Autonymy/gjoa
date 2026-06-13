#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { download } from "./download";
import { importSources } from "./import";
import { ENGINE_DIR } from "./paths";
import { log } from "./log";
import { check as securityCheck } from "../security/check";

const USAGE = `
gjoa prep — Firefox source preparation pipeline

Commands:
  download    Fetch + verify + extract mozilla-central into engine/
  import      Apply src/gjoa/ overlays, patches/, and branding to engine/
  clean       Remove engine/ (forces fresh download next time)
  help        Show this message

Cold start: \`bun run init\` (= download + import).
After editing src/gjoa/ or gjoa.json: \`bun run import\`.
`.trim();

/** Print a loud, structured security banner above any build phase. We
 *  deliberately make this hard to ignore — it's the highest-leverage
 *  intervention preventing "I'll update later" drift. The banner is
 *  fail-OPEN if the network probe can't run (e.g. offline) so it
 *  never blocks legitimate work; it does ALWAYS produce output. */
async function printSecurityBanner(): Promise<void> {
  let r: Awaited<ReturnType<typeof securityCheck>>;
  try {
    r = await securityCheck();
  } catch (e) {
    log.warn(`[security] check threw: ${(e as Error).message} — proceeding without status`);
    return;
  }
  if (r.status === "OK") {
    log.ok(`[security] ${r.summary}`);
    return;
  }
  const bar = "═".repeat(72);
  const header = r.status === "CRITICAL" ? "🛑 SECURITY: CRITICAL"
              : r.status === "STALE"    ? "⚠  SECURITY: STALE"
              : "?  SECURITY: UNKNOWN";
  console.error("");
  console.error(`\x1b[33m${bar}\x1b[0m`);
  console.error(`\x1b[1;33m${header}\x1b[0m  — ${r.summary}`);
  console.error(`\x1b[33m${bar}\x1b[0m`);
  console.error(r.detail);
  console.error(`\x1b[33m${bar}\x1b[0m`);
  if (r.status === "CRITICAL") {
    console.error(`\x1b[1;31mAction: bump and rebuild within 24 hours. Run:  bun run security:bump\x1b[0m`);
    console.error(`\x1b[33m${bar}\x1b[0m`);
  } else if (r.status === "STALE") {
    console.error(`Action: bump within the SLA in docs/security-policy.md. Run:  bun run security:bump`);
    console.error(`\x1b[33m${bar}\x1b[0m`);
  }
  console.error("");
}

async function main(): Promise<void> {
  const cmd = process.argv[2];
  switch (cmd) {
    case "download":
      await printSecurityBanner();
      await download();
      break;
    case "import":
      if (!existsSync(ENGINE_DIR)) {
        log.error("engine/ does not exist — run \`bun run download\` first");
        process.exit(1);
      }
      await printSecurityBanner();
      await importSources();
      break;
    case "clean":
      if (existsSync(ENGINE_DIR)) {
        log.step("removing engine/");
        await rm(ENGINE_DIR, { recursive: true });
        log.ok("engine/ removed");
      } else {
        log.info("engine/ already absent");
      }
      break;
    case "help":
    case "--help":
    case "-h":
      console.log(USAGE);
      break;
    default:
      console.error(USAGE);
      if (cmd) {
        log.error(`unknown command: ${cmd}`);
      }
      process.exit(cmd ? 1 : 0);
  }
}

main().catch((err) => {
  log.error(err.message ?? String(err));
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});

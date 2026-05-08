#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { download } from "./download";
import { importSources } from "./import";
import { ENGINE_DIR } from "./paths";
import { log } from "./log";

const USAGE = `
skiff prep — Firefox source preparation pipeline

Commands:
  download    Fetch + verify + extract mozilla-central into engine/
  import      Apply src/skiff/ overlays, patches/, and branding to engine/
  clean       Remove engine/ (forces fresh download next time)
  help        Show this message

Cold start: \`bun run init\` (= download + import).
After editing src/skiff/ or skiff.json: \`bun run import\`.
`.trim();

async function main(): Promise<void> {
  const cmd = process.argv[2];
  switch (cmd) {
    case "download":
      await download();
      break;
    case "import":
      if (!existsSync(ENGINE_DIR)) {
        log.error("engine/ does not exist — run \`bun run download\` first");
        process.exit(1);
      }
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

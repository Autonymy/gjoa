import { branding } from "./branding";
import { overlay } from "./overlay";
import { patches } from "./patches";
import { log } from "./log";

// Three sequential phases. Each is idempotent, so re-running `bun run import`
// after editing src/skiff/ or skiff.json picks up the changes correctly.
export async function importSources(): Promise<void> {
  log.step("phase 1/3 — overlaying src/skiff/");
  await overlay();

  log.step("phase 2/3 — applying patches/");
  await patches();

  log.step("phase 3/3 — generating branding");
  await branding();

  log.ok("import complete");
}

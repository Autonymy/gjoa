import { branding } from "./branding";
import { chromeBake } from "./chrome-bake";
import { locales } from "./locales";
import { mozconfig } from "./mozconfig";
import { overlay } from "./overlay";
import { patches } from "./patches";
import { log } from "./log";

// Six sequential phases. Each is idempotent, so re-running `bun run import`
// after editing src/gjoa/ or gjoa.json picks up the changes correctly.
export async function importSources(): Promise<void> {
  log.step("phase 1/6 — overlaying src/gjoa/");
  await overlay();

  log.step("phase 2/6 — applying patches/");
  await patches();

  log.step("phase 3/6 — baking chrome bundles into engine/");
  await chromeBake();

  log.step("phase 4/6 — generating branding");
  await branding();

  log.step("phase 5/6 — rewriting locale Firefox-isms");
  await locales();

  log.step("phase 6/6 — generating engine/mozconfig");
  await mozconfig();

  log.ok("import complete");
}

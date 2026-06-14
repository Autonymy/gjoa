// Phase-0 adblock smoke — proves the in-tree Brave adblock-rust content
// classifier (ContentClassifierService) actually blocks a listed 3rd-party
// request on a real gjoa binary. Depends only on the engine compiled into
// libxul + the content.protection prefs (no gjoa chrome), so it is valid on any
// FF151-based gjoa build (incl. the compile-optimized build #1).
//
// The service reads `content.protection.enabled` at STARTUP (constructor +
// Init), so we set the prefs, flush, RESTART, then verify blocking — which is
// also the production model (ship the pref default-on).
//
//   GJOA_BIN=$PWD/result-release/bin/gjoa bun tools/test-driver/runner.ts --grep adblock --verbose
import type { IntegrationTest } from "../../tools/test-driver/runner.ts";

const BLOCK_LIST = "||example.org^\n"; // uBO/EasyList net rule; block example.org
const TOP = "https://example.com/";
const BLOCKED_3P = "https://example.org/favicon.ico";
const ALLOWED_3P = "https://example.net/favicon.ico";

const tests: IntegrationTest[] = [
  {
    name: "adblock: content.protection engine blocks a listed 3rd-party request",
    async run(mn, ctx) {
      let client = mn;
      await client.setContext("chrome");

      // 1) Write the block list into the profile, set the prefs, flush to disk.
      const listPath = await client.executeAsyncScript<string>(`
        const [resolve] = arguments;
        (async () => {
          const dir = Services.dirsvc.get("ProfD", Ci.nsIFile).path;
          const p = PathUtils.join(dir, "gjoa-smoke-blocklist.txt");
          await IOUtils.writeUTF8(p, ${JSON.stringify(BLOCK_LIST)});
          resolve(p);
        })().catch(e => resolve("ERR:" + e));
      `);
      if (listPath.startsWith("ERR:")) throw new Error("write list failed: " + listPath);
      const fileUrl = "file://" + listPath;

      await client.executeScript(`
        const [listUrl] = arguments;
        Services.prefs.setBoolPref("privacy.trackingprotection.content.testing", true);
        Services.prefs.setBoolPref("privacy.trackingprotection.content.annotation.enabled", false);
        Services.prefs.setCharPref("privacy.trackingprotection.content.protection.test_list_urls", listUrl);
        Services.prefs.setBoolPref("privacy.trackingprotection.content.protection.enabled", true);
        Services.prefs.savePrefFile(null);
      `, [fileUrl]);

      // 2) Restart: the service now inits at startup with the prefs true and
      //    loads the list. (restartGjoa reuses the same profile.)
      client = await ctx.restartGjoa();
      await client.setContext("chrome");
      // give the engine a beat to finish loading the list at startup
      await client.executeAsyncScript(`const [r] = arguments; setTimeout(() => r(true), 2000);`);

      // 3) Open a 1st-party tab and wait for it to finish loading.
      const navOk = await client.executeAsyncScript<boolean>(`
        const [url, resolve] = arguments;
        let done = false;
        const finish = (v) => { if (!done) { done = true; resolve(v); } };
        const win = Services.wm.getMostRecentWindow("navigator:browser");
        // Load into the SELECTED browser so Marionette's content context (which
        // targets the focused top-level browsing context) lands on this page.
        const b = win.gBrowser.selectedBrowser;
        b.loadURI(Services.io.newURI(url), { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
        const listener = {
          QueryInterface: ChromeUtils.generateQI(["nsIWebProgressListener", "nsISupportsWeakReference"]),
          onStateChange(wp, req, flags) {
            const S = Ci.nsIWebProgressListener;
            if ((flags & S.STATE_STOP) && (flags & S.STATE_IS_WINDOW)) {
              try { b.removeProgressListener(listener); } catch {}
              finish(true);
            }
          },
        };
        b.addProgressListener(listener, Ci.nsIWebProgress.NOTIFY_STATE_ALL);
        setTimeout(() => finish(false), 25000);
      `, [TOP]);
      if (!navOk) throw new Error("top page " + TOP + " did not load (network?)");

      // 4) In content: 3rd-party fetch to the BLOCKED host (should reject) and a
      //    control to the ALLOWED host (opaque resolve).
      await client.setContext("content");
      const probe = (url: string) => client.executeAsyncScript<string>(`
        const [u, resolve] = arguments;
        const t = setTimeout(() => resolve("timeout"), 15000);
        fetch(u, { mode: "no-cors", cache: "no-store" })
          .then(() => { clearTimeout(t); resolve("loaded"); })
          .catch(() => { clearTimeout(t); resolve("blocked"); });
      `, [url]);
      const blocked = await probe(BLOCKED_3P);
      const allowed = await probe(ALLOWED_3P);

      if (blocked !== "blocked") {
        throw new Error(`expected ${BLOCKED_3P} BLOCKED, got "${blocked}" — engine present but not blocking`);
      }
      if (allowed === "blocked") {
        throw new Error(`control ${ALLOWED_3P} was blocked too ("${allowed}") — over-blocking`);
      }
    },
  },
];

export default tests;

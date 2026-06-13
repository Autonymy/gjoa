// SQLite probe — confirms what FTS extensions and version the bundled
// SQLite ships with. Pure diagnostic, doesn't assert anything; the
// chrome-script result is dumped to test:log so you can read it in
// the runner output.

import type { IntegrationTest } from "../../tools/test-driver/runner.ts";

const tests: IntegrationTest[] = [
  {
    name: "sqlite: report version + FTS3/FTS5 availability",
    async run(mn) {
      const probe = await mn.executeAsyncScript<{
        version: string;
        fts3: string;
        fts5: string;
      }>(`
        const cb = arguments[arguments.length - 1];
        (async () => {
          const { Sqlite } = ChromeUtils.importESModule("resource://gre/modules/Sqlite.sys.mjs");
          const conn = await Sqlite.openConnection({ path: ":memory:" });
          let version = "?";
          try {
            const rows = await conn.execute("SELECT sqlite_version() AS v");
            version = rows[0]?.getResultByName("v") ?? "?";
          } catch (e) {
            version = "error: " + e.message;
          }
          let fts3 = "?";
          try {
            await conn.execute("CREATE VIRTUAL TABLE t3 USING fts3(x)");
            fts3 = "ok";
          } catch (e) {
            fts3 = e.message;
          }
          let fts5 = "?";
          try {
            await conn.execute("CREATE VIRTUAL TABLE t5 USING fts5(x)");
            fts5 = "ok";
          } catch (e) {
            fts5 = e.message;
          }
          try { await conn.close(); } catch {}
          cb({ version, fts3, fts5 });
        })().catch(e => cb({ version: "?", fts3: "?", fts5: "ERROR: " + (e.message || e) }));
      `);
      console.error("[sqlite probe]", JSON.stringify(probe, null, 2));
    },
  },
];

export default tests;

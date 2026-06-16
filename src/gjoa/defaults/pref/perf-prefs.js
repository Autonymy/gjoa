// gjoa performance prefs — power-user defaults (32 GB+ RAM)
// Shipped as DEFAULTS by appending this file onto the branding pref file
// (engine/browser/branding/gjoa/pref/firefox-branding.js) in tools/prep/branding.ts
// at import time — that is the only pref channel packaged into omni.ja without a
// Mozilla-source patch. The copy that overlays to engine/defaults/pref/ is NOT
// packaged (no moz.build references it) and has no effect.

// --- GC tuning (large nursery, parallel marking) ---
pref("javascript.options.mem.nursery.min_kb", 4096);
pref("javascript.options.mem.nursery.max_kb", 131072);
pref("javascript.options.mem.gc_allocation_threshold_mb", 64);
pref("javascript.options.mem.gc_malloc_threshold_base_mb", 76);
pref("javascript.options.mem.gc_max_parallel_marking_threads", 4);
pref("javascript.options.mem.gc_incremental_gc", true);
pref("javascript.options.mem.gc_compacting_enabled", true);

// --- Process model ---
pref("dom.ipc.processCount", 4);
pref("dom.ipc.processCount.webIsolated", 2);
pref("dom.ipc.processCount.file", 1);

// --- Subsystem stripping (runtime) ---
pref("toolkit.telemetry.enabled", false);
pref("toolkit.telemetry.unified", false);
pref("toolkit.telemetry.archive.enabled", false);
pref("datareporting.healthreport.uploadEnabled", false);
pref("datareporting.policy.dataSubmissionEnabled", false);
pref("browser.newtabpage.activity-stream.enabled", false);
pref("browser.newtabpage.activity-stream.feeds.telemetry", false);
pref("browser.newtabpage.activity-stream.feeds.snippets", false);
pref("browser.newtabpage.activity-stream.feeds.section.topstories", false);
pref("browser.newtabpage.activity-stream.feeds.discoverystreamfeed", false);
pref("extensions.pocket.enabled", false);
pref("identity.fxaccounts.enabled", false);
pref("browser.discovery.enabled", false);
pref("app.normandy.enabled", false);
pref("app.shield.optoutstudies.enabled", false);
pref("browser.safebrowsing.downloads.remote.enabled", false);

// --- Networking: SPEED-positive ---
// Firefox ships prefetch / DNS-prefetch / speculative-connect ON. They were
// being DISABLED here (lumped in with telemetry as if a privacy nicety), which
// directly HURTS page-load — the opposite of gjoa's speed thesis. Restored to
// Firefox defaults. Minor privacy cost (leaks likely-next hosts); speed wins.
pref("network.prefetch-next", true);
pref("network.dns.disablePrefetch", false);
pref("network.http.speculative-parallel-limit", 6);

// --- Rendering performance ---
pref("gfx.webrender.all", true);
pref("gfx.webrender.compositor", true);
pref("layers.gpu-process.enabled", true);
pref("media.hardware-video-decoding.force-enabled", true);

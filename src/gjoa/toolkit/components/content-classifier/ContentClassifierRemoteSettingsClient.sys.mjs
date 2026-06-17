/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// gjoa OVERLAY of Mozilla's ContentClassifierRemoteSettingsClient.
//
// The in-tree adblock-rust content classifier (nsIContentClassifierService) is
// C++ and has NO contract id — the ONLY way JS gets the service handle is to BE
// the "RemoteSettings client" the C++ service constructs and calls init(service)
// on (ContentClassifierService::InitRSClient). Mozilla's stock client pulls from
// a RemoteSettings collection that doesn't exist (ships no dump), so the stock
// production path loads ZERO lists. We keep the exact class shell + registration
// (classID / QueryInterface / init/shutdown so components.conf + the C++ caller
// resolve) and replace the *sourcing*: load EasyList + EasyPrivacy from a profile
// cache (fetched on first run, refreshed when stale), push them via
// service.setFilterListData + applyFilterLists, and synthesize a per-site
// allow-list from a gjoa pref. No RemoteSettings server, no Mozilla collection.
//
// This is a Lane-2 overlay (lands in omni.ja via `bun run import` + mach build).
// On a Firefox version bump this file may need re-syncing if Mozilla changes the
// client/service contract.

const lazy = {};

ChromeUtils.defineLazyGetter(lazy, "log", () => {
  return console.createInstance({
    maxLogLevelPref:
      "privacy.trackingprotection.content.remote_settings.loglevel",
    prefix: "gjoa-adblock",
  });
});

// The lists gjoa ships blocking with. Each `name` MUST be a token in the
// privacy.trackingprotection.content.protection.list_names default pref.
const LISTS = [
  { name: "easylist", url: "https://easylist.to/easylist/easylist.txt" },
  { name: "easyprivacy", url: "https://easylist.to/easylist/easyprivacy.txt" },
];

const CACHE_DIR = "gjoa-adblock";
const ALLOW_PREF = "gjoa.contentblock.user.allow-hosts";
const ALLOW_LIST_NAME = "gjoa-allow";
// Refresh a cached list when older than this (EasyList itself expires in 4 days).
const STALE_MS = 4 * 24 * 60 * 60 * 1000;

/**
 * gjoa's drop-in replacement for the content-classifier RemoteSettings client.
 * Registered under @mozilla.org/content-classifier-rs-client;1 (components.conf,
 * unchanged) so the C++ service constructs us and calls init(service).
 */
export class ContentClassifierRemoteSettingsClient {
  classID = Components.ID("{C7DDDBF2-8BC4-41A1-AC90-5144BEC5ABDF}");
  QueryInterface = ChromeUtils.generateQI([
    "nsIContentClassifierRemoteSettingsClient",
  ]);

  #service = null;
  #initialized = false;
  #allowObserver = null;

  constructor() {}

  /**
   * Called by the C++ ContentClassifierService with itself as `service`.
   * Loads lists from cache (cache-first so blocking is live within ms), builds
   * the per-site allow-list, applies, then kicks a background staleness refresh.
   */
  async init(service) {
    if (!service) {
      throw new Error("Missing required argument service");
    }
    if (this.#initialized) {
      return;
    }
    this.#initialized = true;
    this.#service = service;

    try {
      await this.#loadAllLists(service);
    } catch (e) {
      lazy.log.error("init: list load failed", e);
    } finally {
      // Always apply so the engine builds from whatever loaded (and so any
      // caller waiting on the engine doesn't hang).
      service.applyFilterLists();
    }

    // Rebuild the synthetic allow-list whenever the user's allow-hosts change.
    this.#allowObserver = {
      observe: () => {
        try {
          this.#rebuildAllowList(service);
          service.applyFilterLists();
        } catch (e) {
          lazy.log.error("allow-list rebuild failed", e);
        }
      },
    };
    Services.prefs.addObserver(ALLOW_PREF, this.#allowObserver);

    // Background: refresh any stale cached list without blocking startup.
    this.#refreshStale(service).catch(e =>
      lazy.log.error("background refresh failed", e)
    );
  }

  shutdown() {
    if (this.#allowObserver) {
      Services.prefs.removeObserver(ALLOW_PREF, this.#allowObserver);
      this.#allowObserver = null;
    }
    this.#service = null;
    this.#initialized = false;
  }

  #cacheDir() {
    const prof = Services.dirsvc.get("ProfD", Ci.nsIFile).path;
    return PathUtils.join(prof, CACHE_DIR);
  }

  async #loadAllLists(service) {
    const dir = this.#cacheDir();
    await IOUtils.makeDirectory(dir, { ignoreExisting: true });

    for (const { name, url } of LISTS) {
      const path = PathUtils.join(dir, `${name}.txt`);
      let bytes = null;
      try {
        if (await IOUtils.exists(path)) {
          bytes = await IOUtils.read(path);
        } else {
          // First run, no cache: fetch now so blocking works on first launch.
          bytes = await this.#fetchAndCache(url, path);
        }
      } catch (e) {
        lazy.log.error(`load "${name}" failed`, e);
      }
      if (bytes && bytes.length) {
        service.setFilterListData(name, bytes);
        lazy.log.info(`loaded "${name}" (${bytes.length} bytes)`);
      } else {
        lazy.log.warn(`"${name}" empty/unavailable — not blocking from it`);
      }
    }

    this.#rebuildAllowList(service);
  }

  // Build the gjoa-allow list (uBO @@ exceptions) from the user's allow-hosts
  // pref and push it under ALLOW_LIST_NAME (a token in list_names).
  #rebuildAllowList(service) {
    const csv = Services.prefs.getStringPref(ALLOW_PREF, "");
    const hosts = csv
      .split(",")
      .map(h => h.trim())
      .filter(Boolean);
    const text = hosts.map(h => `@@||${h}^$document`).join("\n") + "\n";
    service.setFilterListData(
      ALLOW_LIST_NAME,
      new TextEncoder().encode(text)
    );
    if (hosts.length) {
      lazy.log.info(`allow-list: ${hosts.length} host(s) exempted`);
    }
  }

  async #fetchAndCache(url, path) {
    const resp = await fetch(url, { cache: "no-store" });
    if (!resp.ok) {
      throw new Error(`fetch ${url} -> HTTP ${resp.status}`);
    }
    const buf = new Uint8Array(await resp.arrayBuffer());
    await IOUtils.write(path, buf);
    lazy.log.info(`fetched + cached ${url} (${buf.length} bytes)`);
    return buf;
  }

  async #refreshStale(service) {
    const dir = this.#cacheDir();
    let changed = false;
    for (const { name, url } of LISTS) {
      const path = PathUtils.join(dir, `${name}.txt`);
      try {
        let stale = true;
        if (await IOUtils.exists(path)) {
          const info = await IOUtils.stat(path);
          stale = Date.now() - info.lastModified > STALE_MS;
        }
        if (stale) {
          const bytes = await this.#fetchAndCache(url, path);
          if (bytes && bytes.length) {
            service.setFilterListData(name, bytes);
            changed = true;
          }
        }
      } catch (e) {
        lazy.log.warn(`refresh "${name}" failed (keeping cache)`, e);
      }
    }
    if (changed) {
      service.applyFilterLists();
      lazy.log.info("refreshed stale list(s) + reapplied");
    }
  }
}

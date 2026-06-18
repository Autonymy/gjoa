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
  // uBlock Origin's own filter set — carries the `+js(...)` scriptlet rules
  // (YouTube player-prune, anti-adblock defusers, etc.) that EasyList does not.
  // These need the scriptlet resource library (scriptlet-resources.json) loaded
  // via setScriptletResources to actually expand + inject.
  {
    name: "ublock-filters",
    url: "https://ublockorigin.github.io/uAssets/filters/filters.txt",
  },
  {
    name: "ublock-badware",
    url: "https://ublockorigin.github.io/uAssets/filters/badware.txt",
  },
  {
    name: "ublock-privacy",
    url: "https://ublockorigin.github.io/uAssets/filters/privacy.txt",
  },
  {
    name: "ublock-quick-fixes",
    url: "https://ublockorigin.github.io/uAssets/filters/quick-fixes.txt",
  },
  {
    name: "ublock-unbreak",
    url: "https://ublockorigin.github.io/uAssets/filters/unbreak.txt",
  },
  {
    name: "ublock-resource-abuse",
    url: "https://ublockorigin.github.io/uAssets/filters/resource-abuse.txt",
  },
];

// Packaged uBO-derived scriptlet/redirect resource library (see moz.build).
const SCRIPTLET_RESOURCES_URL =
  "resource://gre/modules/scriptlet-resources.json";

const CACHE_DIR = "gjoa-adblock";
const ALLOW_PREF = "gjoa.contentblock.user.allow-hosts";
const ALLOW_LIST_NAME = "gjoa-allow";
// Refresh a cached list when older than this (EasyList itself expires in 4 days).
const STALE_MS = 4 * 24 * 60 * 60 * 1000;

// F1 list-integrity hardening ----------------------------------------------
// These lists are fetched off the network and fed verbatim to the in-process
// adblock-rust engine. The pipeline below adds integrity controls so a
// network/MITM attacker or a tampered profile-cache file cannot smuggle
// arbitrary bytes into the engine:
//   - transport: every list URL must be https:// (rejected otherwise);
//   - size cap: refuse responses larger than MAX_LIST_BYTES before writing;
//   - shape check: the body must look like a UTF-8 text filter list, not
//     HTML/binary (a captive-portal/error page or a swapped binary blob);
//   - at-rest integrity: a SHA-256 of each fetched list is persisted in a
//     sidecar file; on cache read-back the digest is recomputed and must match
//     before the bytes reach setFilterListData — a mismatch means the cache was
//     tampered with (or partially written), so it is treated as untrusted and
//     re-fetched/skipped, never fed to the engine.
//
// RESIDUAL (documented, separate follow-up): these controls bound *transport*
// and *at-rest* tampering only. A compromised list ORIGIN (or an attacker who
// controls the upstream repo) can still serve a malicious-but-well-formed
// filter list. That risk is bounded today by the permission-mask gate
// (ParseOptions PermissionMask stays 0, so scriptlet/redirect permissions are
// not granted from these untrusted lists) and is to be closed separately by
// bundling reviewed list snapshots and pinning/known-good digests.
//
// 32 MiB: comfortably above the largest real list (EasyList+uBO are a few MiB)
// while bounding memory + the digest cost on a hostile response.
const MAX_LIST_BYTES = 32 * 1024 * 1024;
// Sidecar file holding the hex SHA-256 of the cached `<name>.txt`.
const DIGEST_SUFFIX = ".sha256";

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
      // Scriptlet resources first: must be set BEFORE applyFilterLists so the
      // engines pick them up at build time and can expand `+js(...)` rules.
      await this.#loadScriptletResources(service);
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

  #digestPath(path) {
    return path + DIGEST_SUFFIX;
  }

  // SHA-256 of raw bytes as lowercase hex. `crypto.subtle` is not reliably
  // available in a privileged .sys.mjs, so use nsICryptoHash directly.
  #sha256Hex(bytes) {
    const hasher = Cc["@mozilla.org/security/hash;1"].createInstance(
      Ci.nsICryptoHash
    );
    hasher.init(Ci.nsICryptoHash.SHA256);
    hasher.update(bytes, bytes.length);
    const digest = hasher.finish(false);
    let hex = "";
    for (let i = 0; i < digest.length; i++) {
      hex += digest.charCodeAt(i).toString(16).padStart(2, "0");
    }
    return hex;
  }

  // A genuine text filter list is valid UTF-8 and is overwhelmingly ASCII
  // comments/rules. Reject anything that smells like an HTML error page, a
  // captive-portal interstitial, or a binary blob swapped in over the wire.
  #looksLikeFilterList(bytes) {
    if (!bytes || !bytes.length) {
      return false;
    }
    let text;
    try {
      // fatal:true rejects invalid UTF-8 (i.e. binary).
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch (e) {
      return false;
    }
    // NUL bytes never appear in a real filter list.
    if (text.includes("\0")) {
      return false;
    }
    const head = text.slice(0, 4096).toLowerCase().trimStart();
    if (head.startsWith("<!doctype") || head.startsWith("<html")) {
      return false;
    }
    return true;
  }

  // Hand the engine the scriptlet/redirect resource library so `+js(...)` rules
  // in the uBO lists expand into injectable scriptlets. Packaged static
  // (version-pinned to the vendored adblock-rust + the uBO scriptlet harvest);
  // read once at init.
  async #loadScriptletResources(service) {
    try {
      const resp = await fetch(SCRIPTLET_RESOURCES_URL);
      const json = await resp.text();
      if (json && json.length) {
        service.setScriptletResources(json);
        lazy.log.info(`scriptlet resources loaded (${json.length} bytes)`);
      }
    } catch (e) {
      lazy.log.error("scriptlet resources load failed", e);
    }
  }

  // Read a cached list back and verify it against its persisted SHA-256 sidecar
  // before trusting it. Returns the bytes only if the digest matches; null if
  // the cache is missing, has no/garbled sidecar, or fails verification (i.e.
  // was tampered with or partially written) — in which case the caller must
  // re-fetch rather than feed unverified data to the engine.
  async #readVerified(path) {
    const digestPath = this.#digestPath(path);
    if (!(await IOUtils.exists(path)) || !(await IOUtils.exists(digestPath))) {
      return null;
    }
    const bytes = await IOUtils.read(path);
    const expected = (await IOUtils.readUTF8(digestPath)).trim();
    const actual = this.#sha256Hex(bytes);
    if (!expected || actual !== expected) {
      lazy.log.warn(
        `cache integrity check failed for ${path} — discarding (untrusted)`
      );
      return null;
    }
    return bytes;
  }

  async #loadAllLists(service) {
    const dir = this.#cacheDir();
    await IOUtils.makeDirectory(dir, { ignoreExisting: true });

    for (const { name, url } of LISTS) {
      const path = PathUtils.join(dir, `${name}.txt`);
      let bytes = null;
      try {
        // Cache read-back is verified against the persisted digest; an
        // unverifiable cache is treated as absent and re-fetched, never fed
        // to the engine.
        bytes = await this.#readVerified(path);
        if (!bytes) {
          // No (trustworthy) cache: fetch now so blocking works on first launch
          // and so a tampered cache is replaced with a known-good copy.
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
    // (1) transport: refuse to fetch a list over anything but https.
    if (!/^https:\/\//i.test(url)) {
      throw new Error(`refusing non-https list URL ${url}`);
    }
    const resp = await fetch(url, { cache: "no-store" });
    if (!resp.ok) {
      throw new Error(`fetch ${url} -> HTTP ${resp.status}`);
    }
    const buf = new Uint8Array(await resp.arrayBuffer());
    // (2) size cap: bound a hostile/oversized response before it hits disk.
    if (buf.length > MAX_LIST_BYTES) {
      throw new Error(
        `list ${url} too large (${buf.length} > ${MAX_LIST_BYTES} bytes)`
      );
    }
    // (3) shape check: must look like a text filter list, not HTML/binary.
    if (!this.#looksLikeFilterList(buf)) {
      throw new Error(`list ${url} did not look like a text filter list`);
    }
    // (4) at-rest integrity: persist a digest alongside the cached bytes so the
    // read-back path can detect tampering/partial writes before trusting it.
    const digest = this.#sha256Hex(buf);
    await IOUtils.write(path, buf);
    await IOUtils.writeUTF8(this.#digestPath(path), digest);
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

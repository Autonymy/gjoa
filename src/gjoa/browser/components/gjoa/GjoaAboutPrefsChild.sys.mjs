/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Child half of the about:preferences POINTER. gjoa OWNS its settings at about:gjoa
// and does NOT patch Firefox's preferences code (Zen patches three core files and
// recalculates every release; this only OBSERVES the page and appends a node). The
// pointer guides a user who lands in Firefox Settings looking for a gjoa feature.
//
// Graceful by construction: the top banner is appended to a container that always
// exists (#mainPrefPane, else <body>); the category-nav entry is best-effort (its
// markup is FF-version-specific) and a miss is harmless — about:gjoa is always
// reachable by URL, and Firefox Settings still works untouched.
export class GjoaAboutPrefsChild extends JSWindowActorChild {
  handleEvent(event) {
    if (event.type !== "DOMContentLoaded") {
      return;
    }
    try {
      this.#inject(this.document);
    } catch (e) {
      // Never break Firefox Settings over a cosmetic pointer.
    }
  }

  #open() {
    this.sendAsyncMessage("GjoaPrefs:OpenSettings", {});
  }

  #inject(doc) {
    if (!doc || doc.getElementById("gjoa-prefs-pointer")) {
      return;
    }

    // (1) Top banner — robust fallback, always shown.
    const main = doc.getElementById("mainPrefPane") || doc.body;
    if (main) {
      const banner = doc.createElement("div");
      banner.id = "gjoa-prefs-pointer";
      banner.style.cssText =
        "margin:14px 0;padding:12px 16px;border:1px solid #7aa2f7;" +
        "border-radius:10px;display:flex;gap:12px;align-items:center;" +
        "font:14px system-ui,sans-serif;";
      const txt = doc.createElement("span");
      txt.textContent = "gjoa-specific settings live in gjoa Settings.";
      txt.style.flex = "1";
      const btn = doc.createElement("button");
      btn.textContent = "Open gjoa Settings";
      btn.addEventListener("click", () => this.#open());
      banner.append(txt, btn);
      main.prepend(banner);
    }

    // (2) Category-nav entry — best-effort; structure is FF-version-specific.
    const nav = doc.querySelector("moz-page-nav") || doc.getElementById("categories");
    if (nav) {
      const entry = doc.createElement("button");
      entry.id = "category-gjoa-link";
      entry.className = "category";
      entry.textContent = "gjoa Settings";
      entry.addEventListener("click", () => this.#open());
      nav.append(entry);
    }
  }
}

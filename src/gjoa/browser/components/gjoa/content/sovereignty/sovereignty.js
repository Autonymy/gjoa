"use strict";

// about:sovereignty — render the verifiable egress truth, not a slogan.
//
// Hard rules (the trust panel a skeptic believes, not just the one a believer
// likes):
//   1. The build-hash proof line is the centerpiece: it ties the audit to the
//      EXACT bytes you're running. If the audit was generated against a different
//      commit than the running build, say so — never imply a match we can't show.
//   2. The badge degrades honestly. It reflects the real current egress state,
//      including the maximal-lockdown toggle. Flipping lockdown changes the panel.
//      It never renders a static ✓ "SOVEREIGN" while probes are live.
//   3. Claim (A) verbatim: "1 unattended network call: the Firefox version check."
//      The most conservative true statement — never rounded up to "zero egress".

(function () {
  const $ = (id) => document.getElementById(id);

  // Privileged chrome page: Services is a system-principal global. Guard anyway so
  // the page degrades to a readable static state instead of a blank document.
  let Services = null;
  try {
    Services = globalThis.Services;
  } catch (_) {}

  function getBoolPref(name, dflt) {
    try {
      return Services.prefs.getBoolPref(name, dflt);
    } catch (_) {
      return dflt;
    }
  }
  function getCharPref(name, dflt) {
    try {
      return Services.prefs.getCharPref(name, dflt);
    } catch (_) {
      return dflt;
    }
  }

  const LOCKDOWN_PREF = "gjoa.sovereignty.maximalLockdown";

  function buildIdentity() {
    let ffVersion = "?";
    try {
      ffVersion = Services.appinfo.version;
    } catch (_) {}
    return {
      ffVersion,
      commit: getCharPref("gjoa.build.commit", "unknown"),
      patchHash: getCharPref("gjoa.build.engine-patch-hash", ""),
      provenance: getCharPref("gjoa.build.provenance", "unknown"),
      date: getCharPref("gjoa.build.date", ""),
    };
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text; // textContent only — never innerHTML.
    return e;
  }

  function renderLedger(manifest) {
    const root = $("ledger");
    root.textContent = "";

    const group = (title, items, render) => {
      if (!items || !items.length) return;
      root.appendChild(el("h3", "ledger-h", title));
      const ul = el("ul", "ledger-list");
      for (const it of items) ul.appendChild(render(it));
      root.appendChild(ul);
    };

    const row = (primary, secondary, tag) => {
      const li = el("li", "ledger-item");
      li.appendChild(el("span", "ledger-endpoint", primary));
      if (secondary) li.appendChild(el("span", "ledger-what", secondary));
      if (tag) li.appendChild(el("span", "ledger-basis", tag));
      return li;
    };

    const own = manifest.ownCode || {};
    group(
      "Unattended external call",
      own.unattendedExternal,
      (it) => row(it.endpoint, it.what, it.basis)
    );
    group(
      "Network only when you enable the feature",
      own.userEnabledNetwork,
      (it) => row(it.endpoint, it.what, it.basis)
    );
    group(
      "Local — never leaves the machine",
      own.local,
      (it) => row(it.endpoint, it.what, it.basis)
    );
    group(
      "Unproven — flagged for review (honest)",
      own.unproven,
      (it) => row(it.endpoint, it.what, it.basis)
    );

    const inh = manifest.inheritedEgress;
    if (inh) {
      root.appendChild(
        el(
          "h3",
          "ledger-h",
          `Firefox built-in egress: ${inh.disabled}/${inh.catalogued} disabled by default`
        )
      );
      root.appendChild(el("p", "ledger-note", inh.note || ""));
      const ul = el("ul", "ledger-list");
      for (const it of inh.toggleGated || []) {
        ul.appendChild(
          row(it.pref, it.what, "gated by maximal-lockdown toggle")
        );
      }
      root.appendChild(ul);
    }
  }

  function render(manifest) {
    const id = buildIdentity();
    const lockdown = getBoolPref(LOCKDOWN_PREF, false);
    const unattended = (manifest.ownCode &&
      manifest.ownCode.unattendedExternal &&
      manifest.ownCode.unattendedExternal.length) || 0;

    // Headline count = authored unattended external calls (claim A). Honest, fixed
    // to what the audit proves — the toggle does not pretend to change this number.
    $("unattended-count").textContent = String(unattended);
    $("count-lead").textContent =
      unattended === 1 ? "unattended network call" : "unattended network calls";
    $("count-sub").textContent =
      (manifest.ownCode.unattendedExternal[0] &&
        manifest.ownCode.unattendedExternal[0].what) ||
      "";

    // Conservative, true secondary assertions (the inherited-egress audit backs these).
    const inh = manifest.inheritedEgress || {};
    $("assertions").textContent =
      `No telemetry · No cloud AI · ${inh.disabled || 0} of ${inh.catalogued || 0} ` +
      `Firefox egress vectors disabled by default`;

    // The badge / panel state must reflect reality INCLUDING the toggle. With
    // lockdown off the portal probes are live — say so, do not imply silence.
    const panel = $("panel");
    panel.classList.toggle("lockdown-on", lockdown);
    panel.classList.toggle("lockdown-off", !lockdown);

    $("lockdown").checked = lockdown;
    $("lockdown-state").textContent = lockdown
      ? "on — captive-portal + connectivity probes silenced"
      : "off — Firefox captive-portal + connectivity probes are active (your choice)";

    // Proof line: verify the audit was generated against the running build.
    const matches =
      manifest.auditedCommit &&
      id.commit !== "unknown" &&
      manifest.auditedCommit === id.commit;
    const pv = $("proof-verdict");
    if (matches) {
      pv.textContent = "✓ This audit matches the build you're running.";
      pv.className = "proof-verdict ok";
    } else if (id.commit === "unknown") {
      pv.textContent =
        "• Running build is unstamped (dev build) — audit shown is from commit " +
        (manifest.auditedCommit || "?") + ".";
      pv.className = "proof-verdict warn";
    } else {
      pv.textContent =
        "⚠ This audit was generated at commit " +
        (manifest.auditedCommit || "?") +
        ", but you are running " +
        id.commit +
        " — the audit may be stale. Re-run the egress audit for this build.";
      pv.className = "proof-verdict warn";
    }
    $("proof-build").textContent =
      `gjoa ${manifest.gjoaVersion || "?"} · Firefox ${id.ffVersion} · ` +
      `build ${id.commit}` +
      (id.patchHash ? ` · patches ${id.patchHash}` : "") +
      (id.provenance && id.provenance !== "unknown" ? ` · ${id.provenance}` : "");

    renderLedger(manifest);

    const own = manifest.ownCode || {};
    const total =
      (own.unattendedExternal || []).length +
      (own.userEnabledNetwork || []).length +
      (own.local || []).length +
      (own.unproven || []).length;
    $("disclose-label").textContent = `show the ${total} audited egress points`;
    $("foot").textContent =
      `${manifest.method || ""}  ·  generated ${manifest.generated || ""}`;
  }

  function wireToggle() {
    const box = $("lockdown");
    box.addEventListener("change", () => {
      try {
        Services.prefs.setBoolPref(LOCKDOWN_PREF, box.checked);
        // GjoaLoader's observer applies the probe prefs; re-read + re-render so the
        // panel visibly reflects the new state immediately.
        loadAndRender();
      } catch (e) {
        $("lockdown-state").textContent =
          "could not set the pref (not privileged?) — " + e;
      }
    });
  }

  function wireDisclose() {
    const btn = $("disclose-btn");
    btn.addEventListener("click", () => {
      const ledger = $("ledger");
      const open = ledger.hasAttribute("hidden");
      if (open) {
        ledger.removeAttribute("hidden");
      } else {
        ledger.setAttribute("hidden", "");
      }
      btn.setAttribute("aria-expanded", String(open));
      $("disclose-caret").textContent = open ? "▾" : "▸";
    });
  }

  function fail(msg) {
    $("count-sub").textContent = msg;
  }

  async function loadAndRender() {
    try {
      const resp = await fetch("chrome://gjoa/content/sovereignty/manifest.json");
      const manifest = await resp.json();
      render(manifest);
    } catch (e) {
      fail("could not load the egress manifest: " + e);
    }
  }

  wireToggle();
  wireDisclose();
  loadAndRender();
})();

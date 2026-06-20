"use strict";

// about:gjoa — gjoa's settings home, rendered from the live pref state. Every
// setting is a present, reversible pref; reversible-feature costs are shown as
// measured or honestly "unmeasured". Profiles flip a whole bundle (applied by
// GjoaLoader's apply-profile!). Each setting shows its pref name (search it in
// about:config). textContent-only — never innerHTML (privileged page rendering data).

(function () {
  const $ = (id) => document.getElementById(id);

  let Services = null;
  try { Services = globalThis.Services; } catch (_) {}

  function getPref(name, type, dflt) {
    try {
      if (type === "int") return Services.prefs.getIntPref(name, dflt);
      if (type === "enum" || type === "string") return Services.prefs.getStringPref(name, dflt);
      return Services.prefs.getBoolPref(name, dflt);
    } catch (_) { return dflt; }
  }
  function setBool(name, v) { try { Services.prefs.setBoolPref(name, v); } catch (_) {} }
  function setInt(name, v) { try { Services.prefs.setIntPref(name, v | 0); } catch (_) {} }
  function setStr(name, v) { try { Services.prefs.setStringPref(name, v); } catch (_) {} }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function toggle(checked, onChange) {
    const label = el("label", "toggle");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = checked;
    input.addEventListener("change", () => onChange(input.checked));
    const track = el("span", "toggle-track");
    track.appendChild(el("span", "toggle-thumb"));
    label.appendChild(input);
    label.appendChild(track);
    return label;
  }

  function control(s, rerender) {
    const cur = getPref(s.pref, s.type, s.default);
    if (s.type === "bool") return toggle(!!cur, (on) => { setBool(s.pref, on); rerender(); });
    if (s.type === "enum") {
      const sel = el("select", "control-select");
      for (const opt of s.options || []) {
        const o = document.createElement("option");
        o.value = opt; o.textContent = opt; if (opt === cur) o.selected = true;
        sel.appendChild(o);
      }
      sel.addEventListener("change", () => { setStr(s.pref, sel.value); rerender(); });
      return sel;
    }
    if (s.type === "int") {
      const inp = document.createElement("input");
      inp.type = "number"; inp.className = "control-num"; inp.value = String(cur);
      inp.addEventListener("change", () => { setInt(s.pref, parseInt(inp.value, 10)); rerender(); });
      return inp;
    }
    if (s.type === "string") {
      const inp = document.createElement("input");
      inp.type = "text"; inp.className = "control-text"; inp.value = String(cur);
      if (s.placeholder) inp.placeholder = s.placeholder;
      inp.addEventListener("change", () => { setStr(s.pref, inp.value); rerender(); });
      return inp;
    }
    // other: read-only, edit via about:config
    return el("span", "control-ro", String(cur));
  }

  function costText(m) {
    if (!m) return "";
    if (m.method === "egress") return "cost: egress → " + (m.endpoint || "?");
    if (m.method === "feature") return "cost: feature toggle" + (m.endpoint ? " (" + m.endpoint + ")" : "");
    if (m.method === "cve-surface") return "security gate — not a perf knob";
    if (m.method === "unmeasured" || m.value == null) return "cost: unmeasured";
    return "cost: " + m.value + " " + (m.unit || "") + " (" + (m.confidence || "") + ")";
  }

  function settingRow(s, rerender) {
    const row = el("div", "row");
    const main = el("div", "row-main");
    main.appendChild(el("div", "row-title", s.title));
    if (s.help) main.appendChild(el("div", "row-help", s.help));
    if (s.measurement) {
      const cost = el("div", "row-cost", costText(s.measurement));
      if (s.measurement.basis) cost.title = s.measurement.basis;
      main.appendChild(cost);
    }
    const pref = el("a", "row-pref");
    pref.textContent = s.pref;
    pref.href = "about:config";
    pref.title = "open about:config (search this pref to edit raw)";
    main.appendChild(pref);
    row.appendChild(main);
    row.appendChild(control(s, rerender));
    return row;
  }

  // A privacy profile's `sets` all match the live pref state?
  function profileMatches(p) {
    return Object.keys(p.sets).every((k) => {
      const want = p.sets[k];
      const typ = (typeof want === "number") ? "int" : "bool";
      return getPref(k, typ, want) === want;
    });
  }

  function applyProfile(p, selPref, rerender) {
    for (const k of Object.keys(p.sets)) {
      const v = p.sets[k];
      if (typeof v === "number") setInt(k, v); else setBool(k, !!v);
    }
    if (selPref) setStr(selPref, p.id);
    rerender();
  }

  // Privacy: a curated profile picker (presets flip a subset of the granular
  // toggles below; hand-editing any toggle drops you to Custom).
  function renderPrivacy(reg, rerender) {
    const root = $("profiles");
    root.textContent = "";
    const pv = reg.privacy;
    if (!pv) return;
    const sel = pv.selector || {};
    const profiles = sel.profiles || [];
    const selPref = sel.pref;

    const active = profiles.find(profileMatches);
    const activeId = active ? active.id : "custom";

    const block = el("section", "block");
    block.appendChild(el("h2", "h2", pv.title || "Privacy"));
    if (pv.intro) block.appendChild(el("p", "sub", pv.intro));

    const picker = el("div", "picker");
    const addCard = (id, title, summary, onPick, disabled) => {
      const card = el("label", "pick" + (id === activeId ? " pick-on" : ""));
      const radio = document.createElement("input");
      radio.type = "radio"; radio.name = "privacy-profile";
      radio.checked = (id === activeId);
      if (disabled) radio.disabled = true;
      else radio.addEventListener("change", onPick);
      card.appendChild(radio);
      const txt = el("div", "pick-txt");
      txt.appendChild(el("div", "pick-title", title));
      if (summary) txt.appendChild(el("div", "pick-sum", summary));
      card.appendChild(txt);
      picker.appendChild(card);
    };
    for (const p of profiles) {
      addCard(p.id, p.title + (p.asterisk ? " *" : ""), p.summary,
              () => applyProfile(p, selPref, rerender), false);
    }
    // Custom is reached by editing a toggle, not chosen directly.
    addCard("custom", "Custom", "Your own mix — set by editing the toggles below.", null, true);
    block.appendChild(picker);

    const ast = (active && active.asterisk) ||
                ((profiles.find((p) => p.asterisk) || {}).asterisk);
    if (ast) block.appendChild(el("p", "profile-disclaimer", "* " + ast));

    // granular toggles — editing one recomputes the active profile (-> Custom).
    for (const g of pv.granular || []) {
      block.appendChild(settingRow(g, () => {
        const now = profiles.find(profileMatches);
        if (selPref) setStr(selPref, now ? now.id : "custom");
        rerender();
      }));
    }
    root.appendChild(block);
  }

  function renderSections(reg, rerender) {
    const root = $("sections");
    root.textContent = "";
    for (const sec of reg.sections || []) {
      const block = el("section", "block");
      block.appendChild(el("h2", "h2", sec.title));
      if (sec.intro) block.appendChild(el("p", "sub", sec.intro));
      for (const s of sec.settings || []) block.appendChild(settingRow(s, rerender));
      root.appendChild(block);
    }
  }

  function renderLinks(reg) {
    const root = $("links");
    root.textContent = "";
    for (const l of reg.links || []) {
      const a = el("a", "link-card");
      a.href = l.url;
      a.appendChild(el("div", "link-title", l.title));
      if (l.desc) a.appendChild(el("div", "link-desc", l.desc));
      root.appendChild(a);
    }
  }

  let REG = null;
  function render() {
    renderPrivacy(REG, render);
    renderSections(REG, render);
    renderLinks(REG);
    $("foot").textContent =
      "gjoa settings live here. Firefox's own settings are in Firefox Settings (about:preferences). " +
      "Costs are measured against a real gjoa binary, or honestly unmeasured — never invented.";
  }

  async function load() {
    try {
      const r = await fetch("chrome://gjoa/content/settings/registry.json");
      REG = await r.json();
      render();
    } catch (e) {
      $("sections").textContent = "could not load the settings registry: " + e;
    }
  }
  load();
})();

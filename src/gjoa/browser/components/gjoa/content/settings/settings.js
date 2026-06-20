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
    // string / other: read-only, edit via about:config
    return el("span", "control-ro", String(cur));
  }

  function costText(m) {
    if (!m) return "";
    if (m.method === "unmeasured" || m.value == null) {
      return "cost: unmeasured" + (m.method && m.method !== "unmeasured" ? " (" + m.method + ")" : "");
    }
    return "cost: " + m.value + " " + (m.unit || "") + " (" + (m.confidence || "") + ")";
  }

  function settingRow(s, rerender) {
    const row = el("div", "row");
    const main = el("div", "row-main");
    main.appendChild(el("div", "row-title", s.title));
    if (s.help) main.appendChild(el("div", "row-help", s.help));
    if (s.measurement) main.appendChild(el("div", "row-cost", costText(s.measurement)));
    const pref = el("a", "row-pref");
    pref.textContent = s.pref;
    pref.href = "about:config";
    pref.title = "open about:config (search this pref to edit raw)";
    main.appendChild(pref);
    row.appendChild(main);
    row.appendChild(control(s, rerender));
    return row;
  }

  function renderProfiles(reg, rerender) {
    const root = $("profiles");
    root.textContent = "";
    for (const p of reg.profiles || []) {
      const card = el("div", "profile");
      const head = el("div", "profile-head");
      const txt = el("div", "profile-txt");
      txt.appendChild(el("div", "profile-title", p.title));
      if (p.claim) txt.appendChild(el("div", "profile-claim", p.claim));
      head.appendChild(txt);
      head.appendChild(toggle(getPref(p.pref, "bool", false), (on) => { setBool(p.pref, on); rerender(); }));
      card.appendChild(head);
      if (p.disclaimer) card.appendChild(el("p", "profile-disclaimer", p.disclaimer));
      if (p.tradeoffs && p.tradeoffs.length) {
        const ul = el("ul", "tradeoffs");
        for (const t of p.tradeoffs) {
          const li = el("li", "tradeoff");
          li.appendChild(el("span", "tradeoff-title", t.title));
          li.appendChild(el("span", "tradeoff-detail", t.detail));
          ul.appendChild(li);
        }
        card.appendChild(ul);
      }
      root.appendChild(card);
    }
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
    renderProfiles(REG, render);
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

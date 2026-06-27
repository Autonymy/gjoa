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

  // Normalize an enum option into { value, label }. An option may be a bare
  // string ("nord") — value == label — or an object { value, label } so the UI
  // can show a friendly, verbose label while still writing the raw pref value
  // (e.g. label "Always dark — force every site (most consistent)" -> "engine").
  function optionVL(opt) {
    if (opt && typeof opt === "object") {
      return { value: String(opt.value), label: String(opt.label != null ? opt.label : opt.value) };
    }
    return { value: String(opt), label: String(opt) };
  }

  function control(s, rerender) {
    const cur = getPref(s.pref, s.type, s.default);
    if (s.type === "bool") return toggle(!!cur, (on) => { setBool(s.pref, on); rerender(); });
    if (s.type === "enum") {
      const sel = el("select", "control-select");
      let matched = false;
      for (const opt of s.options || []) {
        const { value, label } = optionVL(opt);
        const o = document.createElement("option");
        o.value = value; o.textContent = label;
        if (value === String(cur)) { o.selected = true; matched = true; }
        sel.appendChild(o);
      }
      // If the live pref holds a value not in the friendly list (a power user
      // set a raw value in about:config), surface it rather than silently
      // snapping to the first option — keeps the picker honest.
      if (!matched && cur != null && String(cur) !== "") {
        const o = document.createElement("option");
        o.value = String(cur); o.textContent = String(cur) + " (current — set in about:config)";
        o.selected = true;
        sel.appendChild(o);
      }
      sel.addEventListener("change", () => { setStr(s.pref, sel.value); rerender(); });
      return sel;
    }
    if (s.type === "int") {
      const clamp = (v) => {
        if (Number.isNaN(v)) v = (typeof s.min === "number") ? s.min : 0;
        if (typeof s.min === "number" && v < s.min) v = s.min;
        if (typeof s.max === "number" && v > s.max) v = s.max;
        return v;
      };
      // A bounded int with `slider: true` renders a range slider + a live value
      // readout (better feel for Darkness / Scrim than a bare number box). The
      // pref is only written on release (change), not on every drag tick.
      if (s.slider && typeof s.min === "number" && typeof s.max === "number") {
        const wrap = el("div", "control-slider");
        const range = document.createElement("input");
        range.type = "range"; range.className = "slider-range";
        // `invert: true` — the pref is a LIGHTNESS (higher = lighter) but the knob
        // reads as its intuitive opposite ("Darkness", higher = darker). Map the
        // slider position to the complement so dragging up darkens; the stored pref
        // keeps its lightness meaning (the engine reads it unchanged).
        const toDisp = (p) => (s.invert ? (s.min + s.max - p) : p);
        const toPref = (d) => (s.invert ? (s.min + s.max - d) : d);
        range.min = String(s.min); range.max = String(s.max);
        range.value = String(toDisp(cur));
        const out = el("span", "slider-val", String(toDisp(cur)));
        range.addEventListener("input", () => { out.textContent = String(range.value); });
        range.addEventListener("change", () => {
          const d = clamp(parseInt(range.value, 10));
          range.value = String(d); out.textContent = String(d);
          setInt(s.pref, toPref(d)); rerender();
        });
        wrap.appendChild(range);
        wrap.appendChild(out);
        return wrap;
      }
      const inp = document.createElement("input");
      inp.type = "number"; inp.className = "control-num"; inp.value = String(cur);
      if (typeof s.min === "number") inp.min = String(s.min);
      if (typeof s.max === "number") inp.max = String(s.max);
      inp.addEventListener("change", () => {
        const v = clamp(parseInt(inp.value, 10));
        inp.value = String(v);
        setInt(s.pref, v); rerender();
      });
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

  // A row shows just TITLE + CONTROL by default; the verbose help / examples / note
  // are collapsed behind a disclosure chevron (click or keyboard) so the page stays
  // a scannable list, not a wall of text. Rows with nothing to explain show no chevron.
  function settingRow(s, rerender) {
    const row = el("div", "row");
    const head = el("div", "row-head");
    const titleWrap = el("div", "row-titlewrap");
    const hasDetails = !!(
      s.help || (Array.isArray(s.examples) && s.examples.length) || s.note || s.measurement
    );
    if (hasDetails) titleWrap.appendChild(el("span", "row-chevron"));
    titleWrap.appendChild(el("div", "row-title", s.title));
    head.appendChild(titleWrap);
    head.appendChild(control(s, rerender));
    row.appendChild(head);

    if (hasDetails) {
      titleWrap.classList.add("is-clickable");
      titleWrap.setAttribute("role", "button");
      titleWrap.setAttribute("tabindex", "0");
      titleWrap.setAttribute("aria-expanded", "false");
      const details = el("div", "row-details");
      if (s.help) details.appendChild(el("div", "row-help", s.help));
      // `examples` is an array of { label, detail } "what you'll see" callouts —
      // concrete site outcomes (Reddit / YouTube) under this setting.
      if (Array.isArray(s.examples) && s.examples.length) {
        const ex = el("ul", "row-examples");
        for (const e of s.examples) {
          const li = el("li", "row-example");
          if (e.label) li.appendChild(el("span", "ex-label", e.label));
          if (e.detail) li.appendChild(el("span", "ex-detail", e.detail));
          ex.appendChild(li);
        }
        details.appendChild(ex);
      }
      if (s.note) details.appendChild(el("div", "row-note", s.note));
      if (s.measurement) {
        const cost = el("div", "row-cost", costText(s.measurement));
        if (s.measurement.basis) cost.title = s.measurement.basis;
        details.appendChild(cost);
      }
      const pref = el("a", "row-pref");
      pref.textContent = s.pref;
      pref.href = "about:config";
      pref.title = "open about:config (search this pref to edit raw)";
      details.appendChild(pref);
      row.appendChild(details);

      const toggleExpand = () => {
        const open = row.classList.toggle("expanded");
        titleWrap.setAttribute("aria-expanded", open ? "true" : "false");
      };
      titleWrap.addEventListener("click", toggleExpand);
      titleWrap.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); toggleExpand(); }
      });
    }
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
    block.id = "sec-privacy";
    const h = el("h2", "h2", pv.title || "Privacy");
    block.appendChild(h);
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

    // Footnote is bound to the SELECTED profile: show it iff the active
    // profile carries an asterisk (e.g. LibreWolf-Inspired). Switching to
    // another profile (or Custom) re-renders with no active asterisk → hidden.
    const ast = active && active.asterisk;
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

  function renderSettingList(parent, list, rerender) {
    for (const s of list || []) parent.appendChild(settingRow(s, rerender));
  }

  function renderSections(reg, rerender) {
    const root = $("sections");
    root.textContent = "";
    for (const sec of reg.sections || []) {
      const block = el("section", "block");
      block.id = "sec-" + sec.id;
      block.appendChild(el("h2", "h2", sec.title));
      if (sec.intro) block.appendChild(el("p", "sub", sec.intro));
      // Flat settings list…
      renderSettingList(block, sec.settings, rerender);
      // …or named subsections (e.g. "Dark mode & color" groups Theme + Dark
      // mode under one nav entry, each with its own subheading + intro).
      for (const sub of sec.subsections || []) {
        const subBlock = el("div", "subsection");
        if (sub.id) subBlock.id = "sub-" + sub.id;
        subBlock.appendChild(el("h3", "h3", sub.title));
        if (sub.intro) subBlock.appendChild(el("p", "sub", sub.intro));
        renderSettingList(subBlock, sub.settings, rerender);
        block.appendChild(subBlock);
      }
      root.appendChild(block);
    }
  }

  // Build the sticky category rail from the live registry order: Privacy first,
  // then each section. Clicking an entry scrolls to that section;
  // the active entry is kept in sync with scroll position via IntersectionObserver.
  function renderNav(reg) {
    const root = $("nav");
    if (!root) return;
    root.textContent = "";
    const items = [];
    if (reg.privacy) items.push({ id: "sec-privacy", label: reg.privacy.title || "Privacy" });
    for (const sec of reg.sections || []) items.push({ id: "sec-" + sec.id, label: sec.title });

    const list = el("nav", "nav-list");
    const byTarget = new Map();
    for (const it of items) {
      const a = el("a", "nav-item", it.label);
      a.href = "#" + it.id;
      a.dataset.target = it.id;
      a.addEventListener("click", (ev) => {
        ev.preventDefault();
        const t = document.getElementById(it.id);
        if (t) t.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      byTarget.set(it.id, a);
      list.appendChild(a);
    }
    root.appendChild(list);

    // Highlight the section currently in view. A scroll-POSITION picker (not an
    // IntersectionObserver band): the active entry is the lowest section whose top
    // has passed an activation line near the top of the viewport — PLUS a bottom
    // guard that forces the last section active once scrolled to the end. The old
    // IO band (active only between 10–20% of the viewport) capped on a short page:
    // the final section (Layout) could never scroll high enough to enter
    // the band, so it never activated.
    const setActive = (id) => {
      for (const a of byTarget.values()) a.classList.remove("nav-on");
      const a = byTarget.get(id);
      if (a) a.classList.add("nav-on");
    };
    const updateActive = () => {
      if (!items.length) return;
      const line = window.innerHeight * 0.25;
      let activeId = items[0].id;
      for (const it of items) {
        const t = document.getElementById(it.id);
        if (!t) continue;
        if (t.getBoundingClientRect().top - line <= 0) activeId = it.id; else break;
      }
      const sc = document.scrollingElement || document.documentElement;
      // Forgiving bottom guard: the last section (e.g. Layout) often can't scroll
      // its top above the activation line — not enough page below it — so the main
      // loop never activates it. Force the last item active once we're NEAR the end.
      if (sc.scrollTop + window.innerHeight >= sc.scrollHeight - 120) {
        activeId = items[items.length - 1].id; // near the bottom → last section
      }
      setActive(activeId);
    };
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => { ticking = false; updateActive(); });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    updateActive();
  }

  let REG = null;
  let navBuilt = false;
  function render() {
    renderPrivacy(REG, render);
    renderSections(REG, render);
    // The nav is structural (registry order) — build it once, not on every
    // pref-flip rerender (which would re-run the IntersectionObserver wiring).
    if (!navBuilt) { renderNav(REG); navBuilt = true; }
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

"use strict";

// gjoa new tab — the only live element is the clock (timekeeping is navigation).
// Updates once per minute, aligned to the minute boundary, so an idle tab does
// essentially no work.
(function () {
  const clockEl = document.getElementById("clock");
  const dateEl = document.getElementById("date");

  function render() {
    const now = new Date();
    try {
      clockEl.textContent = now.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
      dateEl.textContent = now.toLocaleDateString([], {
        weekday: "long",
        month: "long",
        day: "numeric",
      });
    } catch (_) {
      // Locale APIs should never throw here, but never let the page go blank.
    }
    // Re-render at the top of the next minute (+ a small cushion).
    const msToNextMinute = (60 - now.getSeconds()) * 1000 - now.getMilliseconds();
    setTimeout(render, Math.max(250, msToNextMinute) + 30);
  }

  render();
})();

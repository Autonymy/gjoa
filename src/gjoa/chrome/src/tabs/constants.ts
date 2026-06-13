// Tunables shared across tabs/* modules. Pure values, no behavior — keep this
// file free of imports beyond literals so any module can pull from it.

/** Pixels per nesting level used for tab-row inline padding. */
export const INDENT = 14;

/** Window in ms to complete a chord like `dd` or `gg`. */
export const CHORD_TIMEOUT = 500;

/** How many recently-closed tabs we remember for hierarchy restore on Ctrl+Shift+T. */
export const CLOSED_MEMORY = 32;

/** SessionStore-persisted XUL attribute holding each tab's stable gjoa ID. */
export const PIN_ATTR = "gjoa-id";

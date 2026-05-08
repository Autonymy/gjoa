// Tiny logger. ANSI dim for INFO, yellow for WARN, red for ERROR.
// Prefixed with [prep] so output is identifiable when interleaved with
// mach/nix output.

const PREFIX = "\x1b[2m[prep]\x1b[0m";

export const log = {
  info: (msg: string) => console.error(`${PREFIX} ${msg}`),
  warn: (msg: string) => console.error(`${PREFIX} \x1b[33mwarn:\x1b[0m ${msg}`),
  error: (msg: string) => console.error(`${PREFIX} \x1b[31merror:\x1b[0m ${msg}`),
  step: (msg: string) => console.error(`${PREFIX} \x1b[1m→\x1b[0m ${msg}`),
  ok: (msg: string) => console.error(`${PREFIX} \x1b[32m✓\x1b[0m ${msg}`),
};

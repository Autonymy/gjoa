# Stewardship topology (GENERATED — do not edit by hand)

> Projection of `tools/scripts/preflight.bjs` (the gate registry) +
> `docs/stewardship/*.md` + `package.json` scripts. Regenerate with
> `bun run stewardship:gen`; drift or a dangling reference fails
> `bun run stewardship:check`. A hand-list would rot — this can't.

## Preflight gates (20)

| Gate | Name | Enforce | Cited by |
|---|---|---|---|
| A | patches apply clean on fresh source | hard | README, churn, security |
| B | jar.mn pattern matches working example | hard | churn |
| C | no production-mode TODO/no-op landmines | hard | _(undocumented)_ |
| D | dep floors satisfied | hard | _(undocumented)_ |
| E | existing binary status | warn | _(undocumented)_ |
| F | nix daemon will accept flake settings | hard | _(undocumented)_ |
| G | nix flake evaluates without errors | hard | _(undocumented)_ |
| H | diff since last working build | warn | _(undocumented)_ |
| I | chrome bundle three-way alignment | hard | _(undocumented)_ |
| J | scriptlet bundle integrity | hard | _(undocumented)_ |
| K | engine/ reflects current source (import-currency) | hard | README |
| L | surface contracts (declared upstream deps resolve) | hard | README, churn, security |
| M | beagle compiler pinned (beagle-currency) | hard | README, churn |
| N | knobs backed + reversible (knob-not-delete) | hard | _(undocumented)_ |
| O | no bare beagle/ import in shipped gjoa .sys.mjs | hard | _(undocumented)_ |
| P | patch hashes match recorded manifest (#104a) | hard | README, security |
| Q | $$bc runtime export-closure (emit ↔ core.js) | hard | README |
| R | security mitigations intact (#121) | hard | README, security |
| S | security-critical patches persist (#120) | hard | README, churn, security |
| T | stewardship tapestry intact (docs ↔ machinery) | hard | README |

## Health

- domains: 5 (README, churn, performance, security, testing)
- file references: 68 (68 resolve, 0 dangling)
- script references: 12 (12 resolve)
- gates: 20 (10 documented, 10 undocumented)
- undocumented gates (add to a domain doc): C, D, E, F, G, H, I, J, N, O

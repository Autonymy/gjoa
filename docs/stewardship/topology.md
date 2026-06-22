# Stewardship topology (GENERATED — do not edit by hand)

> Projection of `tools/scripts/preflight.bjs` (the gate registry) +
> `docs/stewardship/*.md` + `package.json` scripts. Regenerate with
> `bun run stewardship:gen`; drift or a dangling reference fails
> `bun run stewardship:check`. A hand-list would rot — this can't.

## Preflight gates (23)

| Gate | Name | Enforce | Cited by |
|---|---|---|---|
| A | patches apply clean on fresh source | hard | README, churn, security |
| B | jar.mn pattern matches working example | hard | churn |
| C | no production-mode TODO/no-op landmines | hard | churn |
| D | dep floors satisfied | hard | churn |
| E | existing binary status | warn | churn |
| F | nix daemon will accept flake settings | hard | churn |
| G | nix flake evaluates without errors | hard | churn |
| H | diff since last working build | warn | churn |
| I | chrome bundle three-way alignment | hard | churn |
| J | scriptlet bundle integrity | hard | churn, security |
| K | engine/ reflects current source (import-currency) | hard | README |
| L | surface contracts (declared upstream deps resolve) | hard | README, churn, security |
| M | beagle compiler pinned (beagle-currency) | hard | README, churn |
| N | knobs backed + reversible (knob-not-delete) | hard | churn |
| O | no bare beagle/ import in shipped gjoa .sys.mjs | hard | churn |
| P | patch hashes match recorded manifest (#104a) | hard | README, security |
| Q | $$bc runtime export-closure (emit ↔ core.js) | hard | README |
| R | security mitigations intact (#121) | hard | README, security |
| S | security-critical patches persist (#120) | hard | README, churn, security |
| T | stewardship tapestry intact (docs ↔ machinery) | hard | README |
| U | patch numbering coherent (domains contiguous) | warn | churn |
| V | upstream provenance lock current | warn | churn |
| W | dark-mode contrast backstop ships ON | hard | testing |

## Health

- domains: 5 (README, churn, performance, security, testing)
- file references: 76 (76 resolve, 0 dangling)
- script references: 12 (12 resolve)
- gates: 23 (23 documented, 0 undocumented)

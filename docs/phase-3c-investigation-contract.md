# TRACE — Phase 3C: Investigation Contract (Application-Facing Data Contract)

**Status:** Complete. Contract + validation + read-only service only — no frontend, graph UI, replay controls, API routes, or Phase 3D work.
**Date:** 2026-09-21
**Depends on:** [phase-2-product-system-spec.md](./phase-2-product-system-spec.md), [phase-3a-data-foundation.md](./phase-3a-data-foundation.md), [phase-3b-reconstruction-engine.md](./phase-3b-reconstruction-engine.md), `src/types/` (domain model, untouched), `src/reconstruction/` + `src/contract/` + `src/investigations/`.
**API calls this phase:** **0** (zero live Nansen calls). Fixture-first throughout.

---

## 1. What was built

A stable, validated, read-only envelope around the Phase 3B `Investigation` that future Next.js route handlers can serve directly — without building the frontend yet.

```
src/contract/          view-model layer (new; allowed: "Phase 3 may add derived view-model types")
  types.ts             InvestigationContract, CoverageReport, EvidenceCompleteness,
                       CaseSummary, DataSource, Completeness, CONTRACT_VERSION
  completeness.ts      ENGINE_LIMITATIONS, countEvidence, aggregateUnavailableFields,
                       computeCompleteness (the rule), computeEvidence
  validate.ts          validateInvestigation, validateContract, assertContract, ContractError
  assemble.ts          buildContract (wrap+validate+freeze), reconstructContract
  service.ts           deepFreeze, createContractService, UnknownCaseError
src/investigations/    case assembly (per the Phase 2 module map)
  euler.ts             canonical Euler metadata, loadEulerInputs, eulerCoverage,
                       buildEulerInvestigation, buildEulerContract,
                       AVAILABLE_CASES, buildEulerService
```

No new dependencies. No changes to `src/types/*`, `src/nansen/*`, or Phase 3A files. Two surgical Phase 3B engine patches were required (§2).

---

## 2. Engine patches applied in 3C (with cause)

Writing the validator against real engine output exposed three genuine bugs; all fixed in `src/reconstruction/engine.ts`, all Phase 3B tests still green:

1. **Member `relationshipIds` held group event ids.** `TraceEvent.relationshipIds` must resolve to relationships, but members carried their DERIVED group ids there. Fix: members link only true relationship ids (pair/funder/flow edges); group→member expansion lives in the group's `sourceEventIds`, and member→group traversal goes via the flow edge's `evidenceEventIds`. (Phase 3B doc §5's "wired both ways" phrasing is superseded by this: expansion is group→members, linkage is member→flow-edge→group.)
2. **Participant-only entities had sourceless FACT provenance.** Entities observed only as transfer/transaction participants (e.g. the three dust senders) carried `FACT` with `sources: []`. Fix: role precedence ranks (3 subject fixed · 2 aggregate/relation · 1 observed participant · 0 none); higher rank overwrites, so every non-subject entity ends with a sourced role statement.
3. **Validator rule, not engine:** case-level summary roll-ups (`entities_involved`) legitimately have empty `sourceEventIds` (they aggregate entities, not events). Allowed iff `inputs.engine` anchors reproducibility; event/relationship DERIVED still require member ids.

---

## 3. Contract schema summary

```ts
InvestigationContract {
  contractVersion: 'trace-3c/1.0.0'   // pinned exactly by validation
  engineVersion: 'trace-3b/1.0.0'
  caseId: string                       // == investigation.id (enforced)
  dataSource: 'fixture-cache' | 'live-nansen'
  completeness: 'complete' | 'incomplete'
  completenessReasons: string[]        // non-empty when incomplete (enforced)
  coverage: { flags: { fundingEvidence, counterpartyAggregates,
                       transactionWindowCovered }, reasons: string[] }
  evidence: EvidenceCompleteness {
    observedFacts, observedRelations, derivedValues,   // top-level provenances
    derivedGroupings, derivedFlowEdges,                // DERIVED subsets
    primaryEvents, collapsedEvents, eventsMissingUsd,
    duplicatesSkipped, flowsSkipped,
    unavailableFields: string[],   // aggregated over build inputs, sorted+unique
    limitations: string[],         // ENGINE_LIMITATIONS (7 fixed entries)
  }
  investigation: Investigation         // Phase 3B case, deep-frozen
}
```

**Completeness rule** (single implementation in `computeCompleteness`, re-checked by `validateContract`): `complete` IFF `status === 'reconstructed'` AND `dataSource === 'live-nansen'` AND all coverage flags true. Fixture-cache reconstructions are therefore **never complete** — cached snapshots are point-in-time and revisable (Phase 1 finding). Every failing check yields an explicit reason.

**Validation** (`validateContract` → error list; `assertContract` throws): shape + ID formats (`event_###`, `rel_###`, `entity_*`) + uniqueness + sequential `order` + ISO timestamps + hex txHashes + known type/role/rule vocabularies + **all references resolve** (participants, relationshipIds, evidenceEventIds, sourceEventIds) + FACT/RELATION carry ≥1 source (+ statement) + DERIVED carries member ids + calculation (+ `inputs.engine` for event-less roll-ups) + **HYPOTHESIS anywhere → error** + interpretive roles (`attacker`/`beneficiary`/…) → error + `caseId` match + **recomputed completeness and evidence counts must match** (the contract cannot drift from its case).

---

## 4. Exact Euler contract (output, trimmed)

`buildEulerContract('2026-09-21T00:00:00.000Z')` — byte-identical across runs:

```json
{
  "contractVersion": "trace-3c/1.0.0",
  "engineVersion": "trace-3b/1.0.0",
  "caseId": "case_euler_2023",
  "dataSource": "fixture-cache",
  "completeness": "incomplete",
  "completenessReasons": [
    "dataSource is 'fixture-cache': cached snapshots are point-in-time and revisable, so completeness cannot be claimed from fixtures alone.",
    "coverage.transactionWindowCovered is false: flags.transactionWindowCovered: the captured transaction sample holds 5 latest-first dust rows ($0.01–$1.74, 03-28 → 03-31); exploit-day (03-13) rows require pagination beyond the captured sample (is_last_page=false) and live capture."
  ],
  "coverage": {
    "flags": { "fundingEvidence": true, "counterpartyAggregates": true, "transactionWindowCovered": false },
    "reasons": [ "flags.fundingEvidence: …First Funder… (reported link, not control proof).",
                 "flags.counterpartyAggregates: 15 window-level rows…; aggregates only, no per-hop evidence.",
                 "flags.transactionWindowCovered: …latest-first dust…pagination…and live capture." ]
  },
  "evidence": {
    "observedFacts": 39, "observedRelations": 3, "derivedValues": 4,
    "derivedGroupings": 2, "derivedFlowEdges": 2,
    "primaryEvents": 3, "collapsedEvents": 5, "eventsMissingUsd": 1,
    "duplicatesSkipped": 0, "flowsSkipped": 0,
    "unavailableFields": ["address_label", "counterparty_address_label", "tokens_sent"],
    "limitations": [ "…no txIndex/logIndex…", "…aggregates…never inferred…", "…flow splits…",
                     "…revisable…", "…row-level volume_usd…", "…DERIVED…not observed facts…",
                     "…No HYPOTHESIS…" ]
  }
}
```

Timeline: `event_001 funding` (First Funder, RELATION, `2023-03-13T09:12:23Z`) → five collapsed dust transfers → DERIVED dispersal + consolidation (5 members, `$4.72 combined`, `sourceEventIds` all resolving). 19 entities (1 subject, 1 funder, 17 counterparty), 20 relationships, summary steps 3 / entities 19 / peak `$1.74` (honestly dust — see §5), 4 data gaps. Status `reconstructed`; contract `incomplete` **by rule** — this is not a complete exploit reconstruction and is never labeled as one.

---

## 5. How incomplete evidence is represented

| Signal | Where | Euler value |
| --- | --- | --- |
| Source | `dataSource` | `fixture-cache` |
| Verdict + why | `completeness` + `completenessReasons` | `incomplete`; fixture-revisability + dust-window reasons |
| Dimension flags | `coverage.flags/reasons` | `transactionWindowCovered: false` with the dust/pagination note |
| Counts | `evidence.*` | 39 FACT / 3 RELATION / 4 DERIVED; 5 collapsed; 1 missing USD; unavailable fields listed |
| Honest gaps | `investigation.dataGaps` | txIndex absence; aggregates≠events; pagination; missing USD |
| Fixed limits | `evidence.limitations` | 7 engine limitations on every contract |
| Case status | `investigation.status` | `reconstructed` (timeline resolved) — deliberately distinct from `completeness` |

The `status` vs `completeness` split is intentional: the engine resolved a timeline (`reconstructed`), but the *evidence* does not cover the incident window (`incomplete`). The frontend must render both, never upgrade one from the other.

---

## 6. Service interface (for future route handlers)

```ts
const service = buildEulerService();          // fixture reads happen here, once
service.listCases();                          // → readonly CaseSummary[1] (frozen)
service.getContract('case_euler_2023');       // → frozen InvestigationContract
service.getContract('nope');                  // → throws UnknownCaseError
```

Everything served is deep-frozen at build; mutation throws `TypeError` (tested). Handlers stay thin: list → `listCases()`, detail → `getContract(id)` with `UnknownCaseError` → 404. No network, no secrets, no live calls in the serving path.

---

## 7. Test results (exact)

`npm test` — **49 pass / 0 fail** (~1.1s): 17 Phase 3A + 20 Phase 3B (all still green after the §2 patches) + 12 Phase 3C (`test/contract.test.ts`):

| Test | Requirement | Result |
| --- | --- | --- |
| C-IDS-1 | Repeated builds byte-identical; sequential `event_###`, unique `rel_###`/`entity_*` | pass |
| C-IDS-2 | Reversed input arrays → identical contract JSON | pass |
| C-EMPTY | Empty input → valid `partial`/`incomplete` contract, zero counts | pass |
| C-DUPE | Duplicates collapsed, `duplicatesSkipped: 1`, validation-clean | pass |
| C-EVIDENCE | Every member anchors endpoint+fixture+time+tx; groups expandable; aggregate metrics present | pass |
| C-STATUS-EULER | `fixture-cache`/`incomplete`, dust+pagination reasons, never "complete exploit" | pass |
| C-STATUS-COMPLETE | Synthetic live + full coverage validates as `complete` | pass |
| C-PROV | Exact counts 39/3/4, groupings 2, flow edges 2; unavailable fields sorted; no HYPOTHESIS/attacker | pass |
| C-VALID-NEG | Dangling refs, injected HYPOTHESIS, bad ids/rules/roles, flipped completeness — all reported with paths | pass (6 corruptions) |
| C-VALID-INVESTIGATION | Standalone validation passes on Euler | pass |
| C-COVERAGE | Euler flags true/true/false with reasons | pass |
| C-SERVICE | One frozen case, unknown id throws, mutation throws `TypeError` | pass |

---

## 8. Files created / modified

**Created**
- `src/contract/types.ts`, `completeness.ts`, `validate.ts`, `assemble.ts`, `service.ts`, `index.ts`
- `src/investigations/euler.ts`, `src/investigations/index.ts`
- `test/contract.test.ts`, `docs/phase-3c-investigation-contract.md` (this document)

**Modified**
- `src/reconstruction/engine.ts` — §2 patches only (role-rank sourcing; relationshipIds reference relationships exclusively). No threshold/ordering/admission changes.
- `test/contract.test.ts` — (new; listed above).

**Untouched:** `src/types/*`, `src/nansen/*`, Phase 3A files, all fixtures, `package.json`.

## 9. Commands executed

| Command | Result |
| --- | --- |
| `node --test test/contract.test.ts` (first pass) | Import error (test bug) + 12 validation errors that turned out to be **3 real engine bugs** (§2) |
| `npm test` (final) | ✅ **49 pass / 0 fail** |
| contract-example dump script (read-only, temp, deleted) | §4 figures |

## 10. Ambiguity requiring review before frontend implementation

1. **Exploit-day data needs a live-capture decision.** The contract proves the pipeline but the story stays dust until paginated `transactions` calls (03-13 rows, ~1 credit/page) plus optionally `transfers`/`dex-trades` for the window are captured and frozen as new fixtures. Approve a credit budget + which endpoints before any "reconstruction" UI copy is written.
2. **`status` vs `completeness` rendering.** The UI must show both (`reconstructed` timeline, `incomplete` evidence) without implying the timeline is the whole incident. Recommend design review of the exact labels before build.
3. **Case naming.** The registry keeps the established incident name ("Euler Finance exploit and fund return") for continuity; the headline is observational. Confirm this naming stance before it reaches the screen.
4. **No HYPOTHESIS channel yet.** Interpretive annotations (HYPOTHESIS with confidence) are schema-supported but intentionally unproducible — frontend must not invent an interpretation layer; that is a later phase decision.

**STOP.** Phase 3D not started.

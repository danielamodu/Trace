# TRACE — Phase 2: Product & System Specification

**Status:** Specification. **No application logic, no frontend, no engine built.** This document + the conceptual types in [`src/types/`](../src/types/) are the entire Phase 2 deliverable.
**Date:** 2026-09-21
**Depends on:** [`phase-1-nansen-reconnaissance.md`](./phase-1-nansen-reconnaissance.md) (locked), [`nansen-endpoints.md`](./nansen-endpoints.md), [`fixtures/hero-event.json`](../fixtures/hero-event.json).
**Gate:** Do not start Phase 3 until this spec is reviewed and approved.

> **Provenance rule (governs the whole product):** every rendered claim carries one of four categories — **FACT** (a field Nansen returned), **DERIVED** (deterministically computed by TRACE from FACTs), **RELATION** (a link Nansen asserts, e.g. "First Funder"), **HYPOTHESIS** (interpretation, never proven). TRACE must **never** present a HYPOTHESIS as a FACT. This is enforced at the type level in [`src/types/provenance.ts`](../src/types/provenance.ts).

---

## 0. Data-integrity note (read first)

The Phase 2 brief lists three hero addresses that **do not match** the live-validated Phase 1B data. Because TRACE's entire value proposition is provenance, the spec uses the **live-validated** addresses from `fixtures/hero-event.json` (captured against Nansen on 2026-09-21), not the brief's:

| Role | Phase 2 brief (unverified) | **Live-validated (used here)** | Source |
| --- | --- | --- | --- |
| Attacker EOA | `0xb6689fad…3095db` | **`0xb66cd966670d962c227b3eaba30a872dbfb995db`** (`jaydoteth.eth`) | counterparties top edge, $378.4M in=out |
| First Funder | `0x03634d32…b75f1c` | **`0x036cec1a199234fc02f72d29e596a09440825f1c`** | related-wallets, funding tx `2023-03-13T09:12:23Z` |
| Balancer Vault | `0xba13780f…32f2c8` | **`0xba12222222228d8ba445958a75a0704d566bf2c8`** (`balancervault.eth`) | counterparties, $355.0M |

The validated Balancer Vault (`0xba1222…f2c8`) is the canonical Balancer V2 Vault; the brief's variant is not a real deployed address. **Action for reviewer:** confirm we lock the validated addresses. No fabricated specifics are carried into the spec.

---

## 1. Product definition

**TRACE is an event-first onchain incident reconstruction engine.** You start from a known incident and TRACE answers: *what happened, in what sequence, and what evidence connects each step.*

**The timeline is primary. The graph is supporting evidence.** TRACE is explicitly **not** Bubblemaps, a wallet explorer, a token dashboard, a generic tx visualizer, a chatbot, or a trading agent. The core logic is **deterministic** — no LLM decides what happened, and TRACE never claims causation.

Three things the first screen must communicate instantly:
1. **Something happened** — the incident name + one-line thesis.
2. **When** — the chain and bounded time window.
3. **What TRACE found** — a small band of measurable, provenanced facts.

Then the user investigates: timeline → event → evidence → follow the money → relationships → replay → reconstruction.

---

## 2. User journey (hero path)

```
OPEN TRACE
  → SELECT EULER INCIDENT           (Command Center; MVP ships exactly one live case)
  → INVESTIGATION LOADS             (deterministic reconstruction from cached fixtures)
  → INCIDENT SUMMARY                (headline + measurable facts band)
  → TIMELINE                        (chronological, primary UI, dominant)
  → SELECT EVENT                    (opens Evidence Inspector)
  → EVIDENCE INSPECTOR              (type, time, entities, value, tx refs, Nansen data, provenance)
  → FOLLOW THE MONEY                (focus entity → next movement → advance timeline → update graph)
  → RELATIONSHIP VIEW               (supporting entity connections, investigation-scoped only)
  → REWIND / REPLAY                 (play observed evidence in order; never fabricate state)
  → FINAL RECONSTRUCTION            (summary of the reconstructed sequence + honest data gaps)
```

Every arrow is a state transition on one `Investigation` object (§ types). No step requires a network call at demo time — the case is reconstructed from cached Nansen fixtures.

---

## 3. Information architecture

Single-case, single-page investigation workspace. Three persistent regions plus two overlays.

```
┌───────────────────────────────────────────────────────────────────────┐
│ HEADER  incident name · chain · time window · status · replay controls  │
├──────────────────────────────────┬────────────────────────────────────┤
│ SUMMARY band (measurable facts, FACT/DERIVED only)                      │
├──────────────────────────────────┬────────────────────────────────────┤
│                                   │                                     │
│  TIMELINE  (PRIMARY, dominant)    │  EVIDENCE INSPECTOR  (selected event)│
│  vertical, chronological          │  type·time·entities·value·tx·       │
│  primary events large,            │  Nansen data·PROVENANCE breakdown    │
│  collapsed events condensed       │                                     │
│                                   ├─────────────────────────────────────┤
│                                   │  RELATIONSHIP VIEW  (supporting)     │
│                                   │  small graph, case-scoped entities   │
│                                   │  highlights edges for selected event │
└──────────────────────────────────┴─────────────────────────────────────┘
```

**Layout law:** the timeline column is always the widest and tallest region. The graph never becomes a full-bleed canvas. Overlays: Command Center (before a case is chosen) and Final Reconstruction (end-of-replay summary).

---

## 4. Investigation (data) model

Canonical composition — **CASE → TIME WINDOW → EVENTS → ENTITIES → RELATIONSHIPS → EVIDENCE** — is already defined in [`src/types/investigation.ts`](../src/types/investigation.ts). Summary of the object graph:

- **`Investigation`** — id, name, chain, `window`, `status`, `headline`, `summary: SummaryMetric[]`, `events`, `entities`, `relationships`, `dataGaps`, `sources`, `reconstructedAt`.
- **`TraceEvent`** ([events.ts](../src/types/events.ts)) — the primary unit. Answers *what/when/who/how-much/why-included/what-evidence/what-provenance*: `type`, `title`, `timestamp`, `order`, `participants`, `value`, `txHash`, `method`, `significance`, `admissionRule`, `primary`, `relationshipIds`, `provenance`, `annotations[]`.
- **`Entity`** ([entities.ts](../src/types/entities.ts)) — `kind`, `address`, `displayName`, `labels`, `role`, `admissionReason`, `provenance`. Interpretive roles (`attacker`/`beneficiary`) carry HYPOTHESIS provenance.
- **`Relationship`** ([relationships.ts](../src/types/relationships.ts)) — graph edge; `kind`, `from/toEntityId`, `metrics`, `nansenRelation`, `evidenceEventIds`, `provenance`.
- **`Provenance`** ([provenance.ts](../src/types/provenance.ts)) — discriminated union `DirectProvenance | DerivedProvenance | HypothesisProvenance` with `SourceRef` (endpoint, requestId, capturedAt, fieldPath, txHash).

The `Investigation` is the single serializable artifact the pipeline produces and the UI renders. It is fully deterministic from Nansen data + documented rules. **No new type files are needed for Phase 2** — the six existing files cover the model. Phase 3 may add derived view-model types, not domain types.

---

## 5. Event taxonomy

Seven event types (from [events.ts](../src/types/events.ts)), each earns its place in the Euler reconstruction — none added for completeness:

| Type | What it captures | Nansen source | Default provenance |
| --- | --- | --- | --- |
| `funding` | an address is funded before activity | related-wallets ("First Funder") | RELATION |
| `transfer` | value moves between two entities | transfers / transactions | FACT |
| `swap` | a DEX swap (token in/out, price at time) | dex-trades | FACT |
| `contract-interaction` | a method call of interest (flashloan, exploit method) | transactions (`method`) | FACT |
| `capital-consolidation` | many inflows converge on one entity | derived grouping over transfers | DERIVED |
| `capital-dispersal` | one entity fans value out to many (incl. burn) | derived grouping over transfers | DERIVED |
| `entity-relationship` | a Nansen relation surfaces (funder / related-wallet) | related-wallets | RELATION |

Mapping to the Euler arc: `funding` (T-0) → `contract-interaction` (Balancer flashloan) → `contract-interaction`/`swap` (exploit, mint, drain, conversion) → `capital-dispersal` (outflows incl. `0x000…` burn $150M) → `transfer` cluster (multi-day return). "Intent" is never an event type — it lives in `annotations` as HYPOTHESIS.

---

## 6. Evidence & provenance model

The differentiator. Every major output is auditable **CONCLUSION → EVENT → EVIDENCE**.

- **FACT** — `DirectProvenance{kind:'FACT', sources[], statement}`. Example: *"Nansen returned counterparty `balancervault.eth`, volume_in $355.0M, interaction_count 4."* `sources` points at `profiler/address/counterparties`, `fieldPath: data[n].volume_in_usd`, plus `requestId` + `capturedAt`.
- **DERIVED** — `DerivedProvenance{kind:'DERIVED', sourceEventIds[], calculation, inputs?}`. Example: `{ calculation: "net_flow", sourceEventIds: ["event_12","event_13"] }`. A DERIVED value must be recomputable from its `sourceEventIds` with no hidden inputs.
- **RELATION** — `DirectProvenance{kind:'RELATION', …}`. Example: *"Nansen reports `0x036cec…` as First Funder of the attacker EOA, evidence tx at 2023-03-13T09:12:23Z."* A relation is a link, **not** proof of common ownership.
- **HYPOTHESIS** — `HypothesisProvenance{kind:'HYPOTHESIS', statement, supportingEventIds[], confidence:'low'|'medium'}`. Example: *"The flashloan was plausibly drawn to fund the exploit."* Confidence is never "certain"; the UI renders it visually distinct and never in the summary band.

**UI contract:** each category has a fixed, distinct visual treatment (color + icon + label — see § visual design). The summary band accepts FACT/DERIVED only (enforced by `SummaryMetric.provenance`). Clicking any claim reveals its `sources`/`sourceEventIds` and lets the reviewer jump to the underlying event or fixture datum.

---

## 7. Reconstruction pipeline

Deterministic, no LLM, no causation. Stages:

```
Nansen API
  → raw response            (client.ts; captures X-Request-Id, credit + rate-limit headers)
  → validation              (shape-check against src/nansen/types.ts; reject/flag malformed)
  → normalization           (each endpoint row → common intermediate shape; ISO-UTC timestamps, USD numbers)
  → event extraction        (rows → TraceEvent candidates, one rule per event type)
  → significance scoring     (deterministic score; decides primary vs collapsed)
  → relationship extraction  (counterparty/related-wallet/transfer edges → Relationship[])
  → chronological ordering   (sort key below)
  → evidence attachment       (SourceRef per FACT/RELATION; sourceEventIds per DERIVED)
  → Investigation case        (assembled, serialized, cached)
```

**Deterministic rules (fixed for the MVP):**

- **Meaningful event** — admitted to the case if any: value ≥ threshold (`$1M` default for the Euler window), OR carries a Nansen relation, OR is a `contract-interaction` whose `method` is on the interest list (flashloan/exploit/swap), OR is the burn address sink.
- **Primary vs collapsed** — `primary = significance ≥ P` (tunable). Below-threshold events remain in `events[]` with `primary:false` (available, not shown by default). No event is silently dropped.
- **Significance score** — deterministic function of: normalized USD value (log-scaled), relation presence (+), method-of-interest (+), burn/consolidation sink (+), first/last-in-window (+). Documented as a pure function in Phase 3; identical inputs → identical score.
- **Grouping** — N inflows to one entity within the window collapse into one `capital-consolidation`; one entity → M recipients collapses into `capital-dispersal`. Grouping is DERIVED and always expandable to its member events.
- **Value calc** — USD values are FACT when Nansen returns them; TRACE-computed sums/nets are DERIVED with `calculation` named.
- **Ordering** — sort by `(timestamp, txIndex, logIndex)`; ties broken by stable `order` integer. `transactions` returns latest-first, so pagination to `2023-03-13` is required (known gap, surfaced in `dataGaps`).
- **Relevant entities** — see § graph admission rules.
- **Primary timeline membership** — `primary === true`.

No stage infers *why*. Interpretations are attached only as HYPOTHESIS annotations.

---

## 8. Screen specifications

For each: purpose · layout · hierarchy · components · interactions · data · loading · empty · error.

### A. Command Center / Incident Selection
- **Purpose:** choose an incident. MVP ships exactly one live case (Euler); others shown as "coming soon".
- **Layout:** centered TRACE wordmark + tagline "Something happened. TRACE reconstructs how it happened." over a list of `IncidentDescriptor` cards.
- **Hierarchy:** wordmark → hero incident card (available) → dimmed future cards.
- **Components:** incident card (name, chain, window, one-line, status pill).
- **Interactions:** click available card → load Investigation View.
- **Data:** `IncidentDescriptor[]` (static manifest; only Euler `available:true`).
- **Loading:** skeleton cards. **Empty:** never empty (manifest is static). **Error:** if manifest fails, show retry; no fabricated cases.

### B. Investigation View (most important — see §9)
- **Purpose:** reconstruct and explore the sequence. **Timeline dominates.**
- **Data:** one full `Investigation`.
- **Loading:** header + summary render first; timeline streams events in `order`; graph renders last. **Empty:** if 0 primary events, show "no events cleared the significance threshold" + link to collapsed events (never a blank canvas). **Error:** partial reconstruction banner listing `dataGaps`; render what resolved.

### C. Event Detail / Evidence Inspector (see §10)
- **Purpose:** show all evidence + provenance for one event.
- **Data:** selected `TraceEvent` + its `Relationship[]` + `Provenance`.
- **Loading:** inline (data already in case). **Empty:** "select an event" placeholder. **Error:** if an event references a missing source, show the gap explicitly.

### D. Relationship View (see §12)
- **Purpose:** supporting graph of case-scoped entities/edges.
- **Data:** `entities[]` + `relationships[]`, filtered to the selected event's neighborhood on demand.
- **Loading:** fade-in after timeline. **Empty:** "no relationships for this event." **Error:** degrade to entity list.

### E. Replay Mode (see §11)
- **Purpose:** play the observed evidence sequence in time order.
- **Data:** ordered `events[]` + a replay cursor.
- **Loading:** disabled until case ready. **Empty:** disabled if <2 events. **Error:** pause + surface gap.

### F. Investigation Summary (Final Reconstruction)
- **Purpose:** end-state recap — the reconstructed sequence, key facts, honest gaps.
- **Layout:** numbered step list (primary events) + summary metrics + `dataGaps` block + "every claim links to evidence" affordance.
- **Data:** whole `Investigation`.
- **Loading/empty/error:** mirrors Investigation View.

---

## 9. Investigation View (detailed)

Regions, top to bottom, timeline dominant:

- **HEADER** — incident name, chain badge, time range (`2023-03-13 → 2023-03-31 UTC`), `status` pill (`reconstructed`/`partial`/`error`), replay transport.
- **SUMMARY** — `SummaryMetric[]` as a compact band: e.g. *Peak value moved* (FACT), *Steps reconstructed* (DERIVED), *Entities involved* (DERIVED), *Window* (FACT). FACT/DERIVED only.
- **TIMELINE (primary)** — vertical, chronological, visually dominant. Primary events are full cards (time, title, value, entity chips, provenance dot); collapsed groups render condensed with an expand affordance. Selected event is emphasized; replay cursor is a moving marker.
- **EVIDENCE** (right, upper) — Evidence Inspector for the selected event.
- **RELATIONSHIP VIEW** (right, lower) — small supporting graph; highlights the selected event's edges.

**Explicit anti-requirement:** no giant bubble-map canvas as the primary UI. The graph is contained in a subordinate panel.

---

## 10. Evidence Inspector (detailed)

On event selection, show in order: **EVENT TYPE · TIMESTAMP · ENTITIES · VALUE · TRANSACTION / DATA REFERENCES · NANSEN DATA · PROVENANCE.**

Provenance section renders each category distinctly, e.g.:

```
FACT        Nansen returned counterparty balancervault.eth — volume_in $355.0M, interaction_count 4.
DERIVED     $355.0M net moved between attacker EOA and Balancer Vault within the window.  [net_flow of event_04,event_05]
RELATION    Nansen reports 0x036cec… as "First Funder" of the attacker EOA (evidence tx 2023-03-13T09:12:23Z).
HYPOTHESIS  The flashloan was plausibly drawn to fund the exploit.  (confidence: low)
```

Each row is expandable to its `SourceRef` (endpoint, `requestId`, `capturedAt`, `fieldPath`, `txHash`) or `sourceEventIds`. TX references deep-link to a block explorer in a new tab. HYPOTHESIS rows are always last and visually quarantined.

---

## 11. Follow-the-Money & Replay

### Follow the Money
On selecting a meaningful transfer, a single "Follow money" action performs, in order:
1. **Focus** the relevant entity (highlight in graph + timeline).
2. **Highlight** the next relevant movement (next `event.order` involving that entity along the flow).
3. **Move** the timeline position (scroll + cursor to that event).
4. **Update** the Evidence Inspector to the new event.
5. **Highlight** the corresponding relationship edge.

Feels like following a case, not panning a graph. It walks the deterministic flow; it never invents a hop.

### Replay
Replays **only known/derived events in chronological order** — it must **not** fabricate historical state (no reconstructed balances TRACE didn't observe). Controls: **play · pause · previous · next · scrubber · current timestamp.** At any cursor position the UI represents exactly *"what TRACE observed in the evidence sequence up to this point"* — a caption states this. Events after the cursor are dimmed. Reaching the end opens the Final Reconstruction.

---

## 12. Graph rules

The graph is **supporting evidence**, case-scoped. Entity kinds: `wallet`, `contract`, `exchange`, `protocol`, `token`, `cluster`. Edge kinds: `transfer`, `swap`, `funder`, `counterparty`, `related-wallet`, `flow`.

**Admission rules — an entity enters the graph only if it:**
1. is the case subject (attacker EOA), OR
2. is a counterparty above the value threshold in-window, OR
3. is the target of a Nansen relation (funder / related-wallet), OR
4. is a named sink (burn `0x000…`, consolidation target), OR
5. is a protocol/contract directly interacted with (Balancer, Euler aTokens, wstETH/WETH).

Explicitly excluded: decorative nodes, hundreds of irrelevant addresses, bubble clusters, generic wallet-explorer fan-out. Each admitted entity records its `admissionReason`. Edges carry `provenance` and `evidenceEventIds` so any edge is traceable back to events.

---

## 13. Visual design system

Distinctive **forensic / investigation** aesthetic — evidence board, not crypto dashboard.

- **Mode:** dark, high information density, restrained motion.
- **Palette:** near-black surfaces (`#0B0E11`-ish), desaturated slate panels, one cold accent (investigative blue/cyan) for focus/selection. **Provenance colors are reserved and fixed:** FACT = neutral/white, DERIVED = cyan, RELATION = amber, HYPOTHESIS = muted violet with a dashed/quarantined treatment. These four are never reused for decoration.
- **Typography:** strong type hierarchy; monospace for addresses, hashes, timestamps, and numeric values (forensic legibility + alignment); humanist sans for labels/prose.
- **Temporal hierarchy:** time is the dominant visual axis; the timeline reads top-to-bottom, events past the replay cursor are dimmed.
- **Motion:** restrained — cursor movement, focus transitions, expand/collapse. No decorative 3D, no neon glow, no bubble physics.
- **Communicates:** INVESTIGATION · EVIDENCE · TIMELINE · TRACE. Not "analytics dashboard."

(Reference study via the `inspo` MCP is appropriate at Phase-3 UI kickoff — dark editorial/forensic direction — but the project's own tokens win once defined.)

---

## 14. System architecture

```
Frontend (UI)                 ← renders one Investigation; timeline-primary
  ↓
Application / API layer        ← serves reconstructed cases; no key in client
  ↓
Reconstruction engine          ← deterministic pipeline (§7); no LLM
  ↓
Normalization                  ← endpoint rows → intermediate shape
  ↓
Nansen client                  ← server-side; apikey from env; captures credit/rate headers  [EXISTS: src/nansen]
  ↓
Cache / fixture layer          ← (path, body-hash) cache; reproducible offline demo
```

**Module boundaries (conceptual — do not build yet):**

```
src/
  nansen/          EXISTS — client.ts, types.ts (server-side calls, typed boundaries)
  types/           EXISTS — conceptual domain model (Phase 2 deliverable)
  reconstruction/  Phase 3 — extraction, scoring, ordering, grouping (pure functions)
  investigations/  Phase 3 — case assembly + the Euler case manifest
  evidence/        Phase 3 — provenance attachment + audit helpers
  entities/        Phase 3 — entity admission + labeling
  api/             Phase 3 — thin server routes serving Investigation JSON
  ui/              Phase 3 — investigation workspace (timeline-primary)
```

Principles: key strictly server-side (already enforced); cache by `(path, body-hash)` for reproducible, credit-free demos; the `Investigation` is the only contract the UI depends on; do not over-engineer (no database required for the MVP — cached JSON fixtures suffice).

**Frontend stack — open decision (§17).** Phase 1 chose zero-dependency Node+TS deliberately; a timeline-primary investigative UI likely warrants a light framework. Flagged, not decided.

---

## 15. API / data flow

- **Read path (demo):** UI → API route → cached `Investigation` JSON (built from fixtures). Zero live credits at demo time.
- **Build path (authoring the case):** reconstruction engine → Nansen client → live endpoints (counterparties 5cr, transactions 1cr, related-wallets 1cr ≈ **9 credits** total per `hero-event.json`) → normalize → assemble → cache. Run deliberately, not on page load.
- **Credit/rate governance:** honor `Retry-After`, self-throttle on remaining rate-limit headers, refuse the 100/500-credit `labels` endpoint without explicit opt-in (labels arrive inline for free). Capture `X-Request-Id` + `X-Nansen-Credits-*` into each `SourceRef`/case `sources`.
- **Provenance capture:** every FACT/RELATION records endpoint + `fieldPath` + `requestId` + `capturedAt`; historical data is revisable, so `capturedAt` is mandatory.

---

## 16. Error & loading states (cross-cutting)

- **Loading:** header + summary first, timeline streams by `order`, graph last. Skeletons, never spinners-over-blank.
- **Partial (`status:'partial'`):** render resolved events; show a banner enumerating `dataGaps` (e.g. "transactions paginated latest-first — exploit-day rows require page N", "mixer hop — chain break shown, not inferred").
- **Error (`status:'error'`):** show what resolved + a retry for the build path; never fabricate to fill a gap.
- **Honest breaks:** cross-chain/mixer hops render as an explicit broken edge with a "trace breaks here" marker — never papered over.

---

## 17. Phase 3 implementation plan

1. **Cache/fixture layer** over the existing client — `(path, body-hash)` keyed; capture full provenance headers. *(no new deps)*
2. **Normalization** — endpoint rows → intermediate shape; unit tests against captured fixtures.
3. **Reconstruction engine** — pure functions: extraction → significance → grouping → ordering → relationship extraction → evidence attachment. Deterministic; snapshot-tested against `hero-event.json`.
4. **Euler case authoring** — run the ~9-credit sequence once, assemble the `Investigation`, freeze it as a cached case + fixture.
5. **API layer** — thin routes serving `Investigation` JSON (key stays server-side).
6. **UI** — Command Center → Investigation View (timeline-primary) → Evidence Inspector → Relationship View → Replay → Final Reconstruction. Build in that order; timeline before graph.
7. **Provenance UI enforcement** — the four categories render distinctly; summary band rejects HYPOTHESIS at the type boundary.
8. **Verification** — deterministic reconstruction test (same fixtures → identical `Investigation`), provenance-completeness test (no rendered claim lacks provenance), demo dry-run (§18) under 60s offline.

**Build order rationale:** data correctness (1–4) before surface (5–6); timeline before graph; provenance woven throughout, not bolted on.

---

## 18. Demo flow (30–60s, silent)

| Time | On screen |
| --- | --- |
| 0–5s | TRACE wordmark + "Euler Finance exploit and fund return", chain + window |
| 5–12s | Investigation loads; summary band fills with measurable facts |
| 12–25s | Timeline reconstructs the sequence top-to-bottom (funding → flashloan → drain → dispersal → return) |
| 25–35s | Select the flashloan/drain event → Evidence Inspector shows FACT/DERIVED/RELATION/HYPOTHESIS |
| 35–45s | "Follow the money" walks attacker → conversion → burn/return, advancing the timeline |
| 45–55s | Replay plays the observed sequence with the cursor + timestamp |
| 55–60s | Final Reconstruction: numbered steps + honest data gaps |

Must read without narration: the interface itself communicates investigation, evidence, sequence.

---

## 19. MVP boundary

**MUST HAVE:** Euler investigation · Nansen live integration (build path) · normalized data · deterministic reconstruction · timeline · evidence inspector · follow-the-money · supporting relationship graph · replay · final summary.

**DO NOT BUILD:** auth · social · autonomous agents · AI-generated investigations · trading · arbitrary multi-chain · notifications · collaboration · massive graph analytics · unnecessary database infrastructure.

---

## 20. Unresolved architectural decisions (for reviewer)

1. **Hero addresses** — confirm we lock the **live-validated** addresses (§0), not the brief's unverified ones.
2. **Frontend stack** — Phase 1's zero-dependency Node+TS vs. a light framework (e.g. a minimal React/Vite or Svelte app) for the timeline-primary UI. Recommendation: a minimal framework for the UI only, keeping the server/client/engine dependency-free. Needs sign-off.
3. **Case storage** — cached JSON files (recommended, no DB) vs. any persistence. Recommendation: files.
4. **Significance thresholds** — the `$1M` value floor and primary-timeline cutoff `P` are proposed defaults; confirm or tune against the real Euler data during case authoring.
5. **Data redistribution** — Nansen redistribution guidelines must be cleared before any public-facing demo (Phase 1 §11 item 3, still open).
6. **Replay granularity** — event-level only (recommended) vs. any sub-event interpolation. Recommendation: event-level, to avoid fabricated intermediate state.
```
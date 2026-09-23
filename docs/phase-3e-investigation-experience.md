# TRACE — Phase 3E: Investigation Experience

**Status:** Complete. Interactive workflow only — no replay, live capture, AI, graph-heroics, or Phase 3F work.
**Date:** 2026-09-22
**Depends on:** Phases 3A–3D (locked). The InvestigationContract remains the only application data source; no contract, type, fixture, or engine-logic changes were needed or made.
**API calls this phase:** **0** (+0 credits).

---

## 1. Interaction model

One workflow, one state object:

```
SELECT EVENT → INSPECT EVIDENCE → FOLLOW MONEY → NEXT MOVEMENT → RELATIONSHIP
```

- **Timeline → Inspector:** clicking any event (or group member, or evidence chip) selects it; the inspector renders that selection's evidence.
- **Timeline → Graph:** the graph re-centers on the selected event's observed entity and subtly highlights that event's edges.
- **Graph → Inspector / Timeline:** clicking a node selects the entity (inspector entity mode; timeline highlights every observed event involving it). Clicking an edge selects the relationship (inspector relationship mode; timeline highlights its evidence events).
- **Follow money:** the inspector's Follow button advances selection one observed hop along the tracked address, marks both ends with a trail ("Followed from here → #n" / "← Followed from #n" + "Back to …"), and re-centers the graph. Any manual selection clears the trail.
- No competing models: `selection: {kind: event|entity|relationship, id}` plus transient UI flags (expanded groups, collapsed toggle, trail) is the entire state.

## 2. Follow-money algorithm (`lib/follow.ts`)

Pure, deterministic, contract-only:

1. **Entity rule** — preferred participant side `to → from → actor → counterparty`. The money's destination leads (funding → subject; transfer → recipient; swap → trader).
2. **Candidate rule** — observed member events later in final timeline order involving the same address. DERIVED groups are never targets; counterparty aggregates create no events and therefore can never fabricate a hop.
3. **Dead end** — renders verbatim: `No subsequent supported movement in captured evidence.`
4. No causality is implied: adjacency is chronological involvement of one address, labeled as such ("Next chronological observed event involving this address. No hop is invented.").

Euler trail (pinned by test): `event_001 → 002 → 003 → 005 → 006 → 008 → dead-end`, all on the subject address.

## 3. Graph semantics (`lib/graph.ts`, `EvidenceGraph.tsx`)

- **Neighborhood only**: the focused entity plus entities sharing a SUPPORTED edge (`transfer`, `swap`, `funder`, `related-wallet`, `counterparty`). Flow/DERIVED edges excluded by kind filter AND provenance guard.
- **Direction where supported**: directed edges get arrows; counterparty aggregates render dashed/undirected with "Undirected window aggregate — direction is not evidenced."
- **Density**: every edge shows kind, direction glyph, and evidence count; a textual connection list duplicates the SVG (keyboard path + screen-reader path; every node/edge is Tab-focusable with Enter/Space).
- **Empty state**: unknown/isolated focus renders "No directly observed relationships for this entity in captured evidence." — never invented edges.
- The graph is subordinate: small panel under the inspector, timeline stays dominant.

## 4. Evidence boundaries (unchanged, re-asserted)

FACT → "Observed", RELATION → "Reported relationship" (relations quoted as reported links, never control proof), DERIVED → "Derived" (groups expandable to members; flow edges excluded from the graph; net-USD labeled "derived"). No HYPOTHESIS channel exists. Incomplete-evidence treatment untouched (STATUS/COMPLETENESS split, banner, gaps).

## 5. Test results

`npm test` — **63/63 pass** (~2s): 54 existing + 9 new (`test/follow.test.ts` F1–F5, `test/graph.test.ts` G1–G4):

| Area (brief §TESTING) | Test | Result |
| --- | --- | --- |
| 1. correct next event | F1 funding → event_002 on subject | pass |
| 2. empty state | F2 dead-end + exact sentence; G3 empty graph | pass |
| 3. never crosses unsupported | F3 synthetic X/Y isolation; groups never targets | pass |
| 4. deterministic selection | F2 repeat-walk identical; G1 rebuild identical; default-selection rule | pass |
| 5. graph only supported | G1 kinds ⊆ supported, no flow, edges touch focus | pass |
| 6. DERIVED stays marked | G2 zero DERIVED edges; undirected counterparty preserved | pass |
| 7. node → context | G4 focus/events/entity-id resolution (powers highlight+inspector) | pass |
| 8. repeated interaction identical | F2 walk equality; C-IDS-2 contract equality | pass |
| 9. existing green | full suite | 63/63 pass |

`npx tsc --noEmit` clean. `npm run build` succeeds (same route table as 3D).

## 6. Manual verification

Live (`next start`, curl) — case page (~90KB) contains: Follow button for event_001, RELATIONSHIP GRAPH section, "Observed relationships only", Follow-the-money block, context strip, all Phase-3D content intact. API determinism + 404 behavior re-verified unchanged.

Human pass required (no browser automation in this environment):
- [ ] Follow walk end-to-end (001→…→008→dead-end sentence), trail marks + Back link.
- [ ] Node/edge clicks update inspector + timeline highlight; Enter/Space work on SVG nodes/edges.
- [ ] Group expansion + member selection; collapsed toggle; pending-link indicator.
- [ ] Narrow viewport; focus rings; zero console errors. (SSR output proves all render paths; these cover pointer/keyboard behavior.)

## 7. Files

**Created:** `lib/follow.ts`, `lib/graph.ts`, `components/EvidenceGraph.tsx`, `components/ContextStrip.tsx`, `test/follow.test.ts`, `test/graph.test.ts`, `docs/phase-3e-investigation-experience.md`.
**Modified:** `components/InvestigationView.tsx` (single state model + strip + graph placement), `components/Timeline.tsx` (highlight/trail props), `components/EvidenceInspector.tsx` (entity/relationship modes + follow section), `app/globals.css` (strip/rail/graph/highlight styles), `README.md` (status line).

## 8. Limitations / contract notes

- No contract limitation was hit: every interaction (follow targets, graph edges, inspector modes, context counts) resolves from existing fields. No contract change made.
- Follow tracks one address; cross-entity "hops" (A→B→C) emerge naturally by re-following from each arrival, which is honest: each step names its tracked address.
- Dense neighborhoods (subject: ~18 neighbors) render compactly but are busy — the textual connection list carries the same information accessibly.
- `next dev` + browser interaction pass left to the human checklist (§6).

**STOP.** Phase 3F not started. No replay, live capture, or AI added.

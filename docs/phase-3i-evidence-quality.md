# TRACE — Phase 3I: Evidence Quality + Visual Polish

**Status:** Complete. Presentation only — no semantics, features, data, or rule changes; no Phase 3J work.
**Date:** 2026-09-22
**Depends on:** Phases 3A–3H (locked). Served case unchanged (30 events / 12 primary / 30 entities / 37 relationships, mixed-source, `reconstructed`/`incomplete`).
**Live calls this phase:** **0** (+0 credits).

---

## 1. Hierarchy fix (the one structural change)

Page order is now INCIDENT → EVIDENCE STATUS → SEQUENCE → CURRENT EVIDENCE → RELATIONSHIPS → REPLAY: the incident summary (H1) moved above the status banner (previously banner-first). The banner stays in the first viewport, still persistent and amber-edged. Context strip, timeline-dominant grid, inspector→graph rail, replay block, and gaps panel are otherwise unmoved.

## 2. Evidence classification treatment

- Event-type pills tinted by family — movement neutral, reported-link amber, derived-group cyan — mirroring (never replacing) the Observed / Reported relationship / Derived badges.
- Inspector panel carries a 3px provenance-tinted edge per mode (neutral FACT, amber RELATION, cyan DERIVED).
- DERIVED groups, mixed-source marking, and expandability behavior are byte-for-byte the Phase 3H logic; only their visual weight changed.

## 3. Source treatment

Source-origin renders as neutral outline chips (`fixture-cache`, `live-nansen`, `mixed`, `unavailable`) — deliberately unranked, since live evidence is not automatically complete. Raw pool values stay in the UI next to human labels. No pool gets a "better" color.

## 4. Incomplete-evidence treatment

Unchanged rule, stronger frame: banner (STATUS vs COMPLETENESS chips + exact limitation sentence + expandable reasons), replay gap notes, and the gaps/limitations lists now sit in a bordered panel so missing evidence reads as content, not whitespace. "Reconstructed" is never styled as "complete".

## 5. Timeline, inspector, graph, replay polish

- Tabular numerals on all evidence figures; value lines semibold (scannable, no importance labels — none exist in the contract).
- Selected cards gain a background tint in addition to the accent border and cursor inset.
- Inspector rows tightened; graph neighbor nodes enlarged for pointer/keyboard targets.
- Replay scrubber promoted to its own full-width row; Play keeps its distinct treatment.
- Mobile padding reduced; stacking order already timeline → inspector → graph.

## 6. Accessibility checks (static audit + unit-tested mapping)

- Every click handler lives on a `<button>`/`<a>`/`<input>` or an SVG `<g role="button" tabindex>` with Enter/Space handling; labeled controls throughout (event/member/edge/node/follow/replay/scrubber).
- Global `:focus-visible` ring incl. SVG nodes; graph has a full textual connection-list equivalent; replay key map is unit-tested (`replayKeyAction`).
- `--faint` lifted to `#82909e` (~5.7:1 on background) for 11–12px labels; body/muted already ≥7:1.
- `:hover` rules are decorative only; no interaction depends on hover.
- Human pass still required: full keyboard walk, screen-reader run, console check (no automation available here).

## 7. Responsive checks

960px breakpoint stacks grid and un-sticks the inspector; 640px trims page padding; hashes wrap (`break-all`); scrubber and toggles are full-width. Narrow-viewport human pass remains on the checklist.

## 8. Tests, typecheck, build, verification

`npm test` **87/87 pass** (no new tests: zero behavior changed — all edits are markup/CSS/class order). `tsc --noEmit` clean. `npm run build` succeeds (same route table). Live (`next start`, curl): expanded page (~172KB) contains the new family classes, tinted inspector, source chips, selected state, and all prior content (timeline, inspector, graph, replay, banner, gaps); API + 404 behavior unchanged.

## 9. Limitations

- No browser-run verification of pointer/keyboard/console in this environment (checklist §6–7).
- Dense live neighborhoods still render busy; the connection list remains the accessible primary path.
- Contrast ratios computed by hand from hex values, not measured in-browser.

**STOP.** Phase 3J not started. No data, semantics, or rules touched.

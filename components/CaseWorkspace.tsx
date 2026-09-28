'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight, Check, ChevronRight, CircleHelp, Clock3, Database, ExternalLink,
  Hash, Pause, Play, RotateCcw, SkipBack, SkipForward, Wrench,
} from 'lucide-react';
import Link from 'next/link';
import type { InvestigationContract } from '@/src/contract/types.ts';
import type { Provenance } from '@/src/types/provenance.ts';
import { DERIVED_EVENT_TYPES, EVENT_STYLE, entityById, sideLabel } from '@/components/CaseVisuals.tsx';
import { fmtAmount, fmtTimestamp, fmtUsd, fmtWindow, shortAddr } from '@/components/format.ts';
import { FOLLOW_DEAD_END, followFromEvent } from '@/lib/follow.ts';
import { GAP_THRESHOLD_MS, formatGap, prevGapMs } from '@/lib/replay.ts';
import { eventOrigin, originLabel } from '@/lib/sources.ts';
import { buildNansenAuthority } from '@/lib/nansen-authority.ts';

const PROV_LABEL: Record<string, string> = {
  FACT: 'SOURCE FACT', RELATION: 'RELATION', DERIVED: 'DERIVED', HYPOTHESIS: 'HYPOTHESIS',
};

/** CSS class suffix; HYPOTHESIS (never in a valid contract) borrows derived styling. */
function kindClass(p: Provenance): string {
  return p.kind === 'HYPOTHESIS' ? 'derived' : p.kind.toLowerCase();
}

export function CaseWorkspace({ contract }: { contract: InvestigationContract }) {
  const inv = contract.investigation;
  const events = useMemo(() => {
    const primary = inv.events.filter((e) => e.primary);
    const base = primary.length ? primary : inv.events;
    return [...base].sort((a, b) => a.order - b.order);
  }, [inv.events]);
  const authority = useMemo(() => buildNansenAuthority(contract), [contract]);

  const [selected, setSelected] = useState(0);
  const [playing, setPlaying] = useState(false);
  const total = events.length;
  const active = events[selected];

  useEffect(() => {
    if (!playing || total === 0) return;
    const timer = window.setInterval(() => {
      setSelected((i) => {
        if (i >= total - 1) { setPlaying(false); return i; }
        return i + 1;
      });
    }, 1600);
    return () => window.clearInterval(timer);
  }, [playing, total]);

  if (!active) {
    return (
      <div className="page-wrap not-found">
        <div className="eyebrow">EMPTY CASE</div>
        <h1>No events to walk.</h1>
        <p>This case has no primary timeline events to display.</p>
        <Link href="/" className="button button-primary">Back to investigations <ArrowRight size={16} aria-hidden="true" /></Link>
      </div>
    );
  }
  const prov = active.provenance;
  const follow = followFromEvent(contract, active.id);
  const isDerivedGroup = DERIVED_EVENT_TYPES.has(active.type);
  const followTargetId = !isDerivedGroup && follow?.kind === 'followed' ? follow.step.toEventId : null;
  const followIndex = followTargetId ? events.findIndex((e) => e.id === followTargetId) : -1;
  const origin = eventOrigin(contract, active.id);
  const originIsLive = origin === 'live-nansen';
  const complete = contract.completeness === 'complete';
  const noun = EVENT_STYLE[active.type].noun;
  const ReceiptIcon = EVENT_STYLE[active.type].Icon;
  const value = active.value;
  const moveTo = (i: number) => setSelected(Math.max(0, Math.min(total - 1, i)));

  return (
    <div className="page-wrap case-page">
      <div className="breadcrumbs"><Link href="/">Investigations</Link><span className="breadcrumb-slash">/</span><span>{inv.name}</span></div>

      <section className="case-title-row">
        <div>
          <div className="eyebrow">CASE REVIEW <span className="eyebrow-separator">/</span> {inv.chain.toUpperCase()}</div>
          <h1>{inv.name}</h1>
          <p className="case-subtitle">{fmtWindow(inv.window)} <span className="middot">·</span> Evidence trail</p>
        </div>
        <span className={`coverage-badge${complete ? ' is-complete' : ''}`} title={contract.completenessReasons.join(' · ') || undefined}>
          <span className="coverage-ring" /> {complete ? 'Complete' : 'Incomplete'}
        </span>
      </section>

      <div className="case-metrics">
        <div className="metric"><span>Primary events</span><strong>{String(total).padStart(2, '0')}</strong><small>event records</small></div>
        <div className="metric"><span>Entities</span><strong>{String(inv.entities.length).padStart(2, '0')}</strong><small>case entities</small></div>
        <div className="metric"><span>Selected step</span><strong>{String(selected + 1).padStart(2, '0')}<small className="metric-total"> / {String(total).padStart(2, '0')}</small></strong><small>of event trail</small></div>
        <div className="metric metric-source"><span>Data origin</span><strong className={`source-value${contract.dataSource === 'live-nansen' ? ' is-live' : ''}`}><span className="origin-dot" /> {contract.dataSource === 'live-nansen' ? 'Live Nansen' : 'Fixture cache'}</strong><small>case source</small></div>
      </div>

      <div className="case-workspace">
        <section className="timeline-column" aria-labelledby="timeline-heading">
          <div className="timeline-heading-row">
            <div><div className="eyebrow">EVENT SEQUENCE</div><h2 id="timeline-heading">Follow the trail</h2></div>
            <div className="replay-controls" aria-label="Timeline controls">
              <button className="icon-button" aria-label="Start from first event" onClick={() => { setPlaying(false); moveTo(0); }}><SkipBack size={15} aria-hidden="true" /></button>
              <button className="play-button" aria-label={playing ? 'Pause replay' : 'Play replay'} onClick={() => setPlaying(!playing)}>{playing ? <Pause size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}</button>
              <button className="icon-button" aria-label="Select next event" onClick={() => { setPlaying(false); moveTo(selected + 1); }} disabled={selected >= total - 1}><SkipForward size={15} aria-hidden="true" /></button>
              <button className="icon-button" aria-label="Reset replay" onClick={() => { setPlaying(false); moveTo(0); }}><RotateCcw size={15} aria-hidden="true" /></button>
            </div>
          </div>
          <div className="timeline-progress" role="progressbar" aria-valuemin={1} aria-valuemax={total} aria-valuenow={selected + 1} aria-label={`Event ${selected + 1} of ${total}`}>
            <span style={{ width: `${((selected + 1) / total) * 100}%` }} />
          </div>
          <ol className="timeline-list">
            {events.map((ev, i) => {
              const state = i < selected ? 'is-done' : i === selected ? 'is-current' : 'is-ahead';
              const gap = i > 0 ? prevGapMs(events, i) : null;
              const showGap = gap != null && gap >= GAP_THRESHOLD_MS;
              const cls = kindClass(ev.provenance);
              return (
                <li key={ev.id}>
                  {showGap ? <div className="timeline-gap"><Clock3 size={11} aria-hidden="true" /> Evidence gap <span className="middot">·</span> {formatGap(gap!)}</div> : null}
                  <div className={`timeline-row ${state}`}>
                    <div className="timeline-rail">
                      <span className={`timeline-node node-${cls}`}>
                        {i < selected ? <Check size={11} strokeWidth={3} aria-hidden="true" /> : <span />}
                      </span>
                      {i < total - 1 ? <span className="timeline-connector" aria-hidden="true" /> : null}
                    </div>
                    <button type="button" className="event-button" aria-current={i === selected ? 'true' : undefined} onClick={() => { setPlaying(false); setSelected(i); }}>
                      <div className="event-topline">
                        <span className="event-step">STEP {String(i + 1).padStart(2, '0')}</span>
                        <span className={`provenance provenance-${cls}`}>{PROV_LABEL[ev.provenance.kind]}</span>
                      </div>
                      <div className="event-title">{ev.title}</div>
                      <div className="event-meta"><span>{EVENT_STYLE[ev.type].noun}</span><span className="middot">·</span><span>{fmtTimestamp(ev.timestamp)}</span></div>
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
          <div className="trail-end"><span className="trail-end-line" /> End of captured trail</div>
        </section>
        <aside className="receipt-panel" aria-label="Evidence receipt">
          <div className="receipt-kicker">
            <span className="receipt-icon"><ReceiptIcon size={14} aria-hidden="true" /></span>
            EVENT RECEIPT
            <CircleHelp size={13} aria-hidden="true" />
          </div>
          <span className={`provenance provenance-${kindClass(prov)}`}>{PROV_LABEL[prov.kind]}</span>
          <h2>{active.title}</h2>
          <p className="receipt-step">{noun} <span className="middot">·</span> {fmtTimestamp(active.timestamp)}</p>

          {value ? (
            <div className="receipt-value">
              <span>VALUE MOVED</span>
              <strong>{fmtAmount(value.amount, value.tokenSymbol)}</strong>
              <small>{value.valueUsd === null || value.valueUsd === undefined ? 'USD value not captured' : fmtUsd(value.valueUsd)}</small>
            </div>
          ) : null}

          {active.participants.length > 0 ? (
            <div className="receipt-section">
              <div className="receipt-section-label">WHO</div>
              <div className="who-list">
                {active.participants.map((p, i) => {
                  const ent = entityById(contract, p.entityId);
                  return (
                    <div className="who-row" key={`${p.entityId}-${i}`}>
                      <span className="who-side">{sideLabel(p.side).toUpperCase()}</span>
                      <span className="who-name">{ent?.displayName ?? p.entityId}{ent?.address ? <small>{shortAddr(ent.address)}</small> : null}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
          {prov.kind === 'FACT' || prov.kind === 'RELATION' ? (
            <div className="receipt-section">
              <div className="receipt-section-label">EVIDENCE STATEMENT</div>
              <p>“{prov.statement}”</p>
            </div>
          ) : prov.kind === 'DERIVED' ? (
            <>
              <div className="receipt-section">
                <div className="receipt-section-label">HOW DERIVED</div>
                <p>Computed via {prov.calculation}</p>
              </div>
              {prov.sourceEventIds.length > 0 ? (
                <div className="receipt-section">
                  <div className="receipt-section-label">DERIVED FROM</div>
                  <div className="input-chips">
                    {prov.sourceEventIds.map((eid) => {
                      const idx = events.findIndex((e) => e.id === eid);
                      const srcEv = contract.investigation.events.find((e) => e.id === eid);
                      return (
                        <button key={eid} type="button" disabled={idx < 0} onClick={() => { setPlaying(false); if (idx >= 0) moveTo(idx); }}>
                          <ChevronRight size={9} aria-hidden="true" /> {srcEv ? srcEv.title : eid}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
              {prov.inputs ? (
                <div className="receipt-section">
                  <div className="receipt-section-label">INPUTS</div>
                  <div className="derived-inputs">
                    {Object.entries(prov.inputs).map(([k, v]) => (
                      <div key={k}><span>{k}</span><span>{String(v)}</span></div>
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
          {(prov.kind === 'FACT' || prov.kind === 'RELATION') && prov.sources.length > 0 ? (
            <div className="receipt-section">
              <div className="receipt-section-label">EVIDENCE</div>
              {prov.sources.map((src, i) => (
                <div className="source-row" key={i}>
                  <span>{src.source}</span>
                  <strong>{src.origin === 'live-nansen' ? 'live' : src.origin === 'fixture-cache' ? 'fixture' : '—'} <span className="middot">·</span> {fmtTimestamp(src.capturedAt)}</strong>
                </div>
              ))}
            </div>
          ) : null}

          {active.annotations && active.annotations.length > 0
            ? active.annotations.map((a, i) => <div className="receipt-note" key={i}>{a.text}</div>)
            : null}

          {active.method || active.txHash ? (
            <div className="receipt-tags">
              {active.method ? <span><Wrench size={9} aria-hidden="true" /> {active.method}</span> : null}
              {active.txHash ? (
                inv.chain === 'ethereum'
                  ? <a href={`https://etherscan.io/tx/${active.txHash}`} target="_blank" rel="noreferrer"><ExternalLink size={9} aria-hidden="true" /> {shortAddr(active.txHash)}</a>
                  : <span><Hash size={9} aria-hidden="true" /> {shortAddr(active.txHash)}</span>
              ) : null}
            </div>
          ) : null}

          <div className={`origin-note${originIsLive ? ' is-live' : ''}`}>
            <span className="origin-dot" />
            <span>{originLabel(origin)}</span>
          </div>

          {!isDerivedGroup ? (
            <div className="receipt-follow">
              {followIndex >= 0 ? (
                <button type="button" className="button button-primary button-full" onClick={() => { setPlaying(false); moveTo(followIndex); }}>
                  Follow the money <ArrowRight size={14} aria-hidden="true" />
                </button>
              ) : (
                <p className="dead-end-note">{FOLLOW_DEAD_END}</p>
              )}
            </div>
          ) : null}
        </aside>
      </div>
      <section className="authority-panel" aria-labelledby="authority-heading">
        <div className="authority-head">
          <span className="authority-icon"><Database size={17} aria-hidden="true" /></span>
          <div>
            <div className="eyebrow">NANSEN AUTHORITY</div>
            <h2 id="authority-heading">What Nansen resolved</h2>
            <p>Identity, asserted relationships and pre-aggregated counterparty volume a raw block explorer can't provide — every figure recomputable from the served contract.</p>
          </div>
          <span className="authority-status">{authority.citationsTotal} citations</span>
        </div>
        <div className="authority-stats">
          <div className="authority-stat"><span>Entities named</span><strong>{authority.entitiesNamed}</strong><small>of {authority.entitiesTotal} resolved</small></div>
          <div className="authority-stat"><span>Relationships</span><strong>{authority.relations.length}</strong><small>asserted by Nansen</small></div>
          <div className="authority-stat"><span>Counterparty volume</span><strong>{fmtUsd(authority.totalCounterpartyVolumeUsd)}</strong><small>{authority.counterpartiesWithVolume} of {authority.counterpartiesTotal} priced</small></div>
          <div className="authority-stat"><span>Source citations</span><strong>{authority.citationsTotal}</strong><small>across the case</small></div>
        </div>
        {authority.namedSamples.length > 0 ? (
          <>
            <div className="authority-sub">IDENTIFIED ENTITIES</div>
            <div className="authority-chips">
              {authority.namedSamples.map((n) => (
                <span className="authority-chip" key={n.entityId}>{n.name}{n.address ? <small>{shortAddr(n.address)}</small> : null}</span>
              ))}
            </div>
          </>
        ) : null}
        {authority.topCounterparties.length > 0 ? (
          <>
            <div className="authority-sub">TOP COUNTERPARTIES</div>
            <div className="authority-chips">
              {authority.topCounterparties.map((c) => (
                <span className="authority-chip" key={c.id}>{c.name}<small>{fmtUsd(c.volumeUsd)}</small></span>
              ))}
            </div>
          </>
        ) : null}
        {authority.endpoints.length > 0 ? (
          <>
            <div className="authority-sub">ENDPOINTS QUERIED</div>
            <div className="authority-chips">
              {authority.endpoints.map((e) => (
                <span className="authority-chip" key={e.endpoint}>{e.endpoint}<small>{e.citations}</small></span>
              ))}
            </div>
          </>
        ) : null}
        {authority.relations.length > 0 ? (
          <>
            <div className="authority-sub">ASSERTED RELATIONSHIPS</div>
            <div className="authority-relations">
              {authority.relations.map((r) => (
                <div className="authority-relation" key={r.id}><b>{r.fromName}</b> <em>{r.nansenRelation}</em> <b>{r.toName}</b></div>
              ))}
            </div>
          </>
        ) : null}
      </section>
    </div>
  );
}

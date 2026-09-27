'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import {
  ChevronLeft, Play, Pause, SkipBack, SkipForward, RotateCcw, Check, Crown, Hourglass,
} from 'lucide-react';
import type { InvestigationContract } from '@/src/contract/types.ts';
import type { SummaryMetric } from '@/src/types/investigation.ts';
import { prevGapMs, formatGap, GAP_THRESHOLD_MS } from '@/lib/replay.ts';
import { canFollow, followFromEvent } from '@/lib/follow.ts';
import { EVENT_STYLE, PROV, ProvenanceTag } from './CaseVisuals.tsx';
import { EvidenceReceipt } from './EvidenceReceipt.tsx';
import { fmtWindow } from './format.ts';

/** Horizontal wiggle (px) that turns a vertical list into a Duolingo trail. */
const SERPENTINE = [0, 46, 66, 46, 0, -46, -66, -46];

function StatTile({ metric }: { metric: SummaryMetric }) {
  const dot = PROV[metric.provenance.kind].fg;
  return (
    <div className="card card-drop px-4 py-3 text-left">
      <div className="text-2xl font-black text-ink">
        {typeof metric.value === 'number' ? metric.value.toLocaleString('en-US') : metric.value}
        {metric.unit ? <span className="ml-1 text-sm font-bold text-wolf">{metric.unit}</span> : null}
      </div>
      <div className="mt-0.5 flex items-center gap-1.5 text-[12px] font-bold text-wolf">
        <span style={{ width: 7, height: 7, borderRadius: 999, background: dot, display: 'inline-block' }} />
        {metric.label}
      </div>
    </div>
  );
}

function GapMarker({ text }: { text: string }) {
  return (
    <div className="relative z-10 flex justify-center py-1.5">
      <span className="pill bg-white" style={{ borderColor: '#ffc800', color: '#b58900' }}>
        <Hourglass size={12} strokeWidth={3} /> Evidence gap · {text}
      </span>
    </div>
  );
}
function SealNode({ complete, reasons }: { complete: boolean; reasons: string[] }) {
  return (
    <li className="relative z-10 flex flex-col items-center pt-8">
      <div
        className="flex h-24 w-24 items-center justify-center rounded-full border-[3px]"
        style={complete
          ? { background: '#58cc02', borderColor: '#58a700', boxShadow: '0 6px 0 #58a700', color: '#fff' }
          : { background: '#fff', borderColor: '#e5e5e5', boxShadow: '0 6px 0 #e5e5e5', color: '#afafaf' }}
      >
        <Crown size={40} strokeWidth={2.5} />
      </div>
      <div className="mt-4 max-w-xs text-center">
        <div className="text-lg font-black" style={{ color: complete ? '#58a700' : '#777777' }}>
          {complete ? 'Reconstruction complete' : 'Incomplete by design'}
        </div>
        {complete ? (
          <p className="mt-1 text-[13px] font-semibold text-wolf">
            Every step above is backed by live Nansen evidence with full coverage.
          </p>
        ) : reasons.length > 0 ? (
          <ul className="mt-2 space-y-1 text-left text-[12px] font-semibold text-wolf">
            {reasons.slice(0, 4).map((r, i) => (
              <li key={i} className="rounded-lg bg-polar px-2 py-1">• {r}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </li>
  );
}
export function CasePath({ contract }: { contract: InvestigationContract }) {
  const inv = contract.investigation;
  const events = inv.events;
  const total = events.length;
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const nodeRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const jumpTo = useCallback((i: number) => setCursor(Math.max(0, Math.min(total - 1, i))), [total]);
  const jumpToEvent = useCallback((eventId: string) => {
    const idx = events.findIndex((e) => e.id === eventId);
    if (idx >= 0) jumpTo(idx);
  }, [events, jumpTo]);

  useEffect(() => {
    if (!playing) return;
    if (cursor >= total - 1) { setPlaying(false); return; }
    const t = setTimeout(() => setCursor((c) => Math.min(total - 1, c + 1)), 1400);
    return () => clearTimeout(t);
  }, [playing, cursor, total]);

  useEffect(() => {
    nodeRefs.current[cursor]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [cursor]);

  const active = events[cursor];
  const followable = active ? canFollow(contract, active.id) : false;
  const onFollow = useCallback(() => {
    if (!active) return;
    const res = followFromEvent(contract, active.id);
    if (res && res.kind === 'followed') jumpToEvent(res.step.toEventId);
  }, [active, contract, jumpToEvent]);

  const complete = contract.completeness === 'complete';
  const progress = total > 0 ? ((cursor + 1) / total) * 100 : 0;

  return (
    <div className="min-h-screen bg-page pb-24">
      <header className="sticky top-0 z-30 border-b-2 border-swan bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2.5">
          <Link href="/" className="btn btn-white btn-sm"><ChevronLeft size={16} strokeWidth={3} />Cases</Link>
          <div className="min-w-0 flex-1"><div className="truncate text-sm font-extrabold text-ink">{inv.name}</div></div>
          <span className="pill" style={complete ? { borderColor: '#58cc02', color: '#58a700' } : { borderColor: '#e5e5e5', color: '#777777' }}>
            {complete ? <><Crown size={12} strokeWidth={3} />Complete</> : 'Incomplete'}
          </span>
        </div>
        <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 pb-2.5">
          <button type="button" aria-label="Previous step" onClick={() => jumpTo(cursor - 1)} disabled={cursor === 0} className="node-ctl"><SkipBack size={16} strokeWidth={3} /></button>
          <button type="button" aria-label={playing ? 'Pause' : 'Play'} onClick={() => setPlaying((p) => !p)} className="node-ctl node-ctl-go">{playing ? <Pause size={16} strokeWidth={3} /> : <Play size={16} strokeWidth={3} />}</button>
          <button type="button" aria-label="Next step" onClick={() => jumpTo(cursor + 1)} disabled={cursor >= total - 1} className="node-ctl"><SkipForward size={16} strokeWidth={3} /></button>
          <button type="button" aria-label="Restart" onClick={() => { setPlaying(false); setCursor(0); }} className="node-ctl"><RotateCcw size={16} strokeWidth={3} /></button>
          <div className="mx-1 h-3 flex-1 overflow-hidden rounded-full bg-swan">
            <div className="h-full rounded-full bg-feather transition-all duration-500" style={{ width: `${progress}%` }} />
          </div>
          <span className="tabular-nums text-[13px] font-extrabold text-wolf">{Math.min(cursor + 1, total)}/{total}</span>
        </div>
      </header>
      <section className="mx-auto max-w-3xl px-4 pt-8 text-center">
        <p className="text-[13px] font-extrabold uppercase tracking-wide text-macaw">{inv.chain} · {fmtWindow(inv.window)}</p>
        <h1 className="mt-1 text-3xl font-black leading-tight text-ink sm:text-4xl">{inv.name}</h1>
        <p className="mx-auto mt-2 max-w-xl text-[15px] font-semibold text-wolf">{inv.headline}</p>
        {inv.summary.length > 0 ? (
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {inv.summary.map((m) => <StatTile key={m.key} metric={m} />)}
          </div>
        ) : null}
      </section>

      <main className="mx-auto mt-6 grid max-w-6xl gap-6 px-4 lg:grid-cols-[minmax(0,1fr)_400px]">
        <ol className="relative mx-auto w-full max-w-md py-4">
          <div className="absolute left-1/2 top-6 bottom-6 w-1.5 -translate-x-1/2 rounded-full bg-swan" aria-hidden />
          {events.map((ev, i) => {
            const st = EVENT_STYLE[ev.type];
            const state = i < cursor ? 'done' : i === cursor ? 'current' : 'ahead';
            const offset = SERPENTINE[i % SERPENTINE.length];
            const gap = i > 0 ? prevGapMs(events, i) : null;
            const Icon = st.Icon;
            return (
              <li key={ev.id}>
                {gap != null && gap >= GAP_THRESHOLD_MS ? <GapMarker text={formatGap(gap)} /> : null}
                <div className="relative flex flex-col items-center py-3" style={{ transform: `translateX(${offset}px)` }}>
                  <button
                    ref={(el) => { nodeRefs.current[i] = el; }}
                    type="button"
                    onClick={() => jumpTo(i)}
                    aria-current={state === 'current'}
                    className="node"
                    style={state === 'done'
                      ? { background: st.hue, borderColor: st.lip, boxShadow: `0 5px 0 ${st.lip}`, color: '#fff' }
                      : state === 'current'
                      ? { background: '#fff', borderColor: st.hue, boxShadow: `0 5px 0 ${st.hue}`, color: st.hue, transform: 'scale(1.12)' }
                      : { background: '#fff', borderColor: '#e5e5e5', boxShadow: '0 4px 0 #e5e5e5', color: '#afafaf' }}
                  >
                    {state === 'done' ? <Check size={30} strokeWidth={3.5} /> : <Icon size={28} strokeWidth={2.75} />}
                    {state === 'current' ? <span className="node-ping" style={{ borderColor: st.hue }} aria-hidden /> : null}
                  </button>
                  <div className="mt-2 max-w-[190px] text-center">
                    <div className="line-clamp-2 text-[13px] font-extrabold leading-tight text-ink">{ev.title}</div>
                    <ProvenanceTag provenance={ev.provenance} className="mt-1" />
                  </div>
                </div>
              </li>
            );
          })}
          <SealNode complete={complete} reasons={contract.completenessReasons} />
        </ol>
        <aside className="lg:sticky lg:top-32 lg:h-fit">
          {active ? (
            <EvidenceReceipt contract={contract} event={active} followable={followable} onFollow={onFollow} onJumpToEvent={jumpToEvent} />
          ) : null}
        </aside>
      </main>
    </div>
  );
}

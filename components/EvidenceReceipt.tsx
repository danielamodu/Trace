import { ExternalLink } from 'lucide-react';
import type { InvestigationContract } from '@/src/contract/types.ts';
import type { TraceEvent } from '@/src/types/events.ts';
import type { SourceRef } from '@/src/types/provenance.ts';
import { eventOrigin, originLabel, type EventOrigin } from '@/lib/sources.ts';
import { FOLLOW_DEAD_END } from '@/lib/follow.ts';
import { EVENT_STYLE, DERIVED_EVENT_TYPES, ProvenanceTag, entityById, sideLabel } from './CaseVisuals.tsx';
import { fmtUsd, fmtAmount, fmtTimestamp, shortAddr } from './format.ts';

function originHue(origin: EventOrigin): string {
  if (origin === 'live-nansen') return '#58cc02';
  if (origin === 'mixed') return '#ff9600';
  if (origin === 'fixture-cache') return '#1cb0f6';
  return '#afafaf';
}

function OriginBadge({ origin }: { origin: EventOrigin }) {
  const hue = originHue(origin);
  return (
    <span className="pill" style={{ borderColor: hue, color: hue }}>
      <span style={{ width: 7, height: 7, borderRadius: 999, background: hue, display: 'inline-block' }} />
      {originLabel(origin)}
    </span>
  );
}

function SourceRow({ src }: { src: SourceRef }) {
  return (
    <li className="rounded-xl border-2 border-swan bg-polar px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[12px] font-extrabold text-eel">{src.source}</span>
        {src.origin ? (
          <span className="text-[11px] font-extrabold uppercase" style={{ color: originHue(src.origin) }}>
            {src.origin === 'live-nansen' ? 'live' : 'fixture'}
          </span>
        ) : null}
      </div>
      <div className="mt-1 space-y-0.5 font-mono text-[11px] text-wolf">
        {src.fieldPath ? <div>field · {src.fieldPath}</div> : null}
        {src.requestId ? <div>req · {src.requestId}</div> : null}
        {src.txHash ? <div>tx · {shortAddr(src.txHash)}</div> : null}
        <div>captured · {fmtTimestamp(src.capturedAt)}</div>
      </div>
    </li>
  );
}
export interface EvidenceReceiptProps {
  contract: InvestigationContract;
  event: TraceEvent;
  followable: boolean;
  onFollow: () => void;
  onJumpToEvent: (eventId: string) => void;
}

export function EvidenceReceipt({ contract, event, followable, onFollow, onJumpToEvent }: EvidenceReceiptProps) {
  const style = EVENT_STYLE[event.type];
  const Icon = style.Icon;
  const origin = eventOrigin(contract, event.id);
  const prov = event.provenance;
  const value = event.value;
  const isDerived = DERIVED_EVENT_TYPES.has(event.type);

  return (
    <div className="card card-drop p-5">
      <div className="flex items-start gap-3">
        <span
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border-2 bg-white"
          style={{ borderColor: style.hue, color: style.hue }}
        >
          <Icon size={24} strokeWidth={2.75} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12px] font-extrabold uppercase tracking-wide" style={{ color: style.hue }}>
              {style.noun}
            </span>
            <ProvenanceTag provenance={prov} />
          </div>
          <h3 className="mt-1 text-lg font-extrabold leading-snug text-ink">{event.title}</h3>
          <p className="mt-0.5 text-[13px] font-semibold text-wolf">{fmtTimestamp(event.timestamp)}</p>
        </div>
      </div>

      <div className="mt-3"><OriginBadge origin={origin} /></div>

      {value ? (
        <div className="mt-4 rounded-2xl border-2 border-swan bg-polar px-4 py-3">
          <div className="text-2xl font-extrabold text-ink">{fmtAmount(value.amount, value.tokenSymbol)}</div>
          <div className="text-sm font-bold text-wolf">
            {value.valueUsd === null || value.valueUsd === undefined ? 'USD value not captured' : fmtUsd(value.valueUsd)}
          </div>
        </div>
      ) : null}

      {event.participants.length > 0 ? (
        <div className="mt-4">
          <h4 className="mb-2 text-[12px] font-extrabold uppercase tracking-wide text-wolf">Who</h4>
          <ul className="space-y-1.5">
            {event.participants.map((p, i) => {
              const ent = entityById(contract, p.entityId);
              return (
                <li key={`${p.entityId}-${i}`} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="pill">{sideLabel(p.side)}</span>
                  <span className="font-extrabold text-eel">{ent?.displayName ?? p.entityId}</span>
                  {ent?.role ? <span className="text-[12px] font-bold text-wolf">· {ent.role}</span> : null}
                  {ent?.address ? <span className="font-mono text-[11px] text-hare">{shortAddr(ent.address)}</span> : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      <div className="mt-4 rounded-2xl border-2 border-dashed border-swan p-4">
        <h4 className="mb-2 text-[12px] font-extrabold uppercase tracking-wide text-wolf">The receipt</h4>
        {prov.kind === 'FACT' || prov.kind === 'RELATION' ? (
          <>
            <p className="text-sm font-semibold text-eel">“{prov.statement}”</p>
            <ul className="mt-3 space-y-2">
              {prov.sources.map((src, i) => <SourceRow key={i} src={src} />)}
            </ul>
          </>
        ) : prov.kind === 'DERIVED' ? (
          <>
            <p className="text-sm font-semibold text-eel">
              Computed value — rule <span className="font-mono font-extrabold text-ink">{prov.calculation}</span>
            </p>
            {prov.inputs ? (
              <dl className="mt-2 font-mono text-[12px]">
                {Object.entries(prov.inputs).map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3 border-b border-swan py-1">
                    <dt className="text-wolf">{k}</dt>
                    <dd className="font-bold text-eel">{String(v)}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {prov.sourceEventIds.length > 0 ? (
              <div className="mt-3">
                <div className="mb-1.5 text-[11px] font-extrabold uppercase tracking-wide text-wolf">Derived from</div>
                <div className="flex flex-wrap gap-1.5">
                  {prov.sourceEventIds.map((eid) => {
                    const src = contract.investigation.events.find((e) => e.id === eid);
                    return (
                      <button key={eid} type="button" onClick={() => onJumpToEvent(eid)}
                        className="pill cursor-pointer transition hover:bg-polar">
                        {src ? src.title : eid}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </>
        ) : prov.kind === 'HYPOTHESIS' ? (
          <p className="text-sm font-semibold text-eel">“{prov.statement}” · confidence {prov.confidence}</p>
        ) : null}
      </div>
      {event.annotations && event.annotations.length > 0 ? (
        <div className="mt-4 space-y-2">
          {event.annotations.map((a, i) => (
            <div key={i} className="flex items-start gap-2 rounded-xl bg-polar px-3 py-2">
              <ProvenanceTag provenance={a.provenance} />
              <p className="text-[13px] font-semibold text-eel">{a.text}</p>
            </div>
          ))}
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-semibold text-hare">
        {event.method ? <span>method · <span className="font-mono">{event.method}</span></span> : null}
        <span>admitted · {event.admissionRule}</span>
        {event.txHash ? (
          <a href={`https://etherscan.io/tx/${event.txHash}`} target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1 font-bold text-macaw hover:underline">
            <ExternalLink size={12} strokeWidth={3} /> tx {shortAddr(event.txHash)}
          </a>
        ) : null}
      </div>

      {!isDerived ? (
        <div className="mt-5">
          {followable ? (
            <button type="button" onClick={onFollow} className="btn btn-green w-full">Follow the money →</button>
          ) : (
            <p className="rounded-xl border-2 border-dashed border-swan px-3 py-2 text-center text-[13px] font-bold text-hare">
              {FOLLOW_DEAD_END}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

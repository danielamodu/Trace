'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';

import type { InvestigationContract } from '../src/contract/types.ts';
import type { LiveRunMeta } from '../src/investigations/live.ts';
import { InvestigationView } from './InvestigationView.tsx';
import { Button } from '@/components/ui/button';

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const FIELD =
  'h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50';
const LABEL = 'mb-1 block text-[13px] font-medium';
const CHAINS = ['ethereum', 'arbitrum', 'base', 'optimism', 'polygon', 'bnb', 'avalanche'];

type RunState = 'idle' | 'running' | 'done' | 'error';
interface RunResult {
  contract: InvestigationContract;
  meta: LiveRunMeta;
}

/**
 * BYO-key live reconstruction form. Posts to /api/reconstruct (a server-side
 * proxy) and renders the returned contract with the same InvestigationView used
 * by the case library. The Nansen key never leaves the request body: it is not
 * stored in component state beyond the field, not persisted, and not logged.
 */
export function ReconstructForm() {
  const [address, setAddress] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [chain, setChain] = useState('ethereum');
  const [apiKey, setApiKey] = useState('');
  const [maxPages, setMaxPages] = useState('5');
  const [maxCredits, setMaxCredits] = useState('12');
  const [state, setState] = useState<RunState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [savedUrl, setSavedUrl] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  function validate(): string | null {
    if (!ADDRESS_RE.test(address.trim())) return 'Address must be 0x followed by 40 hex characters.';
    if (from.trim() === '' || to.trim() === '') return 'Both window dates are required.';
    if (from.trim() > to.trim()) return 'Window start cannot be after the end date.';
    return null;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const v = validate();
    if (v) {
      setError(v);
      setState('error');
      setResult(null);
      return;
    }
    setState('running');
    setError(null);
    setResult(null);
    setSaveState('idle');
    setSavedUrl(null);
    setSaveError(null);
    try {
      const budget: Record<string, number> = {};
      const mp = Number(maxPages);
      if (Number.isFinite(mp) && mp > 0) budget.maxPages = Math.trunc(mp);
      const mc = Number(maxCredits);
      if (Number.isFinite(mc) && mc > 0) budget.maxCredits = Math.trunc(mc);

      const res = await fetch('/api/reconstruct', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          address: address.trim(),
          window: { from: from.trim(), to: to.trim() },
          chain,
          budget,
          ...(apiKey.trim() !== '' ? { apiKey: apiKey.trim() } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const msg = [data?.error, data?.detail].filter(Boolean).join(' — ');
        setError(msg || `Request failed (${res.status}).`);
        setState('error');
        return;
      }
      setResult(data as RunResult);
      setState('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error contacting the server.');
      setState('error');
    }
  }

  function downloadContract() {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result.contract, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${result.contract.caseId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function saveToLibrary() {
    if (!result) return;
    setSaveState('saving');
    setSaveError(null);
    try {
      const res = await fetch('/api/cases', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ contract: result.contract }),
      });
      const data = await res.json();
      if (!res.ok) {
        const detail = Array.isArray(data?.detail) ? data.detail.join('; ') : data?.detail;
        const msg = [data?.error, detail].filter(Boolean).join(' — ');
        setSaveError(msg || `Save failed (${res.status}).`);
        setSaveState('error');
        return;
      }
      setSavedUrl(typeof data?.url === 'string' ? data.url : `/cases/${result.contract.caseId}`);
      setSaveState('saved');
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Network error saving the case.');
      setSaveState('error');
    }
  }

  const running = state === 'running';

  return (
    <div className="grid gap-5">
      <form
        onSubmit={onSubmit}
        className="theme-surface enter enter-2 rounded-lg border bg-card p-5"
        aria-label="Live reconstruction inputs"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor="rf-address" className={LABEL}>Address</label>
            <input
              id="rf-address" className={`${FIELD} font-mono`} placeholder="0x…"
              value={address} onChange={(e) => setAddress(e.target.value)}
              autoComplete="off" spellCheck={false}
            />
          </div>
          <div>
            <label htmlFor="rf-from" className={LABEL}>Window from</label>
            <input id="rf-from" type="date" className={FIELD} value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label htmlFor="rf-to" className={LABEL}>Window to</label>
            <input id="rf-to" type="date" className={FIELD} value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div>
            <label htmlFor="rf-chain" className={LABEL}>Chain</label>
            <select id="rf-chain" className={FIELD} value={chain} onChange={(e) => setChain(e.target.value)}>
              {CHAINS.map((c) => (<option key={c} value={c}>{c}</option>))}
            </select>
          </div>
          <div>
            <label htmlFor="rf-key" className={LABEL}>
              Nansen API key <span className="text-muted-foreground">(optional)</span>
            </label>
            <input
              id="rf-key" type="password" className={`${FIELD} font-mono`} placeholder="server key used if enabled"
              value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="off"
            />
          </div>
        </div>

        <details className="mt-4">
          <summary className="cursor-pointer text-[13px] text-muted-foreground">Budget (advanced)</summary>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="rf-pages" className={LABEL}>Max transaction pages</label>
              <input id="rf-pages" type="number" min={1} className={FIELD} value={maxPages} onChange={(e) => setMaxPages(e.target.value)} />
            </div>
            <div>
              <label htmlFor="rf-credits" className={LABEL}>Max credits</label>
              <input id="rf-credits" type="number" min={1} className={FIELD} value={maxCredits} onChange={(e) => setMaxCredits(e.target.value)} />
            </div>
          </div>
          <p className="mt-2 text-[12px] text-muted-foreground/80">
            The server clamps these to safe maxima. Each transaction page ≈ 1 credit; counterparty aggregates ≈ 5.
          </p>
        </details>

        <div className="mt-5 flex items-center gap-3">
          <Button type="submit" disabled={running}>{running ? 'Reconstructing…' : 'Reconstruct'}</Button>
          <span className="text-[12.5px] text-muted-foreground">Spends Nansen credits on submit.</span>
        </div>
      </form>

      <p className="enter enter-3 max-w-[70ch] text-[12.5px] leading-relaxed text-muted-foreground/85">
        Your key is sent to this TRACE server only, used once to call Nansen on your behalf, and never
        stored, logged, or returned. If the server has its own key enabled, it is used when you leave the
        field blank. Saving a run writes its contract to this server&rsquo;s local library
        (<span className="font-mono">data/cases/</span>, gitignored) — never committed or sent anywhere else.
        This endpoint has no authentication or rate limiting — run it locally or behind your own access controls.
      </p>

      {state === 'error' && error ? (
        <div
          role="alert"
          className="rounded-lg border bg-card p-4 text-[13.5px]"
          style={{ borderColor: 'var(--relation-border)', color: 'var(--relation)' }}
        >
          {error}
        </div>
      ) : null}

      {running ? (
        <div
          className="theme-surface flex items-center gap-3 rounded-lg border bg-card p-4 text-[13.5px] text-muted-foreground"
          aria-live="polite"
        >
          <span className="inline-block size-3 animate-pulse rounded-full bg-foreground/60" />
          Fetching live evidence and running the engine — this calls Nansen and can take several seconds.
        </div>
      ) : null}

      {result ? (
        <div className="grid gap-5">
          <RunSummary
            meta={result.meta}
            contract={result.contract}
            onDownload={downloadContract}
            onSave={saveToLibrary}
            saveState={saveState}
            savedUrl={savedUrl}
            saveError={saveError}
          />
          <InvestigationView contract={result.contract} />
        </div>
      ) : null}
    </div>
  );
}

/** Compact accounting for a finished live run — spend, coverage, sanitization, provenance. */
function RunSummary({
  meta,
  contract,
  onDownload,
  onSave,
  saveState,
  savedUrl,
  saveError,
}: {
  meta: LiveRunMeta;
  contract: InvestigationContract;
  onDownload: () => void;
  onSave: () => void;
  saveState: 'idle' | 'saving' | 'saved' | 'error';
  savedUrl: string | null;
  saveError: string | null;
}) {
  const cleared =
    meta.sanitization.labelsCleared + meta.sanitization.symbolsCleared + meta.sanitization.namesCleared;
  const stats: Array<[string, string]> = [
    ['credits spent', String(meta.creditsSpent)],
    ['credits left', meta.creditsRemaining ?? '—'],
    ['tx pages', `${meta.transactionPagesFetched}${meta.reachedLastPage ? ' · last' : ' · capped'}`],
    ['rows skipped', String(meta.rowsSkipped)],
    ['labels cleared', String(cleared)],
    ['api calls', String(meta.calls.length)],
  ];
  const complete = contract.completeness === 'complete';
  return (
    <section className="theme-surface enter enter-3 rounded-lg border bg-card p-4" aria-label="Run summary">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 className="text-[15px] font-semibold">Live run</h2>
        <span
          className="inline-flex items-center rounded border px-2 py-0.5 font-mono text-[11.5px] text-muted-foreground"
          style={complete ? undefined : { borderColor: 'var(--relation-border)', color: 'var(--relation)' }}
        >
          evidence: {contract.completeness}
        </span>
        <span className="inline-flex items-center rounded border px-2 py-0.5 font-mono text-[11.5px] text-muted-foreground">
          {contract.dataSource}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onSave}
            disabled={saveState === 'saving' || saveState === 'saved'}
          >
            {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved ✓' : 'Save to library'}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={onDownload}>
            Download contract JSON
          </Button>
        </div>
      </div>
      <ul className="grid grid-cols-2 gap-2 p-0 sm:grid-cols-3 lg:grid-cols-6">
        {stats.map(([label, value]) => (
          <li key={label} className="list-none rounded-md border border-border/70 px-3 py-2">
            <div className="text-[11px] text-muted-foreground/80">{label}</div>
            <div className="font-mono text-[15px] tabular-nums">{value}</div>
          </li>
        ))}
      </ul>
      <p className="mt-3 font-mono text-[12px] text-muted-foreground/80">{meta.stopReason}</p>
      {saveState === 'saved' && savedUrl ? (
        <p className="mt-3 text-[13px]" aria-live="polite">
          Saved to your local library —{' '}
          <a className="font-medium underline underline-offset-2" href={savedUrl}>
            open the case →
          </a>
        </p>
      ) : null}
      {saveState === 'error' && saveError ? (
        <p className="mt-3 text-[13px]" role="alert" style={{ color: 'var(--relation)' }}>
          {saveError}
        </p>
      ) : null}
    </section>
  );
}

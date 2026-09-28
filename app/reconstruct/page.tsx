'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  GitBranch, KeyRound, TriangleAlert, ChevronDown, Play, Loader2,
  CircleCheck, ArrowRight, Info, ShieldCheck, Sparkles, Fingerprint,
} from 'lucide-react';
import type { InvestigationContract } from '@/src/contract/types.ts';
import type { LiveRunMeta } from '@/src/investigations/live.ts';
import { isValidEvmAddress, isOrderedDateWindow } from '@/lib/validation.ts';
import { fingerprintContract } from '@/src/contract/verify.ts';

interface Posture { serverKeyEnabled: boolean; byoRequired: boolean; }
type RunState = 'idle' | 'running' | 'done' | 'error';

export default function ReconstructPage() {
  const [address, setAddress] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [chain, setChain] = useState('ethereum');
  const [apiKey, setApiKey] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [maxCredits, setMaxCredits] = useState('12');
  const [maxPages, setMaxPages] = useState('5');

  const [posture, setPosture] = useState<Posture | null>(null);
  const [state, setState] = useState<RunState>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [result, setResult] = useState<{ contract: InvestigationContract; meta: LiveRunMeta } | null>(null);
  const [fingerprint, setFingerprint] = useState('');

  useEffect(() => {
    let alive = true;
    fetch('/api/reconstruct')
      .then((r) => r.json())
      .then((d) => { if (alive) setPosture({ serverKeyEnabled: Boolean(d.serverKeyEnabled), byoRequired: Boolean(d.byoRequired) }); })
      .catch(() => { if (alive) setPosture({ serverKeyEnabled: false, byoRequired: true }); });
    return () => { alive = false; };
  }, []);

  const addressValid = isValidEvmAddress(address);
  const windowOrdered = isOrderedDateWindow(from, to);
  const windowFilled = Boolean(from && to);
  const keyReady = posture?.serverKeyEnabled === true || apiKey.trim().length > 0;
  const canRun = addressValid && windowFilled && windowOrdered && keyReady && state !== 'running';

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canRun) return;
    setState('running');
    setErrorMsg('');
    setResult(null);
    setFingerprint('');
    try {
      const body: Record<string, unknown> = {
        address: address.trim(),
        window: { from, to },
        chain: chain.trim() || 'ethereum',
        budget: { maxCredits: Number(maxCredits) || undefined, maxPages: Number(maxPages) || undefined },
      };
      if (apiKey.trim()) body.apiKey = apiKey.trim();
      const res = await fetch('/api/reconstruct', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setState('error');
        setErrorMsg(typeof data?.error === 'string' ? data.error : `Request failed (${res.status})`);
        return;
      }
      setResult({ contract: data.contract, meta: data.meta });
      setState('done');
      try { setFingerprint(await fingerprintContract(data.contract)); } catch { /* fingerprint is best-effort */ }
    } catch (err) {
      setState('error');
      setErrorMsg(err instanceof Error ? err.message : 'Network error');
    }
  }

  const downloadHref = result
    ? `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(result.contract, null, 2))}`
    : '';
  const downloadName = result ? `${result.contract.caseId || 'trace-case'}.json` : 'trace-case.json';

  return (
    <div className="page-wrap form-page">
      <div className="breadcrumbs"><Link href="/">Investigations</Link><span className="breadcrumb-slash">/</span><span>Reconstruct</span></div>
      <div className="form-heading">
        <div className="eyebrow"><GitBranch size={13} aria-hidden="true" /> LIVE RECONSTRUCTION</div>
        <h1>Reconstruct from an address</h1>
        <p>Bring an address and a window. Review the scope before any paid Nansen request — the run is only made when you press Run.</p>
      </div>

      <div className="form-layout">
        <form className="reconstruct-form" onSubmit={onSubmit}>
          <div className="form-section">
            <div className="form-section-head">
              <span className="form-section-number">01</span>
              <div><h2>Subject address</h2><p>The wallet or contract to trace, on an EVM chain.</p></div>
            </div>
            <label className="field-label" htmlFor="address">Address</label>
            <input id="address" className={`text-input${address && !addressValid ? ' input-error' : ''}`} placeholder="0x…" value={address} onChange={(e) => setAddress(e.target.value)} autoComplete="off" spellCheck={false} />
            {address && !addressValid ? <p className="field-error">Enter a 40-character 0x EVM address.</p> : <p className="field-hint">40 hex characters after 0x.</p>}
            <label className="field-label field-label-spaced" htmlFor="chain">Chain</label>
            <input id="chain" className="text-input" value={chain} onChange={(e) => setChain(e.target.value)} autoComplete="off" spellCheck={false} />
          </div>

          <div className="form-section">
            <div className="form-section-head">
              <span className="form-section-number">02</span>
              <div><h2>Time window</h2><p>The UTC date range to reconstruct across.</p></div>
            </div>
            <div className="date-grid">
              <div><label className="field-label" htmlFor="from">From</label><input id="from" type="date" className="text-input" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
              <div><label className="field-label" htmlFor="to">To</label><input id="to" type="date" className="text-input" value={to} onChange={(e) => setTo(e.target.value)} /></div>
            </div>
            {windowFilled && !windowOrdered ? <p className="field-error">The start date must be on or before the end date.</p> : null}
          </div>

          <div className="form-section form-section-advanced">
            <button type="button" className="advanced-toggle" onClick={() => setAdvanced((v) => !v)} aria-expanded={advanced}>
              <span><Sparkles size={13} aria-hidden="true" /> Advanced budget</span>
              <span><ChevronDown size={14} className={advanced ? 'chevron-open' : undefined} aria-hidden="true" /></span>
            </button>
            {advanced ? (
              <div className="advanced-content">
                <p>Hard server ceilings still apply (max 25 credits, 10 pages). These only lower the cap.</p>
                <div className="budget-grid">
                  <label>Max credits<input className="text-input" inputMode="numeric" value={maxCredits} onChange={(e) => setMaxCredits(e.target.value)} /></label>
                  <label>Max pages<input className="text-input" inputMode="numeric" value={maxPages} onChange={(e) => setMaxPages(e.target.value)} /></label>
                </div>
              </div>
            ) : null}
          </div>
          <div className={`key-connection-card${keyReady ? ' is-ready' : ''}`}>
            <span className="key-icon"><KeyRound size={15} aria-hidden="true" /></span>
            <div>
              <strong>Nansen credential</strong>
              <p>{posture === null ? 'Checking server posture…' : posture.serverKeyEnabled ? 'A server key is enabled for this endpoint — you can run without bringing your own.' : 'Bring your own Nansen key. It is used once for this request and never stored, logged, or returned.'}</p>
              {posture && !posture.serverKeyEnabled ? (
                <>
                  <input type="password" className="text-input" style={{ marginTop: 8 }} placeholder="Nansen API key" value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="off" />
                  <p className="byo-note">Sent to this app's server for a single call. Never persisted.</p>
                </>
              ) : null}
            </div>
            <span className="connection-state">{keyReady ? 'Ready' : 'Needs key'}</span>
          </div>

          <div className="paid-call-warning">
            <TriangleAlert size={14} aria-hidden="true" />
            <p><strong>This spends Nansen credits.</strong> A run makes paid API calls against the active key, capped by the budget above. Nothing is charged until you press Run.</p>
          </div>

          <button type="submit" className="button button-primary button-run" disabled={!canRun}>
            {state === 'running' ? <>Reconstructing… <Loader2 size={15} aria-hidden="true" /></> : <>Run reconstruction <Play size={14} aria-hidden="true" /></>}
          </button>
          <p className="button-caption"><ShieldCheck size={11} aria-hidden="true" /> Server re-validates every request and clamps the budget.</p>

          {state === 'error' ? (
            <div className="inline-result is-error">
              <TriangleAlert size={14} aria-hidden="true" />
              <div className="inline-result-body"><p>{errorMsg || 'Reconstruction failed.'}</p></div>
            </div>
          ) : null}
          {state === 'done' && result ? (
            <div className="inline-result">
              <CircleCheck size={14} aria-hidden="true" />
              <div className="inline-result-body">
                <p>Reconstruction complete — {result.meta.creditsSpent} credit(s) spent, {result.contract.investigation.events.length} event record(s).</p>
                <ul className="result-accounting">
                  <li><span>Credits spent</span> {result.meta.creditsSpent}</li>
                  <li><span>Credits remaining</span> {result.meta.creditsRemaining ?? '—'}</li>
                  <li><span>Pages fetched</span> {result.meta.transactionPagesFetched}</li>
                  <li><span>Rows skipped</span> {result.meta.rowsSkipped}</li>
                  <li><span>Reached last page</span> {result.meta.reachedLastPage ? 'yes' : 'no'}</li>
                  <li><span>Stop reason</span> {result.meta.stopReason}</li>
                </ul>
                {fingerprint ? <div className="result-fingerprint fingerprint-row"><span><Fingerprint size={11} aria-hidden="true" /> Fingerprint (SHA-256)</span><code>{fingerprint}</code></div> : null}
                <div className="download-row">
                  <a className="button button-secondary" href={downloadHref} download={downloadName}>Download case JSON <ArrowRight size={14} aria-hidden="true" /></a>
                  <Link className="button button-primary" href={`/cases/${result.contract.caseId}`}>Open in workspace <ArrowRight size={14} aria-hidden="true" /></Link>
                </div>
              </div>
            </div>
          ) : null}
        </form>
        <aside className="setup-aside">
          <div className="aside-card">
            <span className="aside-icon"><ShieldCheck size={18} aria-hidden="true" /></span>
            <div className="eyebrow">HOW A RUN WORKS</div>
            <h2>Scope first. Spend second.</h2>
            <p>TRACE reconstructs deterministically from Nansen data — no inference, no LLM. Every claim in the result carries its source.</p>
            <ul>
              <li><CircleCheck size={13} aria-hidden="true" /> BYO key, or an enabled server key</li>
              <li><CircleCheck size={13} aria-hidden="true" /> Budget is clamped server-side</li>
              <li><CircleCheck size={13} aria-hidden="true" /> Result is a portable, verifiable artifact</li>
            </ul>
          </div>
          <div className="aside-mini"><Info size={14} aria-hidden="true" /> <strong>Live vs fixture</strong> <span>only live runs can earn “complete”</span></div>
        </aside>
      </div>
    </div>
  );
}

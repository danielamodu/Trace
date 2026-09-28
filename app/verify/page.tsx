'use client';

import { useCallback, useRef, useState } from 'react';
import Link from 'next/link';
import {
  FileCheck2, UploadCloud, CircleCheck, CircleAlert, TriangleAlert,
  Fingerprint, ShieldCheck, Info, Check, X,
} from 'lucide-react';
import type { InvestigationContract } from '@/src/contract/types.ts';
import { verifyContract, type VerifyResult } from '@/src/contract/verify.ts';
import { fmtWindow } from '@/components/format.ts';

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

interface Meta { caseId: string; dataSource: string; window: string; }

export default function VerifyPage() {
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState('');
  const [fileSize, setFileSize] = useState(0);
  const [busy, setBusy] = useState(false);
  const [parseError, setParseError] = useState('');
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [rawSha, setRawSha] = useState('');
  const [meta, setMeta] = useState<Meta | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handleFile = useCallback(async (file: File) => {
    setBusy(true);
    setParseError('');
    setResult(null);
    setMeta(null);
    setRawSha('');
    setFileName(file.name);
    setFileSize(file.size);
    try {
      const text = await file.text();
      setRawSha(await sha256Hex(text));
      let parsed: unknown;
      try { parsed = JSON.parse(text); } catch { setParseError('That file is not valid JSON.'); setBusy(false); return; }
      const res = await verifyContract(parsed);
      setResult(res);
      const c = parsed as Partial<InvestigationContract>;
      setMeta({
        caseId: c.caseId ?? '—',
        dataSource: c.dataSource === 'live-nansen' ? 'Live Nansen' : c.dataSource === 'fixture-cache' ? 'Fixture cache' : '—',
        window: c.investigation?.window ? fmtWindow(c.investigation.window) : '—',
      });
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Could not read that file.');
    } finally {
      setBusy(false);
    }
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  }, [handleFile]);

  return (
    <div className="page-wrap verify-page">
      <div className="breadcrumbs"><Link href="/">Investigations</Link><span className="breadcrumb-slash">/</span><span>Verify</span></div>
      <div className="form-heading verify-heading">
        <div className="eyebrow"><FileCheck2 size={13} aria-hidden="true" /> ARTIFACT VERIFICATION</div>
        <h1>Verify a case file</h1>
        <p>Drop a TRACE case JSON. It’s checked entirely in your browser — offline, zero credits — re-deriving the verdict and fingerprint from the file alone.</p>
      </div>
      <div className="verify-layout">
        <div className="verify-main">
          <div
            className={`dropzone${dragging ? ' is-dragging' : ''}${fileName ? ' has-file' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <span className="aside-icon"><UploadCloud size={18} aria-hidden="true" /></span>
            <h2>{fileName || 'Drop a case file'}</h2>
            <p>{fileName ? `${fileSize.toLocaleString()} bytes` : 'or choose a .json artifact from your machine'}</p>
            <button type="button" className="button button-secondary" onClick={() => inputRef.current?.click()}>Choose file</button>
            <input ref={inputRef} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); }} />
          </div>

          {busy ? <div className="loading-row"><span className="loading-pip" /> Verifying…</div> : null}

          {parseError ? (
            <div className="verify-error"><TriangleAlert size={15} aria-hidden="true" /><div><strong>Could not verify</strong><p>{parseError}</p></div></div>
          ) : null}

          {result ? (
            <>
              <div className={`verify-result ${result.ok ? 'ok' : 'bad'}`}>
                <span className="result-icon">{result.ok ? <CircleCheck size={20} aria-hidden="true" /> : <CircleAlert size={20} aria-hidden="true" />}</span>
                <div>
                  <strong>{result.ok ? 'Artifact verified' : 'Verification failed'}</strong>
                  <p>{result.ok
                    ? 'Every check re-derived from the file passed. This artifact is internally consistent and its verdict holds.'
                    : `${result.checks.filter((c) => !c.ok).length} check(s) did not hold — see the breakdown below.`}</p>
                </div>
                <span className="result-state">{result.algorithm}</span>
              </div>

              <div className="verify-checks">
                {result.checks.map((c) => (
                  <div key={c.id} className={`verify-check ${c.ok ? 'pass' : 'fail'}`}>
                    {c.ok ? <Check size={14} aria-hidden="true" /> : <X size={14} aria-hidden="true" />}
                    <div><strong>{c.label}</strong><p>{c.detail}</p></div>
                  </div>
                ))}
              </div>

              <div className="file-report">
                <div className="file-report-head">
                  <span className="aside-icon"><FileCheck2 size={16} aria-hidden="true" /></span>
                  <div><strong>{fileName || 'case.json'}</strong><span>{result.recomputed.completeness} · {result.recomputed.counts.observedFacts} facts</span></div>
                </div>
                {meta ? (
                  <div className="identity-grid">
                    <div><span>Case ID</span><strong>{meta.caseId}</strong></div>
                    <div><span>Source</span><strong>{meta.dataSource}</strong></div>
                    <div><span>Window</span><strong>{meta.window}</strong></div>
                  </div>
                ) : null}
                <div className="fingerprint-row"><span><Fingerprint size={11} aria-hidden="true" /> Content fingerprint (SHA-256)</span><code>{result.fingerprint}</code></div>
                {rawSha ? <div className="fingerprint-row"><span><Fingerprint size={11} aria-hidden="true" /> Raw file digest (diagnostic)</span><code>{rawSha}</code></div> : null}
              </div>
            </>
          ) : null}
        </div>
        <aside className="verify-aside">
          <div className="aside-card">
            <span className="aside-icon"><ShieldCheck size={18} aria-hidden="true" /></span>
            <div className="eyebrow">WHAT GETS CHECKED</div>
            <h2>Trust the file, not the sender.</h2>
            <p>Verification runs client-side over the file you provide. No upload, no network, no credits — the same fingerprint the CLI produces.</p>
            <div className="verify-checklist">
              <span><Check size={13} aria-hidden="true" /> Schema, references & provenance</span>
              <span><Check size={13} aria-hidden="true" /> Completeness verdict re-derived</span>
              <span><Check size={13} aria-hidden="true" /> Evidence tallies re-derived</span>
              <span><Check size={13} aria-hidden="true" /> No inference — zero HYPOTHESIS</span>
            </div>
          </div>
          <div className="aside-mini"><Info size={14} aria-hidden="true" /> <strong>Fingerprint</strong> <span>same bytes → same SHA-256</span></div>
        </aside>
      </div>
    </div>
  );
}

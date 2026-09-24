'use client';

import { useEffect, useState } from 'react';
import { verifyContract, type VerifyResult } from '../src/contract/verify.ts';

const COL_TITLE = 'font-mono text-xs uppercase tracking-wider text-muted-foreground/80';

/**
 * Pillar ④ — "Prove it." A TRACE contract verifies itself: this panel re-derives
 * the artifact's verdict in the browser from the artifact alone — schema, cross-
 * references, the completeness rule and every evidence tally — with zero credits
 * and no network, and prints a whitespace-independent content fingerprint. The
 * same verifyContract() powers the /verify drop-in route and the `trace verify`
 * CLI, so the identical result travels wherever the JSON goes.
 */
export function VerifyPanel({ contract, className = '' }: { contract: unknown; className?: string }) {
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    setResult(null);
    setError(null);
    setCopied(false);
    verifyContract(contract)
      .then((r) => alive && setResult(r))
      .catch((e) => alive && setError(e instanceof Error ? e.message : 'Verification failed.'));
    return () => {
      alive = false;
    };
  }, [contract]);

  const ok = result?.ok === true;

  return (
    <section aria-label="Artifact verification" className={`enter enter-3 mt-7 ${className}`}>
      <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className={COL_TITLE}>PROVE IT — SELF-VERIFYING ARTIFACT</h2>
        <span className="prov prov-fact" title="Recomputed locally from the artifact — no network, no credits">
          offline · 0 credits
        </span>
      </div>
      <div
        className="theme-surface rounded-2xl border bg-card p-4"
        style={
          ok
            ? { borderColor: 'var(--primary)', background: 'color-mix(in oklch, var(--primary) 6%, var(--card))' }
            : undefined
        }
      >
        {error ? (
          <p role="alert" className="text-sm" style={{ color: 'var(--relation)' }}>
            Could not verify this artifact: {error}
          </p>
        ) : !result ? (
          <p className="text-sm text-muted-foreground">Verifying…</p>
        ) : (
          <VerifyBody
            result={result}
            copied={copied}
            onCopy={() => {
              navigator.clipboard?.writeText(result.fingerprint);
              setCopied(true);
            }}
          />
        )}
      </div>
    </section>
  );
}

/** The verified body: an earned seal, the per-check breakdown, and the fingerprint. */
function VerifyBody({
  result,
  copied,
  onCopy,
}: {
  result: VerifyResult;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="grid gap-3.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Seal ok={result.ok} />
        <p className="max-w-[72ch] text-[13px] leading-relaxed text-muted-foreground">
          Recomputed in your browser from the artifact alone — schema, cross-references, the completeness
          verdict and every evidence tally, re-derived with zero credits and no Nansen call. It runs
          identically anywhere the JSON travels.
        </p>
      </div>

      <ul className="grid list-none gap-2 p-0">
        {result.checks.map((c) => (
          <li
            key={c.id}
            className="flex items-start gap-2.5 rounded-md border border-border/70 bg-background px-3 py-2"
          >
            <Glyph ok={c.ok} />
            <div className="grid gap-0.5">
              <div className="text-[13.5px] font-medium">{c.label}</div>
              <div className="text-[12.5px] leading-relaxed text-muted-foreground">{c.detail}</div>
            </div>
          </li>
        ))}
      </ul>

      <div className="rounded-md border border-border/70 bg-background px-3 py-2.5">
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground/80">
            {result.algorithm} content fingerprint
          </span>
          <button
            type="button"
            onClick={onCopy}
            className="font-mono text-[11px] text-primary underline underline-offset-2"
          >
            {copied ? 'copied ✓' : 'copy'}
          </button>
        </div>
        <code className="block break-all font-mono text-[12px] leading-relaxed text-foreground">
          {result.fingerprint}
        </code>
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground/70">
          A whitespace- and key-order-independent hash of the contract&rsquo;s content. Recompute it anywhere;
          the same bytes give the same hash — a mismatch means the artifact was altered.
        </p>
      </div>
    </div>
  );
}

const CHECK_PATH = 'M3.5 8.5l3 3 6-7';

function Seal({ ok }: { ok: boolean }) {
  if (ok) {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-0.5 font-mono text-[11.5px] font-semibold uppercase tracking-wider"
        style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
      >
        <svg viewBox="0 0 16 16" className="size-3" aria-hidden fill="none">
          <path d={CHECK_PATH} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Verified
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center rounded-md border px-2.5 py-0.5 font-mono text-[11.5px] font-semibold uppercase tracking-wider"
      style={{ borderColor: 'var(--relation-border)', color: 'var(--relation)' }}
    >
      Not verified
    </span>
  );
}

function Glyph({ ok }: { ok: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className="mt-0.5 size-3.5 shrink-0"
      aria-hidden
      fill="none"
      style={{ color: ok ? 'var(--primary)' : 'var(--relation)' }}
    >
      {ok ? (
        <path d={CHECK_PATH} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      )}
    </svg>
  );
}

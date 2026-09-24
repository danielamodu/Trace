'use client';

import { useRef, useState } from 'react';

import { VerifyPanel } from './VerifyPanel.tsx';
import { Button } from '@/components/ui/button';

const FIELD =
  'w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-[12.5px] leading-relaxed outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50';

/**
 * The portable-artifact demo: paste any TRACE contract JSON, drop a file, or
 * load a sample, and it verifies entirely in the browser — no upload, no server
 * round-trip, no credits. Proves the contract carries its own proof: hand
 * someone the JSON and they can re-check the verdict in their own TRACE.
 */
export function VerifyDropzone() {
  const [raw, setRaw] = useState('');
  const [parsed, setParsed] = useState<unknown>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function parse(text: string) {
    try {
      setParsed(JSON.parse(text));
      setParseError(null);
    } catch (e) {
      setParsed(null);
      setParseError(e instanceof Error ? e.message : 'Not valid JSON.');
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setRaw(text);
    parse(text);
  }

  async function loadSample() {
    setLoading(true);
    setParseError(null);
    try {
      const res = await fetch('/api/cases/case_euler_2023');
      const data = await res.json();
      setRaw(JSON.stringify(data, null, 2));
      setParsed(data);
    } catch {
      setParseError('Could not load the sample case from this server.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid gap-5">
      <div className="theme-surface enter enter-2 rounded-xl border bg-card p-5">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <label htmlFor="verify-json" className="text-[13px] font-medium">
            Paste a TRACE contract, drop a file, or load a sample
          </label>
          <div className="ml-auto flex items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="sr-only"
              onChange={onFile}
            />
            <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
              Choose file
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={loadSample} disabled={loading}>
              {loading ? 'Loading…' : 'Load the Euler case'}
            </Button>
          </div>
        </div>
        <textarea
          id="verify-json"
          className={FIELD}
          rows={8}
          placeholder='{ "contractVersion": "trace-3c/1.0.0", "caseId": "…", "investigation": { … } }'
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          spellCheck={false}
          aria-label="TRACE contract JSON"
        />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button type="button" onClick={() => parse(raw)} disabled={raw.trim() === ''}>
            Verify artifact
          </Button>
          <span className="text-[12.5px] text-muted-foreground">
            Runs entirely in your browser — no upload, no credits.
          </span>
        </div>
        {parseError ? (
          <p className="mt-3 text-[13px]" role="alert" style={{ color: 'var(--relation)' }}>
            Couldn&rsquo;t parse JSON: {parseError}
          </p>
        ) : null}
      </div>

      {parsed !== null ? <VerifyPanel contract={parsed} /> : null}
    </div>
  );
}

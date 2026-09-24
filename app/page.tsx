import Link from 'next/link';
import type { ReactNode } from 'react';
import { listCaseSummaries, getCaseContract } from '../lib/cases.ts';
import type { CaseSummary, InvestigationContract } from '../src/contract/types.ts';
import { PendingLink } from '../components/PendingLink.tsx';

const REPO = 'https://github.com/danielamodu/Trace';

const HEADING =
  'font-display text-[clamp(28px,3.6vw,40px)] font-medium leading-[1.15] tracking-tight text-foreground';

/** Section label — a Slite dust tag chip. Warm pill, never gray. */
function Eyebrow({ children }: { children: ReactNode }) {
  return <span className="tag-chip">{children}</span>;
}

/** Hand-drawn ember oval around one headline word — the Slite signature. */
function Scribble({ children }: { children: ReactNode }) {
  return (
    <span className="scribble">
      {children}
      <svg viewBox="0 0 200 80" fill="none" preserveAspectRatio="none" aria-hidden>
        <path
          d="M186 40 C184 19 140 9 96 9 C45 9 10 23 11 43 C12 63 55 71 103 71 C156 71 192 59 189 36"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          fill="none"
          style={{ vectorEffect: 'non-scaling-stroke' }}
        />
      </svg>
    </span>
  );
}

/** Contract values render as-is; only presentation (thousands, 2dp) is applied. */
function fmt(value: number | string): string {
  return typeof value === 'number'
    ? value.toLocaleString('en-US', { maximumFractionDigits: 2 })
    : value;
}

const PIPELINE = [
  { title: 'Fetch / load', body: 'Live runs call Nansen; curated cases load captured fixtures. Identical downstream.' },
  { title: 'Sanitize', body: 'Strip and redact, drop unusable rows, and count exactly what was cleared.' },
  { title: 'Normalize', body: 'Raw Nansen shapes become one typed, uniform row model.' },
  { title: 'Reconstruct', body: 'Build the timeline, entities, and relationships — pure and deterministic.' },
  { title: 'Contract', body: 'Wrap with coverage, completeness, and evidence. Validate, then deep-freeze.' },
];

const SURFACES = [
  {
    tag: '01',
    kicker: 'offline',
    title: 'Curated library',
    body: 'Vetted, fixture-backed reconstructions you can open, replay, and inspect down to the evidence row. No key required.',
    href: '#library',
    cta: 'Browse cases',
  },
  {
    tag: '02',
    kicker: 'BYO-key',
    title: 'Live reconstruction',
    body: 'Point it at any address and window with your own Nansen key — in the browser, over HTTP, or on the CLI. It runs under a credit budget and reports what it spent.',
    href: '/reconstruct',
    cta: 'Run your own',
  },
  {
    tag: '03',
    kicker: 'programmatic',
    title: 'Engine as API',
    body: 'The same contract over HTTP, a thin CLI, and importable modules. One artifact, however you reach for it.',
    href: REPO,
    cta: 'Read the source',
  },
];

/** Provenance vocabulary — semantic categories rendered in the specimen panel. */
const PROV_TERMS = [
  { term: 'Fact', kind: 'fact', struck: false, body: 'A field Nansen returned directly, unchanged.' },
  { term: 'Derived', kind: 'derived', struck: false, body: 'Computed by TRACE from facts using a named rule — never a guess.' },
  { term: 'Relation', kind: 'relation', struck: false, body: 'A link Nansen reported, such as first funder — a relationship, not proof of control.' },
  { term: 'Hypothesis', kind: 'muted', struck: true, body: 'Interpretation. TRACE never produces one — the boundary is named so it can be enforced.' },
];

/** Hero sub-topic chips — honest descriptors of what the engine produces. */
const HERO_TAGS = ['Evidence timeline', 'Provenance on every claim', 'Deterministic — no LLM'];

/** Live product artifact — a real reconstructed contract, no mock data. */
function HeroPanel({ contract }: { contract: InvestigationContract }) {
  const inv = contract.investigation;
  const metrics = inv.summary.slice(0, 3);
  return (
    <div className="product-shadow overflow-hidden rounded-[18px] border bg-card">
      <div className="flex items-center gap-2 border-b px-4 py-2.5">
        <span className="flex gap-1.5" aria-hidden>
          <i className="size-2.5 rounded-full bg-border" />
          <i className="size-2.5 rounded-full bg-border" />
          <i className="size-2.5 rounded-full bg-border" />
        </span>
        <span className="ml-1 truncate font-mono text-[12px] text-muted-foreground">
          InvestigationContract · {contract.caseId}
        </span>
      </div>
      <div className="p-5">
        <p className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground/80">
          {inv.chain} · {inv.window.from} → {inv.window.to}
        </p>
        <h2 className="mt-1.5 text-lg font-semibold tracking-tight">{inv.name}</h2>
        <dl className="mt-4 space-y-0">
          {metrics.map((m) => (
            <div
              key={m.key}
              className="flex items-baseline justify-between gap-4 border-b border-border/60 py-2.5 first:pt-0 last:border-0 last:pb-0"
            >
              <dt className="text-[12.5px] text-muted-foreground">{m.label}</dt>
              <dd className="shrink-0 font-mono text-[14px] font-medium tabular-nums">
                {fmt(m.value)}
                {m.unit ? <span className="text-muted-foreground"> {m.unit}</span> : null}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 mb-2 font-mono text-[11px] uppercase tracking-wider text-muted-foreground/80">
          Provenance of record
        </p>
        <div className="flex flex-wrap gap-1.5">
          <span className="prov prov-fact">Fact · {contract.evidence.observedFacts}</span>
          <span className="prov prov-derived">Derived · {contract.evidence.derivedValues}</span>
          <span className="prov prov-relation">Relation · {contract.evidence.observedRelations}</span>
        </div>
        <div className="mt-5 flex items-center justify-between border-t pt-4">
          <span className="inline-flex items-center gap-2 font-mono text-[12px] text-muted-foreground">
            <span className="size-1.5 rounded-full" style={{ background: 'var(--relation)' }} />
            {contract.completeness} · {contract.dataSource}
          </span>
          <Link
            href={`/cases/${contract.caseId}`}
            className="text-sm font-medium text-primary hover:underline"
          >
            Open the reconstruction →
          </Link>
        </div>
      </div>
    </div>
  );
}
/** One forensic index row in the case library — aligned metrics, real counts. */
function LibraryRow({ c }: { c: CaseSummary }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <h3 className="truncate text-[16px] font-semibold tracking-tight transition-colors group-hover:text-primary">
          {c.name}
        </h3>
        <p className="mt-1 font-mono text-[12.5px] text-muted-foreground">
          {c.chain} · {c.window.from} → {c.window.to}
        </p>
      </div>
      <div className="flex items-center gap-4 sm:justify-end">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 font-mono text-[12.5px] text-muted-foreground sm:justify-end">
          <span>
            <span className="tabular-nums text-foreground">{c.primaryEvents}</span> events
          </span>
          <span>
            <span className="tabular-nums text-foreground">{c.entities}</span> entities
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span
              className="size-1.5 rounded-full"
              style={{ background: c.completeness === 'complete' ? 'var(--primary)' : 'var(--relation)' }}
            />
            {c.completeness}
          </span>
          <span className="rounded border px-1.5 py-0.5 text-[11px]">{c.dataSource}</span>
        </div>
        <span
          aria-hidden
          className="hidden text-muted-foreground transition-all duration-200 group-hover:translate-x-0.5 group-hover:text-primary sm:inline"
        >
          →
        </span>
      </div>
    </div>
  );
}

export default function Home() {
  const cases = listCaseSummaries();
  const heroCase = cases.find((c) => c.available) ?? null;
  const heroContract = heroCase ? getCaseContract(heroCase.caseId) : null;
  return (
    <div>
      {/* ===== HERO ===== */}
      <section className="relative overflow-hidden" aria-label="Overview">
        <div className="mx-auto max-w-6xl px-5 pb-16 pt-14 sm:px-8 sm:pt-20 lg:pb-24">
          <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
            <span className="enter enter-1 inline-flex items-center gap-2 font-mono text-[12px] uppercase tracking-[0.16em] text-muted-foreground">
              <span className="relative flex size-1.5">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-60" />
                <span className="relative inline-flex size-1.5 rounded-full bg-primary" />
              </span>
              No LLM · no inference · no attribution
            </span>
            <h1 className="enter enter-2 mt-6 font-display text-[clamp(38px,6.2vw,66px)] font-medium leading-[1.08] tracking-tight text-foreground">
              Something happened onchain.
              <br className="hidden sm:block" /> TRACE reconstructs <Scribble>how</Scribble>.
            </h1>
            <p className="enter enter-3 mt-6 max-w-[54ch] text-[19px] leading-relaxed text-muted-foreground">
              Point it at an incident — an exploit, a drain, an unauthorized transfer — and it
              rebuilds the sequence of onchain actions into an evidence timeline. Every claim traces
              back to a specific source row.
            </p>
            <div className="enter enter-4 mt-7 flex flex-wrap items-center justify-center gap-2.5">
              {HERO_TAGS.map((t) => (
                <span key={t} className="tag-chip">
                  {t}
                </span>
              ))}
            </div>
            <div className="enter enter-5 mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link href="/reconstruct" className="cta cta-primary">
                Reconstruct an address →
              </Link>
              <a href="#library" className="cta cta-secondary">
                Browse the case library
              </a>
            </div>
          </div>

          {/* The real product artifact — Slite white product card, centered below. */}
          {heroContract ? (
            <div className="enter enter-4 relative mx-auto mt-16 max-w-3xl">
              <div
                aria-hidden
                className="hero-stage absolute -inset-3 -z-10 rounded-[28px] sm:-inset-5"
              />
              <HeroPanel contract={heroContract} />
            </div>
          ) : null}

          <div className="enter enter-6 mx-auto mt-8 max-w-xl text-center">
            <div className="theme-surface inline-flex items-center gap-2.5 rounded-full border bg-card px-4 py-2 font-mono text-[13px]">
              <span aria-hidden className="select-none text-muted-foreground/60">
                $
              </span>
              <code className="truncate text-foreground">
                npm run trace -- show {heroCase?.caseId ?? 'case_euler_2023'}
              </code>
            </div>
            <p className="mt-3 text-[13px] text-muted-foreground">
              The same contract in the browser, on the CLI, or over HTTP — no key for curated cases.
            </p>
          </div>
        </div>
      </section>
      {/* ===== PIPELINE ===== */}
      <section className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-28">
        <div className="mx-auto max-w-2xl text-center">
          <Eyebrow>How it works</Eyebrow>
          <h2 className={`mt-5 ${HEADING}`}>
            One deterministic pipeline, from raw rows to a signed-off contract.
          </h2>
        </div>
        <div className="relative mt-16">
          <div
            aria-hidden
            className="absolute bottom-0 left-5 top-2 w-px bg-gradient-to-b from-primary/40 via-border to-transparent lg:inset-x-0 lg:bottom-auto lg:left-0 lg:top-5 lg:h-px lg:w-auto lg:bg-gradient-to-r"
          />
          <ol className="relative grid list-none gap-y-9 p-0 lg:grid-cols-5 lg:gap-x-6">
            {PIPELINE.map((s, i) => (
              <li key={s.title} className="relative pl-16 lg:pl-0">
                <span className="product-shadow absolute left-0 top-0 z-10 flex size-10 items-center justify-center rounded-full border bg-card font-mono text-[15px] font-semibold text-primary lg:static lg:mb-5">
                  {i + 1}
                </span>
                <h3 className="font-display text-[18px] font-medium tracking-tight text-foreground">
                  {s.title}
                </h3>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted-foreground">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
        <p className="mx-auto mt-14 max-w-[68ch] text-center text-[14px] leading-relaxed text-muted-foreground">
          Determinism is the invariant: the same inputs — including a fixed timestamp — produce a
          byte-identical contract. That is what lets fixtures stand in for live calls across the
          library and the tests.
        </p>
      </section>

      {/* ===== PROVENANCE ===== */}
      <section className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-28">
        <div className="mx-auto max-w-2xl text-center">
          <Eyebrow>Provenance</Eyebrow>
          <h2 className={`mt-5 ${HEADING}`}>Nothing reads as more certain than its evidence.</h2>
          <p className="mt-5 text-[16px] leading-relaxed text-muted-foreground">
            Every claim carries a provenance category, and the interface lets a reviewer walk from a
            claim to its event to the exact source row behind it.
          </p>
        </div>
        <div className="mt-14 grid items-stretch gap-6 lg:grid-cols-[0.82fr_1.18fr]">
          {/* The single ember card — the product's thesis, stated once. */}
          <div className="flex flex-col justify-center rounded-[32px] bg-primary p-8 text-primary-foreground sm:p-10">
            <p className="font-display text-[26px] font-medium leading-snug">
              TRACE never produces a hypothesis.
            </p>
            <p className="mt-4 text-[15px] leading-relaxed text-white/95">
              The boundary between evidence and interpretation is named in the vocabulary — so it
              can be enforced, not just intended.
            </p>
          </div>
          {/* Vocabulary specimen — white product card. */}
          <div className="product-shadow overflow-hidden rounded-[18px] border bg-card">
            <div className="border-b px-5 py-3">
              <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground/80">
                Provenance vocabulary
              </span>
            </div>
            <dl className="divide-y p-0">
              {PROV_TERMS.map((p) => (
                <div
                  key={p.term}
                  className={`grid grid-cols-[8.5rem_1fr] items-baseline gap-4 px-5 py-4 ${p.struck ? 'bg-muted/50' : ''}`}
                >
                  <dt>
                    {p.struck ? (
                      <span
                        className="prov"
                        style={{ color: 'var(--muted-foreground)', borderColor: 'var(--border)', background: 'var(--muted)', textDecoration: 'line-through' }}
                      >
                        {p.term}
                      </span>
                    ) : (
                      <span className={`prov prov-${p.kind}`}>{p.term}</span>
                    )}
                  </dt>
                  <dd className="text-[13.5px] leading-relaxed text-muted-foreground">{p.body}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
        <div className="mt-6 rounded-[18px] border border-border bg-secondary px-6 py-5">
          <p className="text-[14px] leading-relaxed text-muted-foreground">
            <span className="font-semibold text-foreground">Completeness is earned.</span> A cached
            case is structurally always <span className="font-mono text-foreground">incomplete</span>.
            Only a full live run — status reconstructed, source live-nansen, every coverage flag
            true — can be marked <span className="font-mono text-foreground">complete</span>, and it
            reports exactly what it spent.
          </p>
        </div>
      </section>
      {/* ===== SURFACES ===== */}
      <section className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-28">
        <div className="mx-auto max-w-2xl text-center">
          <Eyebrow>One engine, three surfaces</Eyebrow>
          <h2 className={`mt-5 ${HEADING}`}>
            Open a case, run your own, or call the engine directly.
          </h2>
        </div>
        <div className="mt-14 grid gap-5 md:grid-cols-3">
          {SURFACES.map((s) => {
            const external = s.href.startsWith('http');
            const cls =
              'card-lift group flex flex-col rounded-[32px] border border-border/70 bg-secondary p-8';
            const inner = (
              <>
                <div className="flex items-center justify-between">
                  <span className="font-display text-[34px] font-medium leading-none text-primary/25">
                    {s.tag}
                  </span>
                  <span className="font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground">
                    {s.kicker}
                  </span>
                </div>
                <h3 className="mt-8 font-display text-[21px] font-medium tracking-tight text-foreground">
                  {s.title}
                </h3>
                <p className="mt-2.5 flex-1 text-[14px] leading-relaxed text-muted-foreground">
                  {s.body}
                </p>
                <span className="mt-7 inline-flex items-center gap-1.5 text-[14px] font-semibold text-foreground">
                  {s.cta}
                  <span
                    aria-hidden
                    className="text-primary transition-transform duration-200 group-hover:translate-x-1"
                  >
                    →
                  </span>
                </span>
              </>
            );
            return external ? (
              <a key={s.title} href={s.href} target="_blank" rel="noreferrer noopener" className={cls}>
                {inner}
              </a>
            ) : (
              <Link key={s.title} href={s.href} className={cls}>
                {inner}
              </Link>
            );
          })}
        </div>
      </section>

      {/* ===== CASE LIBRARY (real data) ===== */}
      <section id="library" className="scroll-mt-24">
        <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-28">
          <div className="flex items-end justify-between gap-4">
            <div>
              <Eyebrow>Case library</Eyebrow>
              <h2 className={`mt-4 ${HEADING}`}>Curated reconstructions, ready to inspect.</h2>
            </div>
            <span className="hidden shrink-0 font-mono text-[12px] text-muted-foreground sm:block">
              {cases.length} {cases.length === 1 ? 'case' : 'cases'}
            </span>
          </div>
          <ul className="mt-8 grid list-none gap-3 p-0">
            {cases.map((c) => (
              <li key={c.caseId}>
                <PendingLink href={`/cases/${c.caseId}`} label={`Open investigation: ${c.name}`}>
                  <LibraryRow c={c} />
                </PendingLink>
              </li>
            ))}
          </ul>
          <p className="mt-5 max-w-[72ch] text-[13px] leading-relaxed text-muted-foreground">
            Served from the cached investigation contract — no live queries, no key, no credits.
            Save your own live run into this library with one click, or register a fixture-backed
            case in the repo.
          </p>
        </div>
      </section>

      {/* ===== FINAL CTA ===== */}
      <section className="px-5 py-20 sm:px-8 sm:py-24">
        <div className="mx-auto max-w-6xl">
          <div className="hero-stage relative overflow-hidden rounded-[32px] px-7 py-14 sm:px-14 sm:py-16">
            <div className="flex flex-col items-start gap-6 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-display text-[clamp(26px,3.2vw,38px)] font-medium tracking-tight text-foreground">
                  Reconstruct an incident.
                </h2>
                <p className="mt-2 max-w-[52ch] text-[15px] leading-relaxed text-muted-foreground">
                  Bring your own Nansen key and point TRACE at an address and window. The key stays
                  server-side — never logged, never shipped to a client.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <Link href="/reconstruct" className="cta cta-primary">
                  Reconstruct an address →
                </Link>
                <a href={REPO} target="_blank" rel="noreferrer noopener" className="cta cta-secondary">
                  View on GitHub ↗
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-5 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <p className="font-mono text-[12px] text-muted-foreground">
            TRACE · deterministic onchain incident reconstruction
          </p>
          <p className="font-mono text-[12px] text-muted-foreground">
            MIT ·{' '}
            <a className="hover:text-foreground" href={REPO} target="_blank" rel="noreferrer noopener">
              github.com/danielamodu/Trace
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
}

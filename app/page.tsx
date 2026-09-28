import { ArrowRight, ArrowUpRight, Clock3, Database, FileCheck2, GitBranch, Network } from 'lucide-react';
import Link from 'next/link';
import { getCaseContract, listCaseSummaries } from '@/lib/cases.ts';
import { fmtWindow } from '@/components/format.ts';

function chainLabel(chain: string): string {
  const c = chain.trim();
  if (!c) return 'Unknown chain';
  return c.charAt(0).toUpperCase() + c.slice(1);
}

export default function Home() {
  const cards = listCaseSummaries().map((s) => {
    const contract = getCaseContract(s.caseId);
    return {
      id: s.caseId,
      name: s.name,
      headline: contract?.investigation.headline ?? 'Reconstructed from captured onchain evidence.',
      chain: chainLabel(s.chain),
      window: fmtWindow(s.window),
      primaryEvents: s.primaryEvents,
      entities: s.entities,
      live: s.dataSource === 'live-nansen',
      complete: s.completeness === 'complete',
    };
  });

  return (
    <div className="page-wrap home-page">
      <div className="home-hero">
        <div className="hero-copy">
          <div className="eyebrow"><span className="eyebrow-line" /> INVESTIGATION WORKSPACE</div>
          <h1>Follow the evidence.<br /><span>Understand the flow.</span></h1>
          <p className="hero-description">Reconstruct how value moved, inspect the evidence behind each conclusion, and share a case others can verify.</p>
          <div className="hero-actions">
            <Link href="/reconstruct" className="button button-primary">Start a reconstruction <ArrowRight size={17} aria-hidden="true" /></Link>
            <a href="#how-it-works" className="text-link">How verification works <ArrowUpRight size={15} aria-hidden="true" /></a>
          </div>
        </div>
        <div className="hero-visual" aria-label="Illustration of a traceable sequence of events">
          <div className="visual-caption"><span className="live-dot" /> A clear path through complex activity</div>
          <div className="flow-graphic" aria-hidden="true">
            <div className="flow-node flow-node-start"><span className="node-orb">01</span><span className="flow-label">Source</span></div>
            <span className="flow-line line-one" />
            <div className="flow-node flow-node-mid"><span className="node-orb">02</span><span className="flow-label">Evidence</span></div>
            <span className="flow-line line-two" />
            <div className="flow-node flow-node-end"><span className="node-orb">03</span><span className="flow-label">Destination</span></div>
            <span className="flow-note flow-note-top">every conclusion has a source</span>
            <span className="flow-note flow-note-bottom">facts · relationships · derivations</span>
          </div>
        </div>
      </div>

      <section className="section-block" aria-labelledby="investigations-heading">
        <div className="section-heading">
          <div>
            <div className="eyebrow">YOUR LIBRARY</div>
            <h2 id="investigations-heading">Investigations</h2>
            <p>Open a case to review its timeline and source trail.</p>
          </div>
          <span className="quiet-count">{cards.length} {cards.length === 1 ? 'investigation' : 'investigations'}</span>
        </div>
        <div className="case-grid">
          {cards.map((item, index) => (
            <Link href={`/cases/${item.id}`} className="case-card" key={item.id}>
              <div className="case-card-top">
                <span className={`case-icon case-icon-${index % 3}`}><Network size={18} strokeWidth={1.7} aria-hidden="true" /></span>
                <span className={`origin-pill${item.live ? ' origin-live' : ''}`}><span className="origin-dot" /> {item.live ? 'Live Nansen' : 'Fixture cache'}</span>
              </div>
              <h3>{item.name}</h3>
              <p className="case-description">{item.headline}</p>
              <div className="case-meta-row">
                <span><Database size={14} aria-hidden="true" /> {item.chain}</span>
                <span><Clock3 size={14} aria-hidden="true" /> {item.window}</span>
              </div>
              <div className="case-card-bottom">
                <div className="case-stat"><strong>{String(item.primaryEvents).padStart(2, '0')}</strong><span>events</span></div>
                <div className="case-stat"><strong>{String(item.entities).padStart(2, '0')}</strong><span>entities</span></div>
                <span className={`coverage-label${item.complete ? ' is-complete' : ''}`}><span className="coverage-dot" /> {item.complete ? 'Complete' : 'Incomplete'}</span>
                <span className="card-arrow" aria-hidden="true"><ArrowRight size={17} /></span>
              </div>
            </Link>
          ))}
          <Link href="/reconstruct" className="new-case-card">
            <span className="new-case-icon"><GitBranch size={19} aria-hidden="true" /></span>
            <span className="new-case-title">Start a new reconstruction</span>
            <span className="new-case-copy">Bring an address and a date range. Review the scope before any paid request.</span>
            <span className="new-case-link">Set up a run <ArrowRight size={15} aria-hidden="true" /></span>
          </Link>
        </div>
      </section>

      <section className="how-section" id="how-it-works" aria-labelledby="how-heading">
        <div className="how-intro">
          <div className="eyebrow">A CLEARER WAY TO REVIEW</div>
          <h2 id="how-heading">From raw activity<br />to portable proof.</h2>
        </div>
        <div className="how-steps">
          <article className="how-step"><span className="step-index">01</span><h3>Reconstruct</h3><p>Set the address and time window. See the scope before a provider call is made.</p></article>
          <article className="how-step"><span className="step-index">02</span><h3>Review</h3><p>Walk the timeline. Separate source facts from relationships and derived summaries.</p></article>
          <article className="how-step"><span className="step-index">03</span><h3>Verify</h3><p>Share a case file with a fingerprint others can check independently.</p></article>
        </div>
      </section>

      <div className="api-strip"><span className="api-icon"><FileCheck2 size={17} aria-hidden="true" /></span><div><strong>Built for transparent investigations</strong><span>Source detail, provenance, and verification belong in the same workflow.</span></div></div>
    </div>
  );
}

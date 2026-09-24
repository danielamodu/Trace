import Link from 'next/link';

import { ThemeToggle } from '@/components/theme-toggle';

const REPO = 'https://github.com/danielamodu/Trace';

/** Evidence-graph glyph: two source nodes converging on a focus, then a step down. */
function TraceMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden className="text-primary">
      <path
        d="M4 5.5 L10 10 L16 5.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.5"
      />
      <path d="M10 10 L10 15.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="4" cy="5.5" r="1.6" fill="currentColor" />
      <circle cx="16" cy="5.5" r="1.6" fill="currentColor" />
      <circle cx="10" cy="10" r="2.1" fill="currentColor" />
      <circle cx="10" cy="15.8" r="1.5" fill="currentColor" />
    </svg>
  );
}

/** App chrome, Slite register: a quiet cream bar — wordmark, ghost nav, one charcoal pill. */
export function SiteHeader() {
  return (
    <header className="theme-surface sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-5 sm:px-8">
        <Link href="/" className="group flex items-center gap-2.5" aria-label="TRACE — home">
          <TraceMark />
          <span className="flex items-baseline gap-2.5">
            <span className="text-[16px] font-extrabold tracking-[0.2em] text-foreground">TRACE</span>
            <span className="hidden text-[13px] text-muted-foreground sm:inline">
              incident reconstruction
            </span>
          </span>
        </Link>
        <nav className="ml-auto flex items-center gap-1" aria-label="Primary">
          <Link
            href="/verify"
            className="hidden rounded-full px-3 py-1.5 text-[14px] font-medium text-muted-foreground transition-colors hover:text-foreground sm:inline-flex"
          >
            Verify
          </Link>
          <a
            href={REPO}
            target="_blank"
            rel="noreferrer noopener"
            className="hidden rounded-full px-3 py-1.5 text-[14px] font-medium text-muted-foreground transition-colors hover:text-foreground sm:inline-flex"
          >
            GitHub ↗
          </a>
          <ThemeToggle />
          <Link
            href="/reconstruct"
            className="ml-1.5 inline-flex h-9 items-center rounded-full bg-foreground px-4 text-[14px] font-semibold text-background transition-opacity hover:opacity-90"
          >
            Reconstruct
          </Link>
        </nav>
      </div>
    </header>
  );
}

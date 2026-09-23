import Link from 'next/link';

import { ThemeToggle } from '@/components/theme-toggle';

/** Shared app chrome: wordmark home-link + theme switch. Glass + crossfade. */
export function SiteHeader() {
  return (
    <header className="theme-surface glass sticky top-0 z-40 border-b">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-5">
        <Link href="/" className="group flex items-baseline gap-2.5">
          <span className="text-[15px] font-extrabold tracking-[0.24em] text-foreground">
            TRACE
          </span>
          <span className="hidden text-xs tracking-wide text-muted-foreground sm:inline">
            incident reconstruction
          </span>
        </Link>
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CircleHelp, FileCheck2, GitBranch, Search, type LucideIcon } from 'lucide-react';

interface NavItem {
  href: string;
  label: string;
  Icon: LucideIcon;
}

const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Cases', Icon: Search },
  { href: '/reconstruct', label: 'Reconstruct', Icon: GitBranch },
  { href: '/verify', label: 'Verify', Icon: FileCheck2 },
];

/** Cases owns the home route and every /cases/* detail; the rest match exactly. */
function isActive(href: string, pathname: string): boolean {
  if (href === '/') return pathname === '/' || pathname === '/cases' || pathname.startsWith('/cases/');
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '/';

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <Link href="/" className="brand" aria-label="TRACE home">
            <span className="brand-mark" aria-hidden="true"><span /><span /><span /></span>
            TRACE
          </Link>
          <nav className="primary-nav" aria-label="Primary">
            {NAV_ITEMS.map(({ href, label, Icon }) => (
              <Link key={href} href={href} className={`nav-link${isActive(href, pathname) ? ' is-active' : ''}`} aria-current={isActive(href, pathname) ? 'page' : undefined}>
                <Icon size={15} aria-hidden="true" /> {label}
              </Link>
            ))}
          </nav>
          <Link href="/#how-it-works" className="help-link">
            <CircleHelp size={14} aria-hidden="true" /> How verification works
          </Link>
        </div>
      </header>

      <main className="app-main route-transition" key={pathname}>{children}</main>

      <footer className="site-footer">
        <div className="footer-inner">
          <span>TRACE <span className="middot">·</span> onchain incident reconstruction</span>
          <span>Every conclusion has a source <span className="middot">·</span> built on Nansen data</span>
        </div>
      </footer>
    </div>
  );
}

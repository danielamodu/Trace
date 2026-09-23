import type { Metadata } from 'next';
import { Manrope } from 'next/font/google';
import { cookies } from 'next/headers';
import './globals.css';

import { SiteHeader } from '@/components/site-header';

const manrope = Manrope({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-manrope',
});

export const metadata: Metadata = {
  title: 'TRACE — Onchain Incident Reconstruction',
  description:
    'Something happened. TRACE reconstructs how it happened — from observed onchain evidence.',
};

/**
 * Theme is resolved server-side from the `trace-theme` cookie (default: dark),
 * so the `.dark` class is present in the first byte of HTML — no flash, and no
 * client theme-init script (React 19 rejects component-rendered <script> tags,
 * which is what broke next-themes here). The toggle flips the class live and
 * writes the cookie so the next load stays consistent. suppressHydrationWarning
 * covers that post-hydration class mutation on <html>.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = (await cookies()).get('trace-theme')?.value;
  const isDark = theme !== 'light';
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${manrope.variable}${isDark ? ' dark' : ''}`}
      style={{ colorScheme: isDark ? 'dark' : 'light' }}
    >
      <body className="theme-surface min-h-screen bg-background text-foreground antialiased">
        {/* Decorative evidence-board rails; hidden on narrow viewports. */}
        <div
          aria-hidden
          className="hatch pointer-events-none fixed inset-y-0 left-0 z-0 hidden w-6 lg:block"
        />
        <div
          aria-hidden
          className="hatch pointer-events-none fixed inset-y-0 right-0 z-0 hidden w-6 lg:block"
        />
        <div className="relative z-10 flex min-h-screen flex-col">
          <SiteHeader />
          <main className="flex-1">{children}</main>
        </div>
      </body>
    </html>
  );
}

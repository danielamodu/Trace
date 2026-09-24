import type { Metadata } from 'next';
import { Manrope, Lora } from 'next/font/google';
import { cookies } from 'next/headers';
import './globals.css';

import { SiteHeader } from '@/components/site-header';

// UniversalSans substitute — humanist sans, carries all body/UI copy.
const manrope = Manrope({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-manrope',
});

// Garnett substitute — humanist serif for editorial display headings.
const lora = Lora({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-lora',
});

export const metadata: Metadata = {
  title: 'TRACE — Onchain Incident Reconstruction',
  description:
    'Something happened. TRACE reconstructs how it happened — from observed onchain evidence.',
};

/**
 * Theme is resolved server-side from the `trace-theme` cookie (default: light),
 * so the theme class is present in the first byte of HTML — no flash, and no
 * client theme-init script (React 19 rejects component-rendered <script> tags,
 * which is what broke next-themes here). The toggle flips the class live and
 * writes the cookie so the next load stays consistent. suppressHydrationWarning
 * covers that post-hydration class mutation on <html>.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = (await cookies()).get('trace-theme')?.value;
  const isDark = theme === 'dark';
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${manrope.variable} ${lora.variable}${isDark ? ' dark' : ''}`}
      style={{ colorScheme: isDark ? 'dark' : 'light' }}
    >
      <body className="theme-surface min-h-screen bg-background text-foreground antialiased">
        <div className="relative z-10 flex min-h-screen flex-col">
          <SiteHeader />
          <main className="flex-1">{children}</main>
        </div>
      </body>
    </html>
  );
}

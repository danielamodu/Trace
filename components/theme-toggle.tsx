'use client';

import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

import { Button } from '@/components/ui/button';

/**
 * Light/dark switch. The server sets the initial theme class from the
 * `trace-theme` cookie (app/layout.tsx), so SSR renders the true theme with no
 * flash. Toggling flips the class live and writes the cookie for the next load.
 */
export function ThemeToggle() {
  // Matches the SSR default (light) so the first client render is identical;
  // corrected from the real class on mount for cookie=dark returning visitors.
  const [isDark, setIsDark] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setIsDark(document.documentElement.classList.contains('dark'));
  }, []);

  const toggle = () => {
    const next = !document.documentElement.classList.contains('dark');
    const root = document.documentElement;
    root.classList.toggle('dark', next);
    root.style.colorScheme = next ? 'dark' : 'light';
    // One year; SameSite=Lax is enough for a same-site UI preference.
    document.cookie = `trace-theme=${next ? 'dark' : 'light'}; path=/; max-age=31536000; SameSite=Lax`;
    setIsDark(next);
  };

  const label = mounted ? `Switch to ${isDark ? 'light' : 'dark'} theme` : 'Toggle theme';

  return (
    <Button
      variant="outline"
      size="icon"
      aria-label={label}
      title={label}
      onClick={toggle}
      className="theme-surface relative"
    >
      {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  );
}

'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * Link with an honest pending state. Case renders are server-side and fast, so
 * this navigation indicator (not an SSR skeleton, which would force
 * streamed-200 responses on unknown cases) is the loading treatment.
 */
export function PendingLink({
  href,
  label,
  children,
}: {
  href: string;
  label: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <Link
      className="theme-surface group block rounded-2xl border bg-card p-5 transition-shadow hover:border-primary/50 hover:[box-shadow:var(--shadow-product)] aria-[busy=true]:opacity-70"
      href={href}
      aria-label={label}
      aria-busy={pending || undefined}
      onClick={(e) => {
        e.preventDefault();
        if (pending) return;
        setPending(true);
        router.push(href);
      }}
    >
      {children}
      {pending && (
        <p className="mt-2 font-mono text-xs text-primary" role="status">
          Opening investigation…
        </p>
      )}
    </Link>
  );
}

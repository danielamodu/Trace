import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="page-wrap not-found">
      <div className="eyebrow">PAGE NOT FOUND</div>
      <h1>Nothing to trace here.</h1>
      <p>That page doesn’t exist. Head back to your investigations to pick up a case.</p>
      <Link href="/" className="button button-primary">Back to investigations <ArrowRight size={16} aria-hidden="true" /></Link>
    </div>
  );
}

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="page-wrap not-found">
      <div className="eyebrow">CASE NOT FOUND</div>
      <h1>No such case</h1>
      <p>We couldn’t find that investigation. It may have been a live run that isn’t bundled here.</p>
      <Link href="/" className="button button-primary">Back to cases <ArrowRight size={16} aria-hidden="true" /></Link>
    </div>
  );
}

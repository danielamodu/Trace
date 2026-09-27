import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="text-6xl">🔍</div>
      <h1 className="text-2xl font-black text-ink">No such case</h1>
      <p className="max-w-sm font-semibold text-wolf">
        We couldn’t find that investigation. It may have been a live run that isn’t bundled here.
      </p>
      <Link href="/" className="btn btn-green">Back to cases</Link>
    </main>
  );
}

import Link from "next/link";

export default function NotFoundPage() {
  return (
    <div className="grid min-h-dvh place-items-center bg-background px-6 py-10">
      <div className="w-full max-w-xl rounded-2xl border border-border bg-background-light p-8 shadow-sm">
        <h1 className="text-3xl font-medium tracking-tight text-foreground">Page not found</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          The route you requested does not exist.
        </p>
        <Link
          className="mt-6 inline-flex rounded-md border border-input bg-background px-4 py-2 text-sm text-foreground shadow-sm transition-colors hover:border-foreground/25 hover:bg-muted/60"
          href="/"
        >
          Go to inbox
        </Link>
      </div>
    </div>
  );
}

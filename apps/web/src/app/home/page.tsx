import Link from "next/link";
import { redirectIfAuthenticated } from "~/lib/server-auth";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  await redirectIfAuthenticated("/");

  return (
    <div className="grid min-h-dvh w-full place-items-center">
      <div className="flex gap-3">
        <Link
          className="inline-flex h-10 items-center justify-center rounded-md border border-primary bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
          href="/login"
        >
          Log in
        </Link>
        <Link
          className="inline-flex h-10 items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted/60"
          href="/signup"
        >
          Sign up
        </Link>
      </div>
    </div>
  );
}

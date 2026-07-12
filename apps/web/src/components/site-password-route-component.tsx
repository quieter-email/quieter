export const SitePasswordRouteComponent = ({
  hasSitePasswordError,
  returnTo,
}: {
  hasSitePasswordError: boolean;
  returnTo: string;
}) => (
  <main className="grid min-h-dvh place-items-center bg-background px-6 py-10">
    <div className="w-full max-w-sm">
      <h1 className="text-2xl font-medium tracking-normal text-foreground">quieter</h1>
      <p className="mt-2 text-sm/6 text-muted-foreground">
        This site is temporarily password protected.
      </p>

      <form action="/api/site-password" className="mt-6 grid gap-3" method="post">
        <input name="returnTo" type="hidden" value={returnTo} />
        <input
          aria-label="Site password"
          autoComplete="current-password"
          className="keyboard-focus-ring h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-sm outline-none placeholder:text-muted-foreground"
          name="password"
          placeholder="Password"
          required
          type="password"
        />
        {hasSitePasswordError && (
          <p className="text-sm text-destructive">That password did not work.</p>
        )}
        <button
          className="inline-flex h-10 items-center justify-center rounded-md border border-primary bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90"
          type="submit"
        >
          Unlock site
        </button>
      </form>
    </div>
  </main>
);

import { Button } from "@quieter/ui/button";
import { Input } from "@quieter/ui/input";
import { Text } from "@quieter/ui/text";

export const SitePasswordRouteComponent = ({
  hasSitePasswordError,
  returnTo,
}: {
  hasSitePasswordError: boolean;
  returnTo: string;
}) => (
  <main className="grid min-h-dvh place-items-center px-6 py-10">
    <div className="w-full max-w-sm">
      <h1 className="text-title-md font-medium tracking-normal text-fg">
        quieter
      </h1>
      <p className="mt-2 text-body/6 text-muted-fg">
        This site is temporarily password protected.
      </p>

      <form
        action="/api/site-password"
        className="mt-6 grid gap-3"
        method="post"
      >
        <input name="returnTo" type="hidden" value={returnTo} />
        <Input
          aria-label="Site password"
          autoComplete="current-password"
          name="password"
          placeholder="Password"
          required
          size="lg"
          type="password"
        />
        {hasSitePasswordError && (
          <Text tone="destructive">That password did not work.</Text>
        )}
        <Button size="lg" type="submit">
          Unlock site
        </Button>
      </form>
    </div>
  </main>
);

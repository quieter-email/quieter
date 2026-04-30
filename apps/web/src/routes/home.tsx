import { Link, createFileRoute, redirect } from "@tanstack/react-router";
import { getSessionUser } from "~/lib/auth.functions";
export const Route = createFileRoute("/home")({
  loader: async () => {
    const user = await getSessionUser();

    if (user) {
      throw redirect({
        to: "/",
      });
    }
  },
  component: HomePage,
});

function HomePage() {
  return (
    <div className="grid min-h-dvh w-full place-items-center">
      <div className="flex gap-3">
        <Link
          className="inline-flex h-10 items-center justify-center rounded-md border border-primary bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90"
          to="/login"
        >
          Log in
        </Link>
        <Link
          className="inline-flex h-10 items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium text-foreground shadow-sm hover:bg-muted/60"
          to="/signup"
        >
          Sign up
        </Link>
      </div>
    </div>
  );
}

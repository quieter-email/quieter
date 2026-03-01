import { Button } from "@quietr/ui";
import { createAsync, query, redirect } from "@solidjs/router";
import { getSession, signIn } from "~/lib/auth";

const ensureNotAuthenticated = query(async () => {
  "use server";

  const session = await getSession();
  if (session?.user) return redirect("/");
}, "ensureNotAuthenticated");

export default function AuthPage() {
  createAsync(() => ensureNotAuthenticated());

  return (
    <div class="grid min-h-dvh w-full place-items-center">
      <div>
        <Button
          onClick={() => {
            void signIn
              .social({
                provider: "google",
              })
              .catch((error) => {
                console.error(error);
              });
          }}
        >
          Login with Google
        </Button>
      </div>
    </div>
  );
}

import { A } from "@solidjs/router";

export default function HomePage() {
  return (
    <div class="grid min-h-dvh w-full place-items-center">
      <A class="text-sm text-muted-foreground hover:text-foreground" href="/auth">
        Auth
      </A>
    </div>
  );
}

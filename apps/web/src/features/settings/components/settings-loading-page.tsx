import { SettingsLoadingRows } from "./settings-layout";

export const SettingsLoadingPage = () => (
  <main className="flex min-h-dvh bg-background-dark text-foreground">
    <div className="mx-auto w-full max-w-205 px-5 py-14 md:px-8">
      <div className="space-y-8">
        <div className="h-5 w-24 animate-pulse rounded-full bg-muted/45 motion-reduce:animate-none" />
        <SettingsLoadingRows label="Loading settings" rows={5} />
      </div>
    </div>
  </main>
);

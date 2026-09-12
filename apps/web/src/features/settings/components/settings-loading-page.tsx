import { LoadingSpinner } from "#/components/loading-spinner";
import { SETTINGS_TITLES } from "#/features/settings/domain/settings-navigation";
import type { SettingsTab } from "#/features/settings/domain/settings-tab";

export const SettingsLoadingPage = ({
  tab = "overview",
}: {
  tab?: SettingsTab;
}) => (
  <div className="flex h-dvh bg-bg text-fg">
    <aside
      aria-hidden
      className="hidden w-60 shrink-0 space-y-6 border-r border-border bg-bg-raised p-6 md:block"
    >
      <p className="text-caption text-muted-fg">Back to mail</p>
      <div className="space-y-3">
        <p className="text-caption text-muted-fg">Personal</p>
        {[
          "Account",
          "Preferences",
          "AI & personalization",
          "Connected apps",
        ].map((label) => (
          <p className="text-body" key={label}>
            {label}
          </p>
        ))}
      </div>
      <div className="space-y-3">
        <p className="text-caption text-muted-fg">Team settings</p>
        <div className="h-9 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
        {[
          "General",
          "Members & access",
          "Mailboxes",
          "Domains",
          "Delivery",
          "Billing & usage",
          "API keys",
        ].map((label) => (
          <p className="text-body" key={label}>
            {label}
          </p>
        ))}
      </div>
    </aside>
    <main className="min-w-0 flex-1 px-5 py-6 md:px-10 md:py-8">
      <div className="mx-auto max-w-220 space-y-8">
        <div aria-hidden className="h-9 rounded-md bg-muted" />
        <h1 className="text-title-sm font-normal">{SETTINGS_TITLES[tab]}</h1>
        <output
          aria-label="Loading settings"
          className="flex min-h-64 items-center justify-center"
        >
          <LoadingSpinner className="size-8 text-muted-fg" />
          <span className="sr-only">Loading settings</span>
        </output>
      </div>
    </main>
  </div>
);

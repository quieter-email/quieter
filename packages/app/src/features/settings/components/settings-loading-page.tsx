import { LoadingSpinner } from "@quieter/app/components/loading-spinner";
import { SETTINGS_TITLES } from "@quieter/app/features/settings/domain/settings-navigation";
import type { SettingsTab } from "@quieter/app/features/settings/domain/settings-tab";
import { WorkspaceSection } from "@quieter/ui/workspace-section";

export const SettingsLoadingPage = ({
  tab = "overview",
}: {
  tab?: SettingsTab;
}) => (
  <div className="flex h-dvh text-fg">
    <aside aria-hidden className="hidden w-68 shrink-0 space-y-6 p-6 lg:block">
      <p className="text-caption text-muted-fg">Back to mail</p>
      <div className="space-y-3">
        <p className="text-caption text-muted-fg">Personal</p>
        {["Account", "Preferences", "Memories", "Connected apps"].map(
          (label) => (
            <p className="text-body" key={label}>
              {label}
            </p>
          )
        )}
      </div>
      <div className="space-y-3">
        <p className="text-caption text-muted-fg">Team settings</p>
        <div className="h-9 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
        {[
          "General",
          "Members & access",
          "Mailboxes",
          "Divisions",
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
    <main className="relative min-w-0 flex-1">
      <WorkspaceSection>
        <div className="mx-auto w-full max-w-180 space-y-8 px-5 py-8 md:px-8 md:py-14">
          <h1 className="text-title-sm font-normal">{SETTINGS_TITLES[tab]}</h1>
          <output
            aria-label="Loading settings"
            className="flex min-h-64 items-center justify-center"
          >
            <LoadingSpinner className="size-8 text-muted-fg" />
            <span className="sr-only">Loading settings</span>
          </output>
        </div>
      </WorkspaceSection>
    </main>
  </div>
);

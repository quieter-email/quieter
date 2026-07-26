import type { SettingsTab } from "~/features/settings/domain/settings-tab";
import { WorkspaceDitherBackground } from "~/components/workspace-dither-background";
import { SETTINGS_DETAIL_TITLES } from "~/features/settings/domain/settings-navigation";
import { SettingsInlineLoading, SettingsLoadingState, SettingsPageHeader } from "./settings-layout";
import { SettingsOverviewContent } from "./settings-overview-panel";

export const SettingsLoadingPage = ({ tab = "overview" }: { tab?: SettingsTab }) => (
  <main className="relative isolate min-h-dvh overflow-hidden bg-background-dark text-foreground">
    <WorkspaceDitherBackground />
    <div className="relative z-10 mx-auto w-full max-w-205 px-5 py-8 md:px-8 md:py-14">
      {tab === "overview" ? (
        <SettingsOverviewContent
          disabled
          meta={{
            account: <SettingsInlineLoading label="Loading account" />,
            connectors: <SettingsInlineLoading label="Loading connectors" />,
            mailboxes: <SettingsInlineLoading label="Loading mailboxes" />,
            organization: <SettingsInlineLoading label="Loading teams" />,
          }}
        />
      ) : (
        <div className="space-y-8">
          <SettingsPageHeader title={SETTINGS_DETAIL_TITLES[tab].title} />
          <SettingsLoadingState className="min-h-64" label={`Loading ${tab} settings`} />
        </div>
      )}
    </div>
  </main>
);

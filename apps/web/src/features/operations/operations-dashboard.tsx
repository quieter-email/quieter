import {
  ArrowLeft01Icon,
  DashboardSquare01Icon,
  Settings01Icon,
} from "@hugeicons/core-free-icons";
import { Button } from "@quieter/ui/button";
import { Icon } from "@quieter/ui/icon";
import { Pill } from "@quieter/ui/pill";
import { SettingsPageHeader } from "@quieter/ui/settings-layout";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@quieter/ui/tabs";
import { WorkspaceSection } from "@quieter/ui/workspace-section";
import { Link } from "@tanstack/react-router";

import { OperationsOverview } from "./operations-overview";
import { OperationsSettings } from "./operations-settings";

export const OperationsDashboard = () => (
  <main className="relative h-dvh min-h-0 text-fg">
    <WorkspaceSection aria-label="Operations dashboard">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-300 space-y-6 px-4 py-5 sm:px-8 sm:py-8">
          <div className="flex items-center justify-between gap-4">
            <Button
              nativeButton={false}
              render={<Link to="/settings" />}
              // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Button renders an anchor through its render slot.
              role="link"
              size="sm"
              variant="ghost"
            >
              <Icon icon={ArrowLeft01Icon} />
              Back to settings
            </Button>
            <Pill size="xs" tone="neutral">
              Internal
            </Pill>
          </div>
          <SettingsPageHeader title="Operations">
            Monitor activity and manage Quieter’s operational settings.
          </SettingsPageHeader>
          <Tabs defaultValue="overview">
            <TabsList aria-label="Operations views" variant="plain">
              <TabsTab value="overview">
                <Icon icon={DashboardSquare01Icon} size={15} />
                Overview
              </TabsTab>
              <TabsTab value="configuration">
                <Icon icon={Settings01Icon} size={15} />
                Configuration
              </TabsTab>
            </TabsList>
            <TabsPanel value="overview">
              <OperationsOverview />
            </TabsPanel>
            <TabsPanel value="configuration">
              <OperationsSettings />
            </TabsPanel>
          </Tabs>
        </div>
      </div>
    </WorkspaceSection>
  </main>
);

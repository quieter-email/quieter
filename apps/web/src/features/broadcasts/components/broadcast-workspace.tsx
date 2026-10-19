import {
  ArrowLeft01Icon,
  MailSend02Icon,
  Menu01Icon,
  UserGroupIcon,
  NoteEditIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button, LinkButton } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectList,
  SelectTrigger,
  SelectValue,
} from "@quieter/ui/select";
import { WorkspaceSection } from "@quieter/ui/workspace-section";
import { WorkspaceSidebar } from "@quieter/ui/workspace-sidebar";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { createContext, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { fullOrganizationQueryOptions } from "#/features/settings/components/organization-settings/domain";
import {
  SettingsErrorState,
  SettingsLoadingState,
} from "#/features/settings/components/settings-layout";
import { authClient } from "#/lib/auth";
import { useOrderedOrganizations } from "#/lib/use-ordered-organizations";

const BroadcastContext = createContext({
  canManage: false,
  organizationId: "",
});

export const useBroadcastWorkspace = () => useContext(BroadcastContext);

export const BroadcastWorkspace = ({
  children,
  organizationId: requestedId,
  section,
}: {
  children: ReactNode;
  organizationId?: string;
  section: "audiences" | "campaigns" | "templates";
}) => {
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const organizations = useOrderedOrganizations();
  const team = requestedId
    ? organizations.data?.find((item) => item.id === requestedId)
    : organizations.data?.[0];
  const organizationId = team?.id ?? "";
  const session = authClient.useSession().data;
  const details = useQuery({
    ...fullOrganizationQueryOptions(organizationId),
    enabled: organizationId !== "",
  });
  const role = details.data?.members.find(
    (item) => item.userId === session?.user.id
  )?.role;
  const canManage =
    role?.split(",").some((item) => ["owner", "admin"].includes(item.trim())) ??
    false;
  const context = useMemo(
    () => ({ canManage, organizationId }),
    [canManage, organizationId]
  );
  let content: ReactNode = (
    <BroadcastContext value={context}>
      <div key={organizationId}>{children}</div>
    </BroadcastContext>
  );
  if (organizations.isPending) {
    content = <SettingsLoadingState label="Loading teams" />;
  } else if (organizations.error) {
    content = (
      <SettingsErrorState
        message="Could not load teams."
        onRetry={() => void organizations.refetch()}
      />
    );
  } else if (!team) {
    content = (
      <p className="text-body text-muted-fg">
        {requestedId
          ? "This team is unavailable. Choose another team to continue."
          : "Create a team in Settings to manage audiences and campaigns."}
      </p>
    );
  }

  return (
    <div className="pt-safe pr-safe pb-safe pl-safe relative isolate flex h-dvh min-h-0 overflow-hidden text-fg lg:p-0">
      <WorkspaceSidebar
        isMobileOpen={mobileOpen}
        label="Broadcast navigation"
        onMobileOpenChange={setMobileOpen}
      >
        {(close) => (
          <div className="relative z-10 flex min-h-0 flex-1 flex-col gap-6 px-5 py-6">
            <LinkButton onClick={close} size="sm" to="/" variant="ghost">
              <HugeiconsIcon
                aria-hidden
                className="size-4"
                icon={ArrowLeft01Icon}
              />
              Back to mail
            </LinkButton>
            <div className="space-y-2">
              <p className="text-caption text-muted-fg">Team</p>
              <Select
                items={
                  organizations.data?.map((item) => ({
                    label: item.name,
                    value: item.id,
                  })) ?? []
                }
                onValueChange={(value) => {
                  if (value) {
                    close?.();
                    void navigate({
                      search: { organizationId: value },
                      to: {
                        audiences: "/audiences",
                        campaigns: "/campaigns",
                        templates: "/templates",
                      }[section],
                    });
                  }
                }}
                value={organizationId}
              >
                <SelectTrigger aria-label="Choose team">
                  <SelectValue placeholder="Choose a team" />
                </SelectTrigger>
                <SelectContent>
                  <SelectList>
                    {organizations.data?.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.name}
                      </SelectItem>
                    ))}
                  </SelectList>
                </SelectContent>
              </Select>
            </div>
            <nav aria-label="Broadcasts" className="grid gap-1">
              <LinkButton
                aria-current={section === "audiences" ? "page" : undefined}
                onClick={close}
                search={{ organizationId }}
                to="/audiences"
                variant={section === "audiences" ? "secondary" : "ghost"}
              >
                <HugeiconsIcon
                  aria-hidden
                  className="size-4"
                  icon={UserGroupIcon}
                />
                Audiences
              </LinkButton>
              <LinkButton
                aria-current={section === "templates" ? "page" : undefined}
                onClick={close}
                search={{ organizationId }}
                to="/templates"
                variant={section === "templates" ? "secondary" : "ghost"}
              >
                <HugeiconsIcon
                  aria-hidden
                  className="size-4"
                  icon={NoteEditIcon}
                />
                Templates
              </LinkButton>
              <LinkButton
                aria-current={section === "campaigns" ? "page" : undefined}
                onClick={close}
                search={{ organizationId }}
                to="/campaigns"
                variant={section === "campaigns" ? "secondary" : "ghost"}
              >
                <HugeiconsIcon
                  aria-hidden
                  className="size-4"
                  icon={MailSend02Icon}
                />
                Campaigns
              </LinkButton>
            </nav>
            <p className="mt-auto text-caption text-muted-fg">
              {team?.name ?? "Your team"}
            </p>
          </div>
        )}
      </WorkspaceSidebar>
      <main className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
        <WorkspaceSection>
          <div className="px-4 pt-3 lg:hidden">
            <IconButtonTooltip label="Open broadcast menu">
              <Button
                aria-label="Open broadcast menu"
                onClick={() => {
                  setMobileOpen(true);
                }}
                size="icon-sm"
                variant="ghost"
              >
                <HugeiconsIcon
                  aria-hidden
                  className="size-4"
                  icon={Menu01Icon}
                />
              </Button>
            </IconButtonTooltip>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div
              className={cn("mx-auto w-full px-5 py-6 md:px-7", {
                "max-w-240 space-y-8 md:py-14": section === "audiences",
                "max-w-440": section !== "audiences",
              })}
            >
              {content}
            </div>
          </div>
        </WorkspaceSection>
      </main>
    </div>
  );
};

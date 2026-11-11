import {
  SettingsErrorState,
  SettingsLoadingState,
} from "@quieter/app/features/settings/components/settings-layout";
import { toastError } from "@quieter/app/lib/error-toast";
import { orpc } from "@quieter/app/lib/orpc";
import { Pill } from "@quieter/ui/pill";
import {
  SettingsCard,
  SettingsInsetFieldRow,
  SettingsInsetRow,
  SettingsInsetRows,
  SettingsRowText,
  SettingsSectionLayout,
} from "@quieter/ui/settings-layout";
import { Surface } from "@quieter/ui/surface";
import { Switch, SwitchThumb } from "@quieter/ui/switch";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export const OperationsSettings = () => {
  const queryClient = useQueryClient();
  const settingsOptions = orpc.operations.settings.queryOptions({ gcTime: 0 });
  const settings = useQuery(settingsOptions);
  const setWaitlist = useMutation(
    orpc.operations.setWaitlistOpen.mutationOptions({
      onError: (error) => {
        toastError(error, { boundary: "operations-waitlist" });
      },
      onSuccess: async (data) => {
        await queryClient.cancelQueries({ queryKey: settingsOptions.queryKey });
        queryClient.setQueryData(settingsOptions.queryKey, data);
      },
    })
  );

  if (settings.isPending) {
    return (
      <Surface padding="none">
        <SettingsLoadingState
          className="min-h-48"
          label="Loading configuration"
        />
      </Surface>
    );
  }
  if (settings.isError) {
    return (
      <SettingsErrorState
        message="Couldn’t load configuration."
        onRetry={() => void settings.refetch()}
      />
    );
  }

  const { history, waitlistOpen } = settings.data;
  return (
    <div className="max-w-180 space-y-6">
      <SettingsSectionLayout title="Waitlist">
        <SettingsCard>
          <SettingsInsetFieldRow>
            <SettingsRowText title="Accept waitlist signups">
              Pausing intake stops new signups. Existing entries are kept.
            </SettingsRowText>
            <div className="flex items-center gap-3">
              <Pill size="xs" tone={waitlistOpen ? "success" : "neutral"}>
                {waitlistOpen ? "Open" : "Paused"}
              </Pill>
              <Switch
                aria-label="Accept waitlist signups"
                checked={waitlistOpen}
                onCheckedChange={(open) => {
                  setWaitlist.mutate({ waitlistOpen: open });
                }}
                pending={setWaitlist.isPending}
                size="sm"
              >
                <SwitchThumb />
              </Switch>
            </div>
          </SettingsInsetFieldRow>
        </SettingsCard>
      </SettingsSectionLayout>
      <SettingsSectionLayout
        description="Recent changes to operational settings."
        title="Change history"
      >
        <SettingsCard>
          {history.length === 0 ? (
            <SettingsInsetRow>
              <SettingsRowText title="No changes yet">
                The waitlist accepts signups by default.
              </SettingsRowText>
            </SettingsInsetRow>
          ) : (
            <SettingsInsetRows>
              {history.map((change) => (
                <SettingsInsetRow className="justify-between" key={change.id}>
                  <SettingsRowText
                    title={
                      change.waitlistOpen
                        ? "Waitlist set to open"
                        : "Waitlist set to paused"
                    }
                  >
                    {change.actorName ?? "Former administrator"}
                  </SettingsRowText>
                  <time
                    className="shrink-0 text-right text-caption text-muted-fg"
                    dateTime={new Date(change.changedAt).toISOString()}
                  >
                    {new Date(change.changedAt).toLocaleString(undefined, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </time>
                </SettingsInsetRow>
              ))}
            </SettingsInsetRows>
          )}
        </SettingsCard>
      </SettingsSectionLayout>
    </div>
  );
};

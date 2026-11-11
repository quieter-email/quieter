import { toastError } from "@quieter/app/lib/error-toast";
import { orpc } from "@quieter/app/lib/orpc";
import type { rpc } from "@quieter/app/lib/orpc";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import { Pill } from "@quieter/ui/pill";
import {
  SettingsCard,
  SettingsInsetFieldRow,
  SettingsInsetRow,
  SettingsInsetRows,
  SettingsRowText,
  SettingsSectionLayout,
} from "@quieter/ui/settings-layout";
import { Switch, SwitchThumb } from "@quieter/ui/switch";
import { Text } from "@quieter/ui/text";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

const pulseClass =
  "animate-pulse rounded-md bg-muted not-squircle motion-reduce:animate-none";

type SettingsSnapshot = Awaited<ReturnType<typeof rpc.operations.settings>>;

const SettingsRowSkeleton = ({ label }: { label: string }) => (
  <output aria-label={label} className="flex w-full items-center gap-4">
    <span className="sr-only">{label}</span>
    <span className="min-w-0 flex-1 space-y-2">
      <span
        aria-hidden
        className={cn(pulseClass, "block h-4 w-44 max-w-full")}
      />
      <span
        aria-hidden
        className={cn(pulseClass, "block h-3 w-64 max-w-full")}
      />
    </span>
    <span aria-hidden className={cn(pulseClass, "block h-5 w-14 shrink-0")} />
  </output>
);

const SettingsFailure = ({
  label,
  onRetry,
}: {
  label: string;
  onRetry: () => void;
}) => (
  <SettingsInsetRow className="justify-between">
    <Text role="alert" tone="destructive">
      {label}
    </Text>
    <Button onClick={onRetry} size="sm" type="button" variant="outline">
      Try again
    </Button>
  </SettingsInsetRow>
);

const WaitlistControl = ({
  changing,
  failed,
  onChange,
  onRetry,
  pending,
  waitlistOpen,
}: {
  changing: boolean;
  failed: boolean;
  onChange: (open: boolean) => void;
  onRetry: () => void;
  pending: boolean;
  waitlistOpen: boolean | undefined;
}) => {
  if (pending) {
    return (
      <SettingsInsetFieldRow>
        <SettingsRowSkeleton label="Loading waitlist" />
      </SettingsInsetFieldRow>
    );
  }
  if (failed || waitlistOpen === undefined) {
    return (
      <SettingsFailure
        label="Couldn’t load the waitlist control."
        onRetry={onRetry}
      />
    );
  }
  return (
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
          onCheckedChange={onChange}
          pending={changing}
          size="sm"
        >
          <SwitchThumb />
        </Switch>
      </div>
    </SettingsInsetFieldRow>
  );
};

const ChangeHistory = ({
  failed,
  history,
  onRetry,
  pending,
}: {
  failed: boolean;
  history: SettingsSnapshot["history"] | undefined;
  onRetry: () => void;
  pending: boolean;
}) => {
  if (pending) {
    return (
      <SettingsInsetRows>
        {["history-1", "history-2", "history-3"].map((key) => (
          <SettingsInsetRow key={key}>
            <SettingsRowSkeleton label="Loading change history" />
          </SettingsInsetRow>
        ))}
      </SettingsInsetRows>
    );
  }
  if (failed || history === undefined) {
    return (
      <SettingsFailure
        label="Couldn’t load change history."
        onRetry={onRetry}
      />
    );
  }
  if (history.length === 0) {
    return (
      <SettingsInsetRow>
        <SettingsRowText title="No changes yet">
          The waitlist accepts signups by default.
        </SettingsRowText>
      </SettingsInsetRow>
    );
  }
  return (
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
  );
};

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

  const pending = settings.isPending;
  const failed = settings.isError && settings.data === undefined;
  const history = settings.data?.history;
  const waitlistOpen = settings.data?.waitlistOpen;
  const retry = () => void settings.refetch();
  return (
    <div className="max-w-180 space-y-6">
      <SettingsSectionLayout title="Waitlist">
        <SettingsCard>
          <WaitlistControl
            changing={setWaitlist.isPending}
            failed={failed}
            onChange={(open) => {
              setWaitlist.mutate({ waitlistOpen: open });
            }}
            onRetry={retry}
            pending={pending}
            waitlistOpen={waitlistOpen}
          />
        </SettingsCard>
      </SettingsSectionLayout>
      <SettingsSectionLayout
        description="Recent changes to operational settings."
        title="Change history"
      >
        <SettingsCard>
          <ChangeHistory
            failed={failed}
            history={history}
            onRetry={retry}
            pending={pending}
          />
        </SettingsCard>
      </SettingsSectionLayout>
    </div>
  );
};

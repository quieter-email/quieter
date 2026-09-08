"use client";

import {
  Alert02Icon,
  CheckmarkCircle01Icon,
  Globe02Icon,
  Loading03Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { RouterOutputs } from "@quieter/orpc";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import { toast } from "@quieter/ui/toast";

import { SettingsCard, SettingsSection } from "../settings-layout";
import { RecordState } from "./domain-status";
import type {
  getDomainVerificationStatus,
  DomainStatusTone,
  DomainDetail,
  DomainDnsCheck,
} from "./domain-status";
import { MutedActionButton } from "./settings-row";

const dnsTableColumns =
  "grid grid-cols-[3.25rem_minmax(7rem,0.85fr)_minmax(10rem,1.6fr)_4rem_3.25rem_5.25rem] items-center gap-3";

const copyDnsValue = async (value: string) => {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(
      <>
        Copied{" "}
        <code className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-caption font-normal break-all">
          {value}
        </code>
      </>,
      { id: `dns-copy:${value}` }
    );
  } catch {
    toast.error("Could not copy to clipboard.");
  }
};

const DnsCopyCell = ({ value }: { value: string }) => (
  <button
    aria-label={`Copy ${value}`}
    className={cn(
      "squircle max-w-full min-w-0 rounded-md px-1.5 py-0.5 text-left font-mono text-caption text-fg",
      "transition-[transform,background-color] duration-100 ease-out",
      "hover:bg-muted/70",
      "active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100"
    )}
    onClick={() => {
      void (async () => {
        try {
          await copyDnsValue(value);
        } catch {
          /* clipboard errors are surfaced in copyDnsValue */
        }
      })();
    }}
    title={`Copy ${value}`}
    type="button"
  >
    <span className="block truncate">{value}</span>
  </button>
);

const getStatusSectionClass = (tone: DomainStatusTone) => {
  if (tone === "success") {
    return "border-success/30 bg-success/8";
  }
  if (tone === "error") {
    return "border-destructive/25 bg-destructive/6";
  }
  return "border-border bg-bg-raised/58";
};

const getStatusIconClass = (tone: DomainStatusTone) => {
  if (tone === "success") {
    return "text-success";
  }
  if (tone === "error") {
    return "text-destructive";
  }
  return "text-muted-fg";
};

const getDnsRecordStatusMessage = (
  check: { ok: boolean } | undefined,
  required: boolean
) => {
  if (check?.ok === true) {
    return "Verified";
  }
  if (required) {
    return check === undefined ? "Pending" : "Fix";
  }
  return "Recommended";
};

const getDnsRecordStatusOk = (
  check: { ok: boolean } | undefined,
  required: boolean
): boolean | null => {
  if (check?.ok === true) {
    return true;
  }
  if (required) {
    return check?.ok ?? null;
  }
  return null;
};

const getStatusIcon = (tone: DomainStatusTone) => {
  if (tone === "success") {
    return CheckmarkCircle01Icon;
  }
  if (tone === "error") {
    return Alert02Icon;
  }
  return Globe02Icon;
};

type DomainDnsRecord = DomainDetail["requiredDnsRecords"][number];

type DomainConnectAvailability =
  RouterOutputs["mailDomains"]["getDomainConnectAvailability"];

export const DomainStatusSummary = ({
  domain,
  passingRecords,
  sendingReady,
  status,
  totalRecords,
}: {
  domain: DomainDetail;
  passingRecords: number;
  sendingReady: boolean;
  status: ReturnType<typeof getDomainVerificationStatus>;
  totalRecords: number;
}) => (
  <section
    className={cn(
      "squircle relative overflow-hidden rounded-xl border p-5",
      getStatusSectionClass(status.tone)
    )}
  >
    <div className="@container relative grid gap-6 @lg:grid-cols-[minmax(0,1.3fr)_repeat(3,minmax(7rem,0.7fr))] @lg:items-center">
      <div>
        <div className="flex items-center gap-2">
          <HugeiconsIcon
            aria-hidden
            className={cn("size-5", getStatusIconClass(status.tone))}
            icon={getStatusIcon(status.tone)}
          />
          <h2 className="text-body-lg font-medium text-fg">{status.label}</h2>
        </div>
        <p className="mt-2 max-w-lg text-body/6 text-muted-fg">
          {status.description}
        </p>
      </div>
      {[
        ["DNS records", `${passingRecords}/${totalRecords}`],
        ["Sending", sendingReady ? "Ready" : "Checking"],
        ["Incoming mail", domain.mode === "send_only" ? "Off" : "Enabled"],
      ].map(([label, value]) => (
        <div className="border-l border-border pl-4" key={label}>
          <p className="text-caption text-muted-fg">{label}</p>
          <p className="mt-1 text-body font-medium text-fg">{value}</p>
        </div>
      ))}
    </div>
  </section>
);

const DomainConnectCard = ({
  availability,
  isPending,
  manageReason,
  onStart,
  startPending,
}: {
  availability: DomainConnectAvailability | undefined;
  isPending: boolean;
  manageReason: string | null;
  onStart: () => void;
  startPending: boolean;
}) => {
  if (availability?.available !== true && !isPending) {
    return null;
  }

  return (
    <SettingsCard className="@container p-3.5 @md:px-4">
      <div className="flex flex-col gap-3 @md:flex-row @md:items-center @md:justify-between">
        <div className="min-w-0">
          <p className="text-body font-medium text-fg">
            {availability?.available === true
              ? `Connect with ${availability.provider.displayName}`
              : "Checking your DNS provider…"}
          </p>
          {availability?.available === true ? (
            <p className="mt-0.5 text-caption text-muted-fg">
              Authorize the exact records, then Quieter verifies DNS when you
              return.
            </p>
          ) : null}
        </div>
        {availability?.available === true &&
          (manageReason === null ? (
            <Button disabled={startPending} onClick={onStart} size="sm">
              <HugeiconsIcon
                aria-hidden
                className={cn("size-4", { "animate-spin": startPending })}
                icon={startPending ? Loading03Icon : Globe02Icon}
              />
              Connect DNS
            </Button>
          ) : (
            <MutedActionButton
              icon={
                <HugeiconsIcon
                  aria-hidden
                  className="size-4"
                  icon={Globe02Icon}
                />
              }
              label="Connect DNS"
              reason={manageReason}
            />
          ))}
      </div>
    </SettingsCard>
  );
};

const DomainDnsRecordsTable = ({
  dnsChecks,
  records,
}: {
  dnsChecks: DomainDnsCheck[];
  records: DomainDnsRecord[];
}) => (
  <div className="squircle overflow-x-auto rounded-lg border border-border bg-bg-raised/58">
    <table
      aria-label="DNS records"
      className="w-full min-w-160 border-collapse p-2"
    >
      <thead>
        <tr
          className={cn(
            dnsTableColumns,
            "rounded-md bg-muted/35 px-3 py-1.5 text-caption font-medium text-muted-fg"
          )}
        >
          <th scope="col">Type</th>
          <th scope="col">Host</th>
          <th scope="col">Value</th>
          <th scope="col">Priority</th>
          <th scope="col">TTL</th>
          <th scope="col">Status</th>
        </tr>
      </thead>
      <tbody>
        {records.map((record) => {
          const check = dnsChecks.find(
            (candidate) =>
              candidate.recordName === record.name &&
              candidate.purpose === record.purpose
          );
          const priority =
            record.priority === null || record.priority === undefined
              ? null
              : String(record.priority);
          return (
            <tr
              className={cn(
                dnsTableColumns,
                "border-b border-border px-3 py-1.5 last:border-b-0"
              )}
              key={`${record.type}:${record.name}:${record.value}`}
            >
              <td className="min-w-0">
                <DnsCopyCell value={record.type} />
              </td>
              <td className="min-w-0">
                <DnsCopyCell value={record.name} />
              </td>
              <td className="min-w-0">
                <DnsCopyCell value={record.value} />
              </td>
              <td className="min-w-0">
                {priority === null ? (
                  <span className="px-1.5 font-mono text-caption text-muted-fg">
                    -
                  </span>
                ) : (
                  <DnsCopyCell value={priority} />
                )}
              </td>
              <td className="min-w-0 px-1.5 text-caption text-fg">Auto</td>
              <td>
                <RecordState
                  message={getDnsRecordStatusMessage(check, record.required)}
                  ok={getDnsRecordStatusOk(check, record.required)}
                />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  </div>
);

export const DomainDnsSetupSection = ({
  availability,
  dnsChecks,
  isDomainConnectPending,
  manageReason,
  onStartDomainConnect,
  startDomainConnectPending,
  domain,
}: {
  availability: DomainConnectAvailability | undefined;
  dnsChecks: DomainDnsCheck[];
  domain: DomainDetail;
  isDomainConnectPending: boolean;
  manageReason: string | null;
  onStartDomainConnect: () => void;
  startDomainConnectPending: boolean;
}) => (
  <SettingsSection
    description="Use one-click setup when your provider confirms support, or add every record manually."
    title="DNS setup"
  >
    <DomainConnectCard
      availability={availability}
      isPending={isDomainConnectPending}
      manageReason={manageReason}
      onStart={onStartDomainConnect}
      startPending={startDomainConnectPending}
    />
    <DomainDnsRecordsTable
      dnsChecks={dnsChecks}
      records={domain.requiredDnsRecords}
    />
  </SettingsSection>
);

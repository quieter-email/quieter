"use client";

import type { RouterOutputs } from "@quietr/orpc";
import { Button, Input, cn, toast } from "@quietr/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { authClient } from "~/lib/auth";
import { getErrorMessage } from "~/lib/errors";
import { orpc } from "~/lib/orpc";

type MailDomainSetup = RouterOutputs["mail"]["listDomains"][number];

const formatDateTime = (value: Date | string) => {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
};

const StatusPill = ({ label, ready }: { label: string; ready: boolean }) => (
  <span
    className={cn(
      "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium",
      {
        "border-border bg-muted text-muted-foreground": !ready,
        "border-emerald-500/30 bg-emerald-500/10 text-emerald-700": ready,
      },
    )}
  >
    {label}
  </span>
);

const DomainCard = ({
  domain,
  onRefresh,
  refreshPending,
}: {
  domain: MailDomainSetup;
  onRefresh: (domainId: string) => Promise<void>;
  refreshPending: boolean;
}) => (
  <div className="rounded-xl border border-border/70 bg-card p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-foreground">{domain.domain}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <StatusPill
            label={`Sending ${domain.outboundReady ? "ready" : "pending"}`}
            ready={domain.outboundReady}
          />
          <StatusPill
            label={`Inbound ${domain.inboundReady ? "ready" : "pending"}`}
            ready={domain.inboundReady}
          />
          <StatusPill
            label={`DKIM ${domain.dkimStatus?.toLowerCase() || "pending"}`}
            ready={domain.dkimStatus === "SUCCESS"}
          />
        </div>
      </div>

      <Button
        disabled={refreshPending}
        onClick={() => {
          void onRefresh(domain.domainId);
        }}
        size="sm"
        variant="outline"
      >
        Refresh
      </Button>
    </div>

    <div className="mt-4 grid gap-3 text-sm text-muted-foreground md:grid-cols-2">
      <div>
        <p className="text-xs font-medium tracking-wide text-foreground uppercase">SES</p>
        <p className="mt-1">Verification: {domain.verificationStatus || "pending"}</p>
        <p>MAIL FROM: {domain.mailFromDomain}</p>
        <p>MAIL FROM status: {domain.mailFromStatus || "pending"}</p>
        <p>Receipt rule: {domain.receiptRuleName}</p>
      </div>

      <div>
        <p className="text-xs font-medium tracking-wide text-foreground uppercase">Runtime</p>
        <p className="mt-1">Region: {domain.awsRegion}</p>
        <p>Bucket: {domain.s3Bucket}</p>
        <p>Inbound API: {domain.ingressUrl || "Unavailable"}</p>
        <p>Outbound API: {domain.outboundUrl || "Unavailable"}</p>
      </div>
    </div>

    <div className="mt-4">
      <p className="text-xs font-medium tracking-wide text-foreground uppercase">DNS records</p>
      <div className="mt-2 space-y-2">
        {domain.dnsRecords.map((record) => (
          <div
            className="rounded-lg border border-border/70 bg-muted/30 p-3 text-xs text-foreground"
            key={`${record.type}:${record.name}:${record.value}`}
          >
            <p className="font-medium">
              {record.type} {record.name}
              {record.priority ? ` (${record.priority})` : ""}
            </p>
            <p className="mt-1 break-all text-muted-foreground">{record.value}</p>
            <p className="mt-1 text-muted-foreground">{record.purpose}</p>
          </div>
        ))}
      </div>
    </div>
  </div>
);

export const MailSettingsPanel = () => {
  const queryClient = useQueryClient();
  const activeOrganization = authClient.useActiveOrganization().data ?? null;
  const [domainInput, setDomainInput] = useState("");
  const [selectedDomainId, setSelectedDomainId] = useState("");
  const [fromLocalPart, setFromLocalPart] = useState("test");
  const [toAddress, setToAddress] = useState("success@simulator.amazonses.com");
  const [subject, setSubject] = useState("Mail outbound test");
  const [body, setBody] = useState("hello from quietr mail");

  const domainsQueryOptions = orpc.mail.listDomains.queryOptions();
  const storedMessagesQueryOptions = orpc.mail.listStoredMessages.queryOptions({
    limit: 10,
  });
  const domainsQuery = useQuery({
    ...domainsQueryOptions,
    enabled: Boolean(activeOrganization),
  });
  const storedMessagesQuery = useQuery({
    ...storedMessagesQueryOptions,
    enabled: Boolean(activeOrganization),
  });

  const registerDomainMutation = useMutation({
    ...orpc.mail.registerDomain.mutationOptions(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: domainsQueryOptions.queryKey });
      toast.success("Mail domain registered.");
      setDomainInput("");
    },
  });
  const refreshDomainMutation = useMutation({
    ...orpc.mail.refreshDomain.mutationOptions(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: domainsQueryOptions.queryKey });
      toast.success("Mail domain refreshed.");
    },
  });
  const sendManagedMutation = useMutation({
    ...orpc.mail.sendManaged.mutationOptions(),
    onSuccess: () => {
      toast.success("Mail sent.");
    },
  });

  const domains = domainsQuery.data ?? [];
  const selectedDomain =
    domains.find((domain) => domain.domainId === selectedDomainId) ?? domains[0] ?? null;
  const selectedDomainName = selectedDomain?.domain ?? "";

  const handleRegisterDomain = async () => {
    if (!domainInput.trim()) {
      toast.error("Enter a domain first.");
      return;
    }

    try {
      const registered = await registerDomainMutation.mutateAsync({
        domain: domainInput.trim(),
      });
      setSelectedDomainId(registered.domainId);
    } catch (error) {
      toast.error(getErrorMessage(error, "Could not register that domain."));
    }
  };

  const handleRefreshDomain = async (domainId: string) => {
    try {
      await refreshDomainMutation.mutateAsync({ domainId });
    } catch (error) {
      toast.error(getErrorMessage(error, "Could not refresh that domain."));
    }
  };

  const handleSendManagedMail = async () => {
    if (!selectedDomainName) {
      toast.error("Register a domain first.");
      return;
    }

    try {
      await sendManagedMutation.mutateAsync({
        from: `${fromLocalPart.trim() || "test"}@${selectedDomainName}`,
        subject: subject.trim(),
        text: body,
        to: [toAddress.trim()],
      });
    } catch (error) {
      toast.error(getErrorMessage(error, "Could not send mail."));
    }
  };

  return (
    <div className="mt-8 space-y-6 border-t border-border/70 pt-8">
      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">Mail</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Register a domain, copy the DNS records, refresh status, and send a test message.
          </p>
        </div>

        <div className="flex flex-col gap-3 md:flex-row">
          <Input
            onChange={(event) => {
              setDomainInput(event.target.value);
            }}
            placeholder="leanderriefel.com"
            value={domainInput}
          />
          <Button
            disabled={registerDomainMutation.isPending}
            onClick={() => {
              void handleRegisterDomain();
            }}
            size="sm"
            type="button"
          >
            Register domain
          </Button>
        </div>

        {domainsQuery.isError ? (
          <p className="text-sm text-destructive">
            {getErrorMessage(domainsQuery.error, "Could not load mail domains.")}
          </p>
        ) : null}

        {domains.length === 0 && !domainsQuery.isPending ? (
          <p className="text-sm text-muted-foreground">No registered mail domains yet.</p>
        ) : null}

        <div className="space-y-3">
          {domains.map((domain) => (
            <DomainCard
              domain={domain}
              key={domain.domainId}
              onRefresh={handleRefreshDomain}
              refreshPending={
                refreshDomainMutation.isPending &&
                refreshDomainMutation.variables?.domainId === domain.domainId
              }
            />
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h3 className="text-sm font-medium text-foreground">Send test mail</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            While SES stays in sandbox, send to the mailbox simulator or a verified recipient.
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <select
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm text-foreground"
            onChange={(event) => {
              setSelectedDomainId(event.target.value);
            }}
            value={selectedDomain?.domainId ?? ""}
          >
            {domains.length === 0 ? <option value="">No domains</option> : null}
            {domains.map((domain) => (
              <option key={domain.domainId} value={domain.domainId}>
                {domain.domain}
              </option>
            ))}
          </select>

          <Input
            onChange={(event) => {
              setFromLocalPart(event.target.value);
            }}
            placeholder="test"
            value={fromLocalPart}
          />

          <Input
            onChange={(event) => {
              setToAddress(event.target.value);
            }}
            placeholder="success@simulator.amazonses.com"
            value={toAddress}
          />

          <Input
            onChange={(event) => {
              setSubject(event.target.value);
            }}
            placeholder="Subject"
            value={subject}
          />
        </div>

        <textarea
          className="min-h-28 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm text-foreground ring-offset-background outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
          onChange={(event) => {
            setBody(event.target.value);
          }}
          placeholder="Message body"
          value={body}
        />

        <Button
          disabled={sendManagedMutation.isPending || !selectedDomainName}
          onClick={() => {
            void handleSendManagedMail();
          }}
          size="sm"
          type="button"
        >
          Send test
        </Button>
      </section>

      <section className="space-y-4">
        <div>
          <h3 className="text-sm font-medium text-foreground">Recent inbound mail</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            These are the raw messages captured into S3 and indexed into Postgres.
          </p>
        </div>

        {storedMessagesQuery.isError ? (
          <p className="text-sm text-destructive">
            {getErrorMessage(storedMessagesQuery.error, "Could not load captured mail.")}
          </p>
        ) : null}

        {storedMessagesQuery.data?.length ? (
          <div className="space-y-2">
            {storedMessagesQuery.data.map((message) => (
              <div
                className="rounded-lg border border-border/70 bg-card p-3 text-sm"
                key={message.id}
              >
                <p className="font-medium text-foreground">{message.subject || "(no subject)"}</p>
                <p className="mt-1 text-muted-foreground">
                  {message.mailFrom || "Unknown sender"} to {message.recipients.join(", ")}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatDateTime(message.receivedAt)} / {message.domain}
                </p>
              </div>
            ))}
          </div>
        ) : storedMessagesQuery.isPending ? (
          <p className="text-sm text-muted-foreground">Loading captured mail...</p>
        ) : (
          <p className="text-sm text-muted-foreground">No captured inbound mail yet.</p>
        )}
      </section>
    </div>
  );
};

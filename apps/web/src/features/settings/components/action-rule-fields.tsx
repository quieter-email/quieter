"use client";

import { Loading03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import { Input } from "@quieter/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@quieter/ui/select";
import { TokenField } from "@quieter/ui/token-field";
import type { TokenFieldToken } from "@quieter/ui/token-field";
import type { ReactNode } from "react";

import type { ConnectorsData, ConnectorProvider } from "./action-editor-types";
import { settingsSurfaceVariants } from "./settings-layout";

const DEFAULT_ACTION_INSTRUCTIONS =
  "When it's a bug or feature request, mention the app that should handle it, search there for anything matching, and otherwise create a clear new entry with a title, description, and useful context from the email.";

const TRIGGER_OPTIONS = [
  { label: "On Email Received", value: "email_received" },
] as const;

const TRIGGER_VALUE = TRIGGER_OPTIONS[0].value;

const getConnectorAccountLabel = (
  account: NonNullable<ConnectorsData>["connectors"][number]["accounts"][number],
  fallback: string
) =>
  account.providerWorkspaceName ??
  account.accountEmail ??
  account.displayName ??
  fallback;

const SimpleField = ({
  children,
  description,
  label,
}: {
  children: ReactNode;
  description?: string;
  label: string;
}) => (
  <div className="grid gap-3 p-4 md:grid-cols-[12rem_minmax(0,1fr)] md:px-6">
    <div>
      <p className={settingsSurfaceVariants({ variant: "title" })}>{label}</p>
      {description === undefined || description === "" ? null : (
        <p
          className={cn("mt-1", settingsSurfaceVariants({ variant: "value" }))}
        >
          {description}
        </p>
      )}
    </div>
    <div className="min-w-0">{children}</div>
  </div>
);

type ConnectorAccount =
  NonNullable<ConnectorsData>["connectors"][number]["accounts"][number];

type ConnectorSummary = NonNullable<ConnectorsData>["connectors"][number];

const ConnectorAccountField = ({
  accounts,
  connector,
  credentialId,
  onConnect,
  setCredentialId,
  startingConnection,
}: {
  accounts: ConnectorAccount[];
  connector: ConnectorSummary;
  credentialId: string;
  onConnect: (provider: ConnectorProvider) => void;
  setCredentialId: (value: string) => void;
  startingConnection: boolean;
}) => {
  if (accounts.length === 0) {
    return (
      <Button
        disabled={startingConnection || !connector.isConfigured}
        onClick={() => {
          onConnect(connector.provider);
        }}
        size="sm"
        type="button"
        variant="outline"
      >
        {startingConnection ? (
          <HugeiconsIcon
            aria-hidden
            className="size-4 animate-spin"
            icon={Loading03Icon}
          />
        ) : null}
        Connect {connector.displayName}
      </Button>
    );
  }

  return (
    <Select
      items={accounts.map((account) => ({
        label: getConnectorAccountLabel(account, connector.displayName),
        value: account.id,
      }))}
      onValueChange={(value) => {
        if (value === null || value === undefined || value === "") {
          return;
        }
        setCredentialId(value);
      }}
      value={credentialId}
    >
      <SelectTrigger aria-label={`${connector.displayName} account`}>
        <SelectValue placeholder={`Select ${connector.displayName} account`} />
      </SelectTrigger>
      <SelectContent>
        {accounts.map((account) => (
          <SelectItem key={account.id} value={account.id}>
            {getConnectorAccountLabel(account, connector.displayName)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};

export const ActionRuleFields = ({
  connectorTokens,
  connectors,
  credentialId,
  instructions,
  name,
  onConnect,
  provider,
  setCredentialId,
  setInstructions,
  setName,
  setProvider,
  startingConnection,
}: {
  connectorTokens: TokenFieldToken[];
  connectors: ConnectorSummary[];
  credentialId: string;
  instructions: string;
  name: string;
  onConnect: (provider: ConnectorProvider) => void;
  provider: string;
  setCredentialId: (value: string) => void;
  setInstructions: (value: string) => void;
  setName: (value: string) => void;
  setProvider: (value: string) => void;
  startingConnection: boolean;
}) => {
  const selected = connectors.find((item) => item.provider === provider);
  const accounts: ConnectorAccount[] =
    selected?.accounts.filter((account) => account.status === "connected") ??
    [];

  return (
    <div className="divide-y divide-border/70">
      <SimpleField label="Name">
        <Input
          onChange={(event) => {
            setName(event.target.value);
          }}
          placeholder="Action name"
          value={name}
        />
      </SimpleField>

      <SimpleField
        description="The first event that starts this action."
        label="Trigger"
      >
        <Select
          items={TRIGGER_OPTIONS.map((option) => ({
            label: option.label,
            value: option.value,
          }))}
          value={TRIGGER_VALUE}
        >
          <SelectTrigger aria-label="Trigger">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="email_received">On Email Received</SelectItem>
          </SelectContent>
        </Select>
      </SimpleField>

      <SimpleField
        description="The app this action works in. It figures out where to put things from your instruction and what the connection can reach."
        label="App"
      >
        <div className="space-y-3">
          <Select
            items={connectors.map((connector) => ({
              label: connector.displayName,
              value: connector.provider,
            }))}
            onValueChange={(value) => {
              if (value === null || value === undefined || value === "") {
                return;
              }
              setProvider(value);
              setCredentialId("");
            }}
            value={provider}
          >
            <SelectTrigger aria-label="App">
              <SelectValue placeholder="Select an app" />
            </SelectTrigger>
            <SelectContent>
              {connectors.map((connector) => (
                <SelectItem key={connector.provider} value={connector.provider}>
                  {connector.displayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {selected === undefined ? null : (
            <ConnectorAccountField
              accounts={accounts}
              connector={selected}
              credentialId={credentialId}
              onConnect={onConnect}
              setCredentialId={setCredentialId}
              startingConnection={startingConnection}
            />
          )}
        </div>
      </SimpleField>

      <SimpleField
        description="Write the whole behavior in one prompt. The email content is provided automatically when the action runs."
        label="Instruction"
      >
        <div className="space-y-2">
          <div className="squircle rounded-md border border-border bg-input px-3 py-2 shadow-sm transition-colors duration-150 ease-out focus-within:border-ring focus-within:ring-1 focus-within:ring-ring/45">
            <TokenField
              aria-label="Action instruction"
              className="max-h-72 min-h-32 overflow-y-auto text-body"
              onChange={setInstructions}
              placeholder={DEFAULT_ACTION_INSTRUCTIONS}
              suggestionsLabel="Connectors"
              tokens={connectorTokens}
              value={instructions}
            />
          </div>
          <p className={settingsSurfaceVariants({ variant: "value" })}>
            Type @ to mention a connected app, and the agent uses it for that
            step.
          </p>
        </div>
      </SimpleField>
    </div>
  );
};

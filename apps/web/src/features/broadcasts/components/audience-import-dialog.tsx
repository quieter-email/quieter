import { audienceContactRowSchema } from "@quieter/mail/audiences";
import type { AudienceImportResult } from "@quieter/mail/audiences";
import { Button } from "@quieter/ui/button";
import { Checkbox, CheckboxIndicator } from "@quieter/ui/checkbox";
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@quieter/ui/dialog";
import { Field, FieldLabel } from "@quieter/ui/field";
import { Input } from "@quieter/ui/input";
import type { PillTone } from "@quieter/ui/pill";
import { Pill } from "@quieter/ui/pill";
import { Textarea } from "@quieter/ui/textarea";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { toastError } from "#/lib/error-toast";
import { rpc } from "#/lib/orpc";

import { useBroadcastWorkspace } from "./broadcast-workspace";

const rowTones: Record<string, PillTone> = {
  created: "green",
  duplicate: "orange",
  inactive: "orange",
  invalid: "red",
  ready: "gray",
  unchanged: "gray",
  updated: "green",
};

const parseImport = (input: string) => {
  if (input.length > 500_000) {
    return { error: "Paste up to 500 KB at a time.", preview: [], rows: [] };
  }
  const records: string[][] = [];
  let record: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (character === '"') {
      if (quoted && input[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (!quoted && (character === "," || character === "\t")) {
      record.push(cell.trim());
      cell = "";
    } else if (!quoted && (character === "\n" || character === "\r")) {
      if (character === "\r" && input[index + 1] === "\n") {
        index += 1;
      }
      record.push(cell.trim());
      if (record.some(Boolean)) {
        records.push(record);
      }
      record = [];
      cell = "";
      if (records.length > 501) {
        return {
          error: "Import up to 500 contacts at a time.",
          preview: [],
          rows: [],
        };
      }
    } else {
      cell += character;
    }
  }
  if (quoted) {
    return {
      error: "A quoted field is missing its closing quote.",
      preview: [],
      rows: [],
    };
  }
  record.push(cell.trim());
  if (record.some(Boolean)) {
    records.push(record);
  }
  const header = records[0]?.map((value) => value.toLowerCase());
  const hasHeader = header?.includes("email") ?? false;
  const values = hasHeader ? records.slice(1) : records;
  if (values.length > 500) {
    return {
      error: "Import up to 500 contacts at a time.",
      preview: [],
      rows: [],
    };
  }
  const seen = new Set<string>();
  const rows = values.map((value) => ({
    email: value[hasHeader ? (header?.indexOf("email") ?? 0) : 0] ?? "",
    name: value[hasHeader ? (header?.indexOf("name") ?? -1) : 1] || undefined,
    tags: (value[hasHeader ? (header?.indexOf("tags") ?? -1) : 2] ?? "")
      .split(";")
      .map((tag) => tag.trim())
      .filter(Boolean),
  }));
  const preview = rows.map((row, index) => {
    const parsed = audienceContactRowSchema.safeParse(row);
    const email = row.email.trim().toLowerCase();
    const duplicate = seen.has(email);
    seen.add(email);
    let status = "ready";
    let message = "Ready to import";
    if (!parsed.success) {
      status = "invalid";
      message = parsed.error.issues.map((issue) => issue.message).join(", ");
    } else if (duplicate) {
      status = "duplicate";
      message = "Repeated in this import";
    }
    return {
      email,
      message,
      row: index + 1,
      status,
    };
  });
  return { error: null, preview, rows };
};

export const AudienceImportDialog = ({
  audienceId,
  open,
  onOpenChange,
}: {
  audienceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const { organizationId } = useBroadcastWorkspace();
  const queryClient = useQueryClient();
  const [input, setInput] = useState("");
  const [source, setSource] = useState("");
  const [consent, setConsent] = useState(false);
  const [result, setResult] = useState<AudienceImportResult>();
  const [idempotencyKey, setIdempotencyKey] = useState(() =>
    crypto.randomUUID()
  );
  const parsed = useMemo(() => parseImport(input), [input]);
  const mutation = useMutation({
    mutationFn: async () =>
      await rpc.audiences.importContacts({
        audienceId,
        consentSource: source,
        idempotencyKey,
        organizationId,
        rows: parsed.rows,
      }),
    onError: (error) => {
      toastError(error, {
        boundary: "audience-import",
        fallback: "Could not import contacts. Please try again.",
      });
    },
    onSuccess: async (data) => {
      setResult(data);
      await queryClient.invalidateQueries({
        queryKey: ["audiences", organizationId],
      });
    },
  });
  const rows = result?.rows ?? parsed.preview;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(94vw,44rem)]">
        <DialogHeader>
          <DialogTitle>
            {result ? "Import results" : "Import contacts"}
          </DialogTitle>
          <DialogDescription>
            Paste up to 500 CSV or tab-separated rows. Columns are email, name,
            tags. Separate tags with a semicolon. A header row is optional.
          </DialogDescription>
        </DialogHeader>
        <DialogBody spacing="4">
          {result ? (
            <p className="text-body text-muted-fg">
              {result.created} added, {result.updated} updated,{" "}
              {result.unchanged} unchanged, {result.inactive} inactive,{" "}
              {result.invalid} invalid, {result.duplicate} duplicates.
            </p>
          ) : (
            <>
              <Field>
                <FieldLabel>Contacts</FieldLabel>
                <Textarea
                  aria-describedby="import-policy"
                  // oxlint-disable-next-line shadcn/no-restyle -- CSV entry uses compact monospace text.
                  className="min-h-36 font-mono text-caption"
                  maxLength={500_001}
                  onChange={(event) => {
                    setInput(event.target.value);
                    setIdempotencyKey(crypto.randomUUID());
                  }}
                  placeholder={
                    "email,name,tags\nalex@example.com,Alex,newsletter;customer"
                  }
                  value={input}
                />
              </Field>
              <Field>
                <FieldLabel>Consent source</FieldLabel>
                <Input
                  maxLength={500}
                  onChange={(event) => {
                    setSource(event.target.value);
                    setIdempotencyKey(crypto.randomUUID());
                  }}
                  placeholder="Signup form, event registration, or other source"
                  value={source}
                />
              </Field>
              <label
                className="flex items-start gap-2 text-body text-fg"
                htmlFor="audience-import-consent"
              >
                <Checkbox
                  checked={consent}
                  id="audience-import-consent"
                  onCheckedChange={setConsent}
                >
                  <CheckboxIndicator />
                </Checkbox>
                I confirm these contacts agreed to receive email from this team.
              </label>
              <p id="import-policy" className="text-caption/5 text-muted-fg">
                Existing unsubscribed or removed contacts stay inactive.
                Importing never clears a safety block.
              </p>
            </>
          )}
          {parsed.error && !result ? (
            <p className="text-body text-destructive" role="alert">
              {parsed.error}
            </p>
          ) : null}
          {rows.length ? (
            <div className="max-h-64 overflow-y-auto rounded-lg border border-border">
              <ol className="divide-y divide-border">
                {rows.map((row) => (
                  <li
                    className="flex flex-wrap items-center gap-2 px-3 py-2 text-caption"
                    key={row.row}
                  >
                    <span className="w-6 text-muted-fg">{row.row}</span>
                    <span className="min-w-0 flex-1 break-all">
                      {row.email || "Missing email"}
                    </span>
                    <Pill size="xs" tone={rowTones[row.status]}>
                      {row.status}
                    </Pill>
                    <p className="w-full pl-8 text-muted-fg">{row.message}</p>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <DialogCloseButton disabled={mutation.isPending}>
            {result ? "Done" : "Cancel"}
          </DialogCloseButton>
          {result ? null : (
            <Button
              disabled={
                mutation.isPending ||
                !consent ||
                !source.trim() ||
                !!parsed.error ||
                !parsed.preview.some((row) => row.status === "ready")
              }
              onClick={() => {
                mutation.mutate();
              }}
              size="sm"
            >
              {mutation.isPending
                ? "Importing…"
                : `Import ${parsed.rows.length} rows`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

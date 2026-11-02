import { z } from "zod";

import { appendEmailUnsubscribe } from "./email-design";

export const UNSUBSCRIBE_TOKEN_PLACEHOLDER = "{{unsubscribe_token}}";

export const customUnsubscribeUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .refine((value) => {
    if (
      value.split(UNSUBSCRIBE_TOKEN_PLACEHOLDER).length !== 2 ||
      /[\p{Cc}\s\\<>"'{}]/u.test(
        value.replace(UNSUBSCRIBE_TOKEN_PLACEHOLDER, "")
      )
    ) {
      return false;
    }
    try {
      const decoded = decodeURIComponent(value);
      let sentinel = "__quieter_unsubscribe_token__";
      while (decoded.includes(sentinel)) {
        sentinel += "_";
      }
      const url = new URL(
        value.replace(UNSUBSCRIBE_TOKEN_PLACEHOLDER, sentinel)
      );
      return (
        url.protocol === "https:" &&
        url.hostname !== "" &&
        url.username === "" &&
        url.password === "" &&
        url.hash === "" &&
        url.href.replace(sentinel, "x".repeat(43)).length <= 2048 &&
        (url.pathname.split("/").includes(sentinel) ||
          [...url.searchParams.values()].includes(sentinel))
      );
    } catch {
      return false;
    }
  }, "Use an HTTPS URL with {{unsubscribe_token}} as a full path segment or query value, without login details or a fragment.");

export const unsubscribePolicySchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("managed") }),
  z.strictObject({
    kind: z.literal("custom"),
    urlTemplate: customUnsubscribeUrlSchema,
  }),
]);

const managedOriginSchema = z
  .url({ protocol: /^https$/u })
  .refine((value) => {
    const url = new URL(value);
    return (
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === "/"
    );
  }, "Use a public HTTPS origin for campaign unsubscribe links.")
  .transform((value) => new URL(value).origin);

export const unsubscribeSnapshotSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("managed"),
    origin: managedOriginSchema,
    version: z.literal(1),
  }),
  z.strictObject({
    kind: z.literal("custom"),
    urlTemplate: customUnsubscribeUrlSchema,
    version: z.literal(1),
  }),
]);

export type UnsubscribePolicy = z.infer<typeof unsubscribePolicySchema>;
export type UnsubscribeSnapshot = z.infer<typeof unsubscribeSnapshotSchema>;

export const freezeCampaignUnsubscribe = ({
  audiencePolicy,
  campaignOverride,
  managedOrigin,
}: {
  audiencePolicy: UnsubscribePolicy;
  campaignOverride: UnsubscribePolicy | null;
  managedOrigin: string | undefined;
}): UnsubscribeSnapshot => {
  const policy = campaignOverride ?? audiencePolicy;
  if (policy.kind === "custom") {
    return unsubscribeSnapshotSchema.parse({ ...policy, version: 1 });
  }
  return unsubscribeSnapshotSchema.parse({
    kind: "managed",
    origin: managedOrigin,
    version: 1,
  });
};

export const renderCampaignEmail = ({
  html,
  text,
  token,
  unsubscribe,
}: {
  html: string | null;
  text: string;
  token: string;
  unsubscribe:
    | UnsubscribeSnapshot
    | { kind: "managed"; origin: string; version: 0 };
}): {
  headers: Record<"List-Unsubscribe" | "List-Unsubscribe-Post", string>;
  html: string | undefined;
  text: string;
} => {
  const url =
    unsubscribe.kind === "custom"
      ? new URL(
          unsubscribe.urlTemplate.replace(UNSUBSCRIBE_TOKEN_PLACEHOLDER, token)
        ).toString()
      : new URL(`/unsubscribe/${token}`, unsubscribe.origin).toString();
  const oneClickUrl =
    unsubscribe.version === 0
      ? new URL(`/api/unsubscribe/${token}`, unsubscribe.origin).toString()
      : url;
  return {
    headers: {
      "List-Unsubscribe": `<${oneClickUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
    html: html === null ? undefined : appendEmailUnsubscribe(html, url),
    text: `${text}\n\nUnsubscribe from this audience: ${url}`,
  };
};

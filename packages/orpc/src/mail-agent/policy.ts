import { ORPCError } from "@orpc/server";
import type { ActionSpecification } from "@quieter/ai/action-specification";
import { z } from "zod";

import type { AgentCatalogTool } from "./catalog";

type PolicyMessage = {
  from?: string | null;
  subject?: string | null;
  bodyText?: string | null;
};

export const matchesAgentEligibility = (
  eligibility: NonNullable<ActionSpecification["eligibility"]>,
  message?: PolicyMessage
) => {
  if (!message) {
    return false;
  }
  const from = message.from?.trim() ?? "";
  const address =
    /^(?:[^<>,;:\r\n"]*|"[^"\r\n]*")\s*<(?<address>[^<>\r\n]+)>$/u.exec(from)
      ?.groups?.address;
  const sender = z.email().safeParse(address ?? from);
  return (
    sender.success &&
    (eligibility.sender.kind === "any" ||
      eligibility.sender.addresses.some(
        (allowed) => allowed.toLowerCase() === sender.data.toLowerCase()
      )) &&
    eligibility.subjectIncludes.every((text) =>
      (message.subject ?? "").toLowerCase().includes(text.toLowerCase())
    ) &&
    eligibility.bodyIncludes.every((text) =>
      (message.bodyText ?? "").toLowerCase().includes(text.toLowerCase())
    )
  );
};

const contentPaths: Partial<Record<string, string[]>> = {
  "calendar.create_event": ["event.title", "event.description"],
  "linear.create_comment": ["body"],
  "linear.create_issue": ["title", "description"],
  "linear.save_comment": ["body"],
  "linear.save_issue": ["title", "description"],
  "linear.update_issue": ["title", "description"],
};

export const resolveAgentEffectArguments = (input: {
  tool: AgentCatalogTool;
  template: string;
  message: PolicyMessage;
}) => {
  const invalidPolicy = new ORPCError("BAD_REQUEST", {
    message:
      "Review this action with exact change arguments. Only titles, descriptions, and comment bodies can copy the incoming message's subject or body.",
  });
  const paths = contentPaths[input.tool.toolId];
  if (!paths) {
    throw invalidPolicy;
  }
  const template: unknown = JSON.parse(input.template);
  const parsed = z.json().parse(template);
  const resolve = (
    value: z.infer<ReturnType<typeof z.json>>,
    path: string
  ): z.infer<ReturnType<typeof z.json>> => {
    if (typeof value === "string") {
      const hasBinding = value.includes("{{");
      if (
        hasBinding &&
        (!paths.includes(path) ||
          value
            .replaceAll("{{message.subject}}", "")
            .replaceAll("{{message.bodyText}}", "")
            .includes("{{"))
      ) {
        throw invalidPolicy;
      }
      return value
        .split(/(?<binding>\{\{message\.(?:subject|bodyText)\}\})/u)
        .map((part) => {
          if (part === "{{message.subject}}") {
            return input.message.subject ?? "";
          }
          if (part === "{{message.bodyText}}") {
            return input.message.bodyText ?? "";
          }
          return part;
        })
        .join("");
    }
    if (Array.isArray(value)) {
      return value.map((item, index) => resolve(item, `${path}.${index}`));
    }
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => {
          if (
            ["__proto__", "prototype", "constructor"].includes(key) ||
            key.includes("{{") ||
            key.includes(".")
          ) {
            throw invalidPolicy;
          }
          return [key, resolve(item, path ? `${path}.${key}` : key)];
        })
      );
    }
    return value;
  };
  const args = z.record(z.string(), z.unknown()).parse(resolve(parsed, ""));
  const schema = z.fromJSONSchema(
    z.record(z.string(), z.unknown()).parse(input.tool.inputSchema)
  );
  // Validate without using the parser's transformed output as write authority.
  schema.parse(args);
  return args;
};

export const getAgentConnectorEffects = (
  specification: ActionSpecification,
  tools: AgentCatalogTool[]
) => {
  const writes = tools.filter(
    (tool) => tool.scope === "connector" && tool.operation === "write"
  );
  return writes.map((tool) => {
    const referenceId = specification.connectors.find(
      (connector) => connector.connectionId === tool.connectionId
    )?.referenceId;
    const permissionId = specification.permissions.find(
      (permission) =>
        permission.scope === "connector" &&
        permission.operation === "write" &&
        permission.connectorReferenceId === referenceId
    )?.id;
    const grant = specification.toolGrants.find(
      (candidate) =>
        candidate.permissionId === permissionId &&
        candidate.toolId === tool.toolId
    );
    if (!specification.eligibility || !grant?.argumentTemplate) {
      throw new ORPCError("BAD_REQUEST", {
        message:
          "Review this action again to approve sender conditions and exact connected account changes before enabling it.",
      });
    }
    try {
      resolveAgentEffectArguments({
        message: { bodyText: "Message body", subject: "Message subject" },
        template: grant.argumentTemplate,
        tool,
      });
    } catch {
      throw new ORPCError("BAD_REQUEST", {
        message:
          "This connected change has unsupported arguments or message mappings. Review it with exact destination identifiers and supported arguments before enabling it.",
      });
    }
    return { template: grant.argumentTemplate, tool };
  });
};

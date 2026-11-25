import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { ORPCError } from "@orpc/server";
import type { McpAccount } from "@quieter/auth/mcp";
import { mcpAccountActions } from "@quieter/auth/mcp-account-actions";
import { createOrpcContext } from "@quieter/orpc/context";
import { z } from "zod";

import {
  mcpAuthorizationSchema,
  requireMcpApproval,
} from "../mcp-approval.server";
import { reportServerError } from "../server-error-reporting";
import type { ActionPolicy } from "./actions.server";
import {
  orpcActions,
  parseActionInput,
  resolveOrpcAction,
} from "./actions.server";
import { mcpWorkflowGuide } from "./guide";
import {
  backfillScopeSchema,
  composeFields,
  getMailChangePolicy,
  managedRulesSchema,
  prepareMailInput,
  serializeMailAttachment,
  withMailLinks,
} from "./mail.server";

const catalog = new Map(
  Object.entries(orpcActions).flatMap(([domain, actions]) =>
    Object.entries(actions).flatMap(([name, spec]) => {
      if (spec === "internal") {
        return [];
      }
      const [policy, description] = spec;
      const action = `${domain}.${name}`;
      return [[action, { action, description, domain, policy }] as const];
    })
  )
);

const accountActions = new Map(
  Object.entries(mcpAccountActions).map(([name, entry]) => [
    name.replace("_", "."),
    entry,
  ])
);
for (const [action, entry] of accountActions) {
  catalog.set(action, {
    action,
    description: entry.description,
    domain: action.startsWith("team.") ? "team" : "account",
    policy: entry.policy === "bulk-delete" ? "bulk_delete" : entry.policy,
  });
}

const toolsByPolicy = {
  automation: "quieter_sensitive_change",
  bulk_delete: "quieter_sensitive_change",
  delete: "quieter_sensitive_change",
  mail_change: "quieter_change",
  read: "quieter_read",
  send: "quieter_sensitive_change",
  write: "quieter_change",
} satisfies Record<ActionPolicy, string>;

const transactionalActions = [
  {
    action: "transactional_send_email",
    description: "Send transactional email from a verified team domain.",
  },
  {
    action: "transactional_get_delivery",
    description: "Read the delivery receipt for a transactional message.",
  },
  {
    action: "transactional_list_suppressions",
    description: "List recipients suppressed for a team.",
  },
  {
    action: "transactional_add_suppression",
    description: "Suppress transactional email to an address.",
  },
  {
    action: "transactional_remove_suppression",
    description: "Remove a transactional email suppression.",
  },
].map((entry) => ({ ...entry, domain: "transactional", tool: entry.action }));

const searchAliases = new Map([
  ["archive", "done"],
  ["attachments", "attachment"],
  ["delete", "trash"],
  ["email", "mail"],
  ["emails", "mail"],
  ["star", "importance"],
]);
const searchStopWords = new Set([
  "a",
  "an",
  "and",
  "for",
  "in",
  "my",
  "the",
  "to",
]);
const actionWords = (value: string) =>
  value
    .replaceAll(/(?<=[a-z])(?=[A-Z])/gu, " ")
    .toLowerCase()
    .match(/[a-z0-9]+/gu) ?? [];

const toResult = (value: unknown): CallToolResult => {
  const structuredContent = { result: value ?? null };
  return {
    content: [{ text: JSON.stringify(structuredContent), type: "text" }],
    structuredContent,
  };
};

const errorResult = (message: string): CallToolResult => ({
  content: [{ text: message, type: "text" }],
  isError: true,
});

const describeInput = (action: string, schema: z.ZodType) => {
  const field = composeFields.get(action);
  return z.toJSONSchema(schema, {
    io: "input",
    override: ({ jsonSchema, path, zodSchema }) => {
      if (field !== undefined && path.join(".") === `properties.${field}`) {
        const optional = new Set([
          "attachments",
          "bodyHtml",
          "inlineImages",
          "saveStatus",
          "updatedAt",
        ]);
        if (action !== "mail.saveDraft") {
          optional.add("localId");
        }
        jsonSchema.required = (jsonSchema.required ?? []).filter(
          (key) => !optional.has(key)
        );
        if (action !== "mail.saveDraft") {
          jsonSchema.required.push("sendOperationId");
        }
      }
      if (
        field !== undefined &&
        path.join(".") === `properties.${field}.properties.recipients`
      ) {
        jsonSchema.required = ["to"];
      }
      if (zodSchema instanceof z.ZodFile) {
        Object.assign(
          jsonSchema,
          z.toJSONSchema(
            z.strictObject({
              base64: z.string().describe("Base64-encoded file bytes."),
            })
          )
        );
      }
    },
    unrepresentable: "any",
  });
};

const searchActionsSchema = z.strictObject({
  action: z
    .string()
    .optional()
    .describe("Exact action name to get its input schema."),
  domain: z
    .string()
    .optional()
    .describe(
      "A domain returned by this tool, such as mail, mailDomains, team, calendar, or billing."
    ),
  query: z
    .string()
    .trim()
    .optional()
    .describe(
      "Words from the action or its description, such as 'mailbox' or 'search'."
    ),
});

const actionInputSchema = z.strictObject({
  action: z
    .string()
    .describe("An exact action name from quieter_find_actions."),
  input: z
    .record(z.string(), z.unknown())
    .default({})
    .describe("Use the action's input schema from quieter_find_actions."),
});
const changeInputSchema = actionInputSchema.extend({
  authorization: mcpAuthorizationSchema
    .optional()
    .describe(
      "Use explicit for a small exact deletion requested by the user. Use returned approval only after the user approves. Use send_without_review only when the user expressly waives review."
    ),
});

export const registerAccountTools = (
  server: McpServer,
  options: {
    account: McpAccount;
    principal: string;
    request: Request;
    scheduleBackgroundTask?: (task: Promise<unknown>) => void;
    webOrigin: string;
  }
) => {
  const { account, principal, request, scheduleBackgroundTask, webOrigin } =
    options;
  const guideUri = "quieter://guide/workflows";
  server.registerResource(
    "quieter-workflow-guide",
    guideUri,
    {
      description: "How to work with mail, web links, and approvals.",
      mimeType: "text/markdown",
      title: "Quieter workflow guide",
    },
    (uri) => ({
      contents: [
        { mimeType: "text/markdown", text: mcpWorkflowGuide, uri: uri.href },
      ],
    })
  );
  server.registerPrompt(
    "quieter-workflows",
    {
      description: "Load Quieter's workflow, linking, and approval guidance.",
      title: "Quieter workflows",
    },
    () => ({
      messages: [
        { content: { text: mcpWorkflowGuide, type: "text" }, role: "user" },
      ],
    })
  );

  server.registerTool(
    "quieter_find_actions",
    {
      annotations: { openWorldHint: false, readOnlyHint: true },
      description:
        "Find Quieter account and mailbox actions. Call with no arguments for domains, a domain or query for matching actions, or an exact action name for the input schema.",
      inputSchema: searchActionsSchema,
      title: "Find Quieter actions",
    },
    async ({ action, domain, query }) => {
      if (action !== undefined) {
        const transactionalAction = transactionalActions.find(
          (entry) => entry.action === action
        );
        if (transactionalAction !== undefined) {
          return toResult(transactionalAction);
        }
        const entry = catalog.get(action);
        if (entry === undefined) {
          return errorResult(
            "Unknown action. Search the action catalog for its exact name."
          );
        }
        const operation =
          accountActions.get(action) ?? (await resolveOrpcAction(action));
        return toResult({
          ...entry,
          inputSchema: describeInput(action, operation.schema),
          tool: toolsByPolicy[entry.policy],
          ...(entry.policy === "mail_change"
            ? { sensitiveTool: "quieter_sensitive_change" }
            : {}),
        });
      }
      if (domain === undefined && !query) {
        return toResult({
          domains: [
            ...new Set([...catalog.values()].map((entry) => entry.domain)),
            "transactional",
          ],
          guide: { text: mcpWorkflowGuide, uri: guideUri },
          startWith: [
            "mail.listMailboxes",
            "mail.listThreads",
            "mail.getThread",
            "team.list",
          ],
          transactionalTools:
            "Use the transactional_* tools for API sends, delivery, and suppressions.",
        });
      }
      const words = actionWords(query ?? "").filter(
        (word) => !searchStopWords.has(word)
      );
      const candidates = [
        ...[...catalog.values()].map((entry) => ({
          ...entry,
          tool: toolsByPolicy[entry.policy],
        })),
        ...transactionalActions,
      ].filter(
        (entry) =>
          domain === undefined ||
          entry.domain.toLowerCase() === domain.toLowerCase()
      );
      const matches = candidates
        .map((entry) => {
          const tokens = new Set(
            actionWords(`${entry.action} ${entry.description}`)
          );
          let score = 0;
          for (const word of words) {
            const alias = searchAliases.get(word);
            if (
              tokens.has(word) ||
              (alias !== undefined && tokens.has(alias))
            ) {
              score += 1;
            }
          }
          return { entry, score };
        })
        .filter(({ score }) => words.length === 0 || score > 0)
        .toSorted((left, right) => right.score - left.score);
      const actions = (words.length === 0 ? matches : matches.slice(0, 20)).map(
        ({ entry }) => entry
      );
      return toResult({
        actions,
        ...(actions.length === 0
          ? {
              hint: "Try another term or call without filters to see all domains.",
            }
          : {}),
      });
    }
  );

  const run = async (
    tool: (typeof toolsByPolicy)[ActionPolicy],
    args: z.infer<typeof changeInputSchema>
  ): Promise<CallToolResult> => {
    const entry = catalog.get(args.action);
    if (entry === undefined) {
      return errorResult("Unknown action. Use quieter_find_actions first.");
    }
    if (
      entry.policy !== "mail_change" &&
      toolsByPolicy[entry.policy] !== tool
    ) {
      return errorResult(`Use ${toolsByPolicy[entry.policy]} for this action.`);
    }
    try {
      const accountAction = accountActions.get(args.action);
      const operation = accountAction ?? (await resolveOrpcAction(args.action));
      const prepared = prepareMailInput(args.action, args.input);
      let { input, preview } = prepared;
      let approvalPayload: unknown = args.input;
      let parsed = parseActionInput(operation.schema, input);
      const context = createOrpcContext({
        mcpUser: account,
        req: request,
        scheduleBackgroundTask,
      });
      if (args.action === "mail.startManagedRuleBackfill") {
        const { mailboxId, ruleId } = backfillScopeSchema.parse(parsed);
        const listRules = await resolveOrpcAction("mail.listManagedRules");
        const rules = managedRulesSchema.parse(
          await listRules.run({ mailboxId }, context)
        );
        const definition = rules.find((rule) => rule.id === ruleId);
        if (definition === undefined) {
          return errorResult("Rule not found.");
        }
        input = { ...input, expectedRevision: definition.revision };
        preview = { ...input, definition };
        approvalPayload = preview;
        parsed = preview;
      }
      if (args.action === "mail.unsubscribeFromMessage") {
        const previewUnsubscribe = await resolveOrpcAction(
          "mail.previewUnsubscribe"
        );
        const outbound = z
          .object({
            body: z.string(),
            from: z.string(),
            requestHash: z.string(),
            subject: z.string(),
            to: z.string(),
          })
          .parse(await previewUnsubscribe.run(input, context));
        input = { ...input, expectedRequestHash: outbound.requestHash };
        preview = { ...input, message: outbound };
        approvalPayload = preview;
      }
      const policy: ActionPolicy =
        entry.policy === "mail_change"
          ? getMailChangePolicy(args.action, parsed)
          : entry.policy;
      if (toolsByPolicy[policy] !== tool) {
        return errorResult(`Use ${toolsByPolicy[policy]} for this change.`);
      }
      if (
        policy === "send" ||
        policy === "automation" ||
        policy === "delete" ||
        policy === "bulk_delete"
      ) {
        const approval = requireMcpApproval({
          action: args.action,
          authorization: args.authorization,
          effect: policy,
          payload: approvalPayload,
          preview,
          principal,
        });
        if (approval !== null) {
          return approval;
        }
      }

      if ("handler" in operation) {
        return toResult(await operation.handler(account, input));
      }
      if (args.action === "connectors.startConnection") {
        const { provider } = z.object({ provider: z.string() }).parse(parsed);
        const url = new URL("/settings", webOrigin);
        url.search = new URLSearchParams({
          connectorProvider: provider,
          tab: "connectors",
        }).toString();
        return toResult({
          authorizationUrl: url.href,
          completeInBrowser: true,
        });
      }
      const result = await operation.run(input, context);
      if (args.action === "mail.getAttachment") {
        return toResult(
          await serializeMailAttachment(result, input, webOrigin)
        );
      }
      return toResult(withMailLinks(args.action, input, result, webOrigin));
    } catch (error) {
      if (error instanceof ORPCError && error.status < 500) {
        return errorResult(error.message);
      }
      if (
        error instanceof Error &&
        error.name === "APIError" &&
        "statusCode" in error &&
        typeof error.statusCode === "number" &&
        error.statusCode < 500
      ) {
        return errorResult(error.message);
      }
      reportServerError(error, `mcp:${args.action}`);
      return errorResult("Quieter could not complete this action. Try again.");
    }
  };

  server.registerTool(
    "quieter_read",
    {
      annotations: { readOnlyHint: true },
      description:
        "Run a read action from quieter_find_actions, such as listing mailboxes, searching mail, reading a conversation, or checking settings.",
      inputSchema: actionInputSchema,
      title: "Read from Quieter",
    },
    async (args) => await run("quieter_read", args)
  );
  server.registerTool(
    "quieter_change",
    {
      annotations: { destructiveHint: false, readOnlyHint: false },
      description:
        "Run an ordinary change from quieter_find_actions, such as saving a draft, labeling a message, or changing settings.",
      inputSchema: actionInputSchema,
      title: "Make a change in Quieter",
    },
    async (args) => await run("quieter_change", args)
  );
  server.registerTool(
    "quieter_sensitive_change",
    {
      annotations: { destructiveHint: true, readOnlyHint: false },
      description:
        "Send mail or run a deletion. If the result is approval_required, show the preview, wait for the user, then repeat the same request with the returned authorization.",
      inputSchema: changeInputSchema,
      title: "Send or delete in Quieter",
    },
    async (args) => await run("quieter_sensitive_change", args)
  );
};

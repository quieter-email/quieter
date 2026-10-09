import { z } from "zod";

const identifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z][a-z0-9_]*(?:[.:-][a-z][a-z0-9_]*)*$/u);

const nonEmptyTextSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, {
    error: "Value cannot contain only whitespace.",
  });

const connectorReferenceSchema = z.strictObject({
  connectionId: nonEmptyTextSchema.max(128),
  referenceId: identifierSchema,
});

const permissionSchema = z.discriminatedUnion("scope", [
  z.strictObject({
    id: identifierSchema,
    operation: z.enum(["read", "write", "send", "delete"]),
    scope: z.literal("mailbox"),
  }),
  z.strictObject({
    id: identifierSchema,
    operation: z.enum(["read", "write", "delete"]),
    scope: z.literal("memory"),
  }),
  z.strictObject({
    connectorReferenceId: identifierSchema,
    id: identifierSchema,
    operation: z.enum(["read", "write", "send", "delete"]),
    scope: z.literal("connector"),
  }),
]);

const localTimeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u);

const timeZoneSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z_]+(?:\/[a-z0-9_+-]+)*$/iu)
  .refine(
    (value) => {
      try {
        return Boolean(
          new Intl.DateTimeFormat("en", { timeZone: value }).resolvedOptions()
            .timeZone
        );
      } catch {
        return false;
      }
    },
    { error: "Use a named IANA time zone." }
  );

const triggerSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("manual") }),
  z.strictObject({ kind: z.literal("mail_received") }),
  z.strictObject({
    kind: z.literal("scheduled"),
    schedule: z.discriminatedUnion("cadence", [
      z.strictObject({
        cadence: z.literal("daily"),
        localTime: localTimeSchema,
        timeZone: timeZoneSchema,
      }),
      z.strictObject({
        cadence: z.literal("weekly"),
        dayOfWeek: z.enum([
          "monday",
          "tuesday",
          "wednesday",
          "thursday",
          "friday",
          "saturday",
          "sunday",
        ]),
        localTime: localTimeSchema,
        timeZone: timeZoneSchema,
      }),
    ]),
  }),
  z.strictObject({
    eventType: identifierSchema,
    kind: z.literal("future_event"),
  }),
]);

export const actionSpecificationSchema = z
  .strictObject({
    connectors: z.array(connectorReferenceSchema).max(16),
    instructions: nonEmptyTextSchema.max(8192),
    mailboxId: nonEmptyTextSchema.max(128),
    permissions: z.array(permissionSchema).max(32),
    review: z.strictObject({
      assumptions: z.array(nonEmptyTextSchema.max(512)).max(16),
      questions: z.array(nonEmptyTextSchema.max(512)).max(16),
      summary: nonEmptyTextSchema.max(1024),
    }),
    sourceText: nonEmptyTextSchema.max(16_384),
    toolGrants: z
      .array(
        z.strictObject({
          confirmation: z.enum(["none", "required"]),
          permissionId: identifierSchema,
          toolId: identifierSchema,
        })
      )
      .max(64),
    trigger: triggerSchema,
    version: z.literal(1, {
      error: "This action specification version is unsupported.",
    }),
  })
  .superRefine((specification, context) => {
    const references = new Set<string>();
    const connectionIds = new Set<string>();
    for (const [index, connector] of specification.connectors.entries()) {
      if (references.has(connector.referenceId)) {
        context.addIssue({
          code: "custom",
          message: "Connector reference must be unique.",
          path: ["connectors", index, "referenceId"],
        });
      }
      if (connectionIds.has(connector.connectionId)) {
        context.addIssue({
          code: "custom",
          message: "Connector connection must be unique.",
          path: ["connectors", index, "connectionId"],
        });
      }
      references.add(connector.referenceId);
      connectionIds.add(connector.connectionId);
    }

    const permissions = new Map<
      string,
      (typeof specification.permissions)[number]
    >();
    const permissionTargets = new Set<string>();
    for (const [index, permission] of specification.permissions.entries()) {
      if (permissions.has(permission.id)) {
        context.addIssue({
          code: "custom",
          message: "Permission identifier must be unique.",
          path: ["permissions", index, "id"],
        });
      }
      permissions.set(permission.id, permission);

      const target = JSON.stringify([
        permission.scope,
        permission.scope === "connector"
          ? permission.connectorReferenceId
          : null,
        permission.operation,
      ]);
      if (permissionTargets.has(target)) {
        context.addIssue({
          code: "custom",
          message: "Permission target and operation must be unique.",
          path: ["permissions", index],
        });
      }
      permissionTargets.add(target);

      if (
        permission.scope === "connector" &&
        !references.has(permission.connectorReferenceId)
      ) {
        context.addIssue({
          code: "custom",
          message: "Connector permission must reference a declared connection.",
          path: ["permissions", index, "connectorReferenceId"],
        });
      }
    }

    const toolTargets = new Set<string>();
    for (const [index, grant] of specification.toolGrants.entries()) {
      const permission = permissions.get(grant.permissionId);
      if (!permission) {
        context.addIssue({
          code: "custom",
          message: "Tool grant must reference a declared permission.",
          path: ["toolGrants", index, "permissionId"],
        });
        continue;
      }

      const target = JSON.stringify([
        grant.toolId,
        permission.scope,
        permission.scope === "connector"
          ? permission.connectorReferenceId
          : null,
      ]);
      if (toolTargets.has(target)) {
        context.addIssue({
          code: "custom",
          message: "Tool grant must be unique for its target.",
          path: ["toolGrants", index],
        });
      }
      toolTargets.add(target);

      if (
        (permission.operation === "send" ||
          permission.operation === "delete") &&
        grant.confirmation !== "required"
      ) {
        context.addIssue({
          code: "custom",
          message: "Sending and deleting require confirmation.",
          path: ["toolGrants", index, "confirmation"],
        });
      }
    }
  });

export type ActionSpecification = z.infer<typeof actionSpecificationSchema>;

export type ActionSpecificationValidationIssue = {
  path: string;
  code: string;
  message: string;
};

export type ActionSpecificationValidationResult =
  | {
      status: "invalid";
      specification: null;
      issues: ActionSpecificationValidationIssue[];
    }
  | {
      status: "valid" | "needs_review";
      specification: ActionSpecification;
      issues: ActionSpecificationValidationIssue[];
    };

export const validateActionSpecification = (
  input: unknown
): ActionSpecificationValidationResult => {
  const result = actionSpecificationSchema.safeParse(input);
  if (!result.success) {
    return {
      issues: result.error.issues.map((issue) => ({
        code: issue.code,
        message: (() => {
          if (issue.code === "custom") {
            return issue.message;
          }
          if (issue.path.join(".") === "version") {
            return "This action specification version is unsupported.";
          }
          if (issue.code === "unrecognized_keys") {
            return "Remove unsupported fields.";
          }
          if (issue.code === "too_small") {
            return "A longer value or more items are required.";
          }
          if (issue.code === "too_big") {
            return "Value or list exceeds the allowed limit.";
          }
          if (issue.code === "invalid_format") {
            return "Value has an invalid format.";
          }
          if (
            issue.code === "invalid_value" ||
            issue.code === "invalid_union"
          ) {
            return "Value does not match a supported option.";
          }
          return "Value has an invalid type.";
        })(),
        path: issue.path.join("."),
      })),
      specification: null,
      status: "invalid",
    };
  }

  const issues: ActionSpecificationValidationIssue[] = [];
  if (result.data.review.assumptions.length > 0) {
    issues.push({
      code: "requires_review",
      message: "Assumptions require review.",
      path: "review.assumptions",
    });
  }
  if (result.data.review.questions.length > 0) {
    issues.push({
      code: "requires_review",
      message: "Open questions require review.",
      path: "review.questions",
    });
  }
  if (result.data.trigger.kind === "future_event") {
    issues.push({
      code: "requires_review",
      message: "Future event triggers require review.",
      path: "trigger",
    });
  }

  return {
    issues,
    specification: result.data,
    status: issues.length > 0 ? "needs_review" : "valid",
  };
};

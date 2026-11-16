import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";

import {
  createManagementClient,
  managementContracts,
  ManagementError,
  managementMutationActionSchema,
  managementOperationIdSchema,
  managementSettingsUpdatePreparationSchema,
  managementTargetSchema,
  normalizeManagementOrigin,
} from "@quieter/management-sdk";
import { z } from "zod";

const help = `Usage:
  quieter-management capabilities --origin URL --session-file PATH --input PATH|-
  quieter-management prepare-settings-update --origin URL --session-file PATH --input PATH|-
  quieter-management review-mutation --origin URL --session-file PATH --input PATH|-
  quieter-management cancel-mutation --origin URL --session-file PATH --input PATH|-
  quieter-management execute OPERATION --origin URL --session-file PATH --input PATH|-

The input is JSON. Use --input - to read it from stdin.
The session file contains JSON with origin and cookie fields.
Capabilities reports operations available to the current session and target.
Preparation returns a browser review link without approving or executing.
Review and cancellation take JSON containing only the mutation id.
Execution never retries or creates mutation approvals.
`;

const sessionSchema = z.strictObject({
  cookie: z.string().min(1),
  origin: z.string().min(1),
});

class CommandError extends Error {
  readonly code: "INVALID_ARGUMENTS" | "INVALID_INPUT";

  constructor(code: "INVALID_ARGUMENTS" | "INVALID_INPUT") {
    super(
      code === "INVALID_ARGUMENTS"
        ? "Provide a command, origin, session file, and JSON input file."
        : "Provide valid JSON matching the selected command."
    );
    this.name = "CommandError";
    this.code = code;
  }
}

export const runManagementCli = async (options: {
  args: readonly string[];
  readStdin: () => Promise<string>;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  fetch?: typeof globalThis.fetch;
}): Promise<number> => {
  try {
    let parsed: ReturnType<typeof parseArgs>;
    try {
      parsed = parseArgs({
        allowPositionals: true,
        args: [...options.args],
        options: {
          help: { short: "h", type: "boolean" },
          input: { type: "string" },
          origin: { type: "string" },
          "session-file": { type: "string" },
        },
        strict: true,
      });
    } catch {
      throw new CommandError("INVALID_ARGUMENTS");
    }
    if (parsed.values.help === true) {
      options.stdout(help);
      return 0;
    }
    const [command, operation, ...extra] = parsed.positionals;
    const originInput = parsed.values.origin;
    const inputFile = parsed.values.input;
    const sessionFile = parsed.values["session-file"];
    if (
      typeof originInput !== "string" ||
      !originInput ||
      typeof inputFile !== "string" ||
      !inputFile ||
      typeof sessionFile !== "string" ||
      !sessionFile ||
      sessionFile === "-" ||
      extra.length > 0
    ) {
      throw new CommandError("INVALID_ARGUMENTS");
    }
    switch (command) {
      case "capabilities":
      case "prepare-settings-update":
      case "review-mutation":
      case "cancel-mutation": {
        if (operation !== undefined) {
          throw new CommandError("INVALID_ARGUMENTS");
        }
        break;
      }
      case "execute": {
        if (operation === undefined) {
          throw new CommandError("INVALID_ARGUMENTS");
        }
        break;
      }
      default: {
        throw new CommandError("INVALID_ARGUMENTS");
      }
    }
    const origin = normalizeManagementOrigin(originInput);
    let input: unknown;
    try {
      input = JSON.parse(
        inputFile === "-"
          ? await options.readStdin()
          : await readFile(inputFile, "utf-8")
      );
    } catch {
      throw new CommandError("INVALID_INPUT");
    }
    const client = createManagementClient({
      auth: {
        async getCookie() {
          const sessionJson: unknown = JSON.parse(
            await readFile(sessionFile, "utf-8")
          );
          const session = sessionSchema.parse(sessionJson);
          if (normalizeManagementOrigin(session.origin) !== origin) {
            throw new ManagementError("SESSION_UNAVAILABLE");
          }
          return session.cookie;
        },
        kind: "session-cookie",
      },
      fetch: options.fetch,
      origin,
    });
    let result: unknown;
    switch (command) {
      case "capabilities": {
        const target = managementTargetSchema.safeParse(input);
        if (!target.success) {
          throw new CommandError("INVALID_INPUT");
        }
        result = await client.capabilities({ target: target.data });
        break;
      }
      case "prepare-settings-update": {
        const parameters =
          managementSettingsUpdatePreparationSchema.safeParse(input);
        if (!parameters.success) {
          throw new CommandError("INVALID_INPUT");
        }
        result = await client.prepareSettingsUpdate({
          parameters: parameters.data,
        });
        break;
      }
      case "review-mutation":
      case "cancel-mutation": {
        const action = managementMutationActionSchema.safeParse(input);
        if (!action.success) {
          throw new CommandError("INVALID_INPUT");
        }
        result =
          command === "review-mutation"
            ? await client.reviewMutation(action.data)
            : await client.cancelMutation(action.data);
        break;
      }
      case "execute": {
        const selected = managementOperationIdSchema.safeParse(operation);
        if (!selected.success) {
          throw new CommandError("INVALID_ARGUMENTS");
        }
        const parameters =
          managementContracts[selected.data].input.safeParse(input);
        if (!parameters.success) {
          throw new CommandError("INVALID_INPUT");
        }
        result = await client.execute({
          operation: selected.data,
          parameters: parameters.data,
        });
        break;
      }
      default: {
        throw new CommandError("INVALID_ARGUMENTS");
      }
    }
    options.stdout(`${JSON.stringify(result)}\n`);
    return 0;
  } catch (error) {
    if (error instanceof ManagementError || error instanceof CommandError) {
      options.stderr(`${error.code}: ${error.message}\n`);
    } else {
      options.stderr("COMMAND_FAILED: The command could not be completed.\n");
    }
    return 1;
  }
};

// oxlint-disable-next-line typescript-eslint/triple-slash-reference
/// <reference path="../.sst/platform/config.d.ts" />

import { readFile } from "node:fs/promises";

export const createRuntimeVersion = (
  name: string,
  worker: sst.cloudflare.Worker,
  args: cloudflare.WorkersScriptArgs
) => {
  if (args.contentFile === undefined || args.migrations !== undefined) {
    throw new Error(
      "Runtime-only uploads require a compiled module and no Durable Object migration."
    );
  }
  return new cloudflare.WorkerVersion(
    name,
    {
      accountId: args.accountId,
      assets:
        args.assets === undefined
          ? undefined
          : $util.output(args.assets).apply((assets) => ({
              config:
                assets.config === undefined
                  ? undefined
                  : {
                      htmlHandling: assets.config.htmlHandling,
                      notFoundHandling: assets.config.notFoundHandling,
                      // oxlint-disable-next-line no-unsafe-assignment -- The pinned provider types this documented boolean/string-array field as any.
                      runWorkerFirst: assets.config.runWorkerFirst,
                    },
              directory: assets.directory,
            })),
      bindings: $util.output(args.bindings ?? []).apply((bindings) =>
        bindings.map((binding) => {
          const { name: bindingName, type } = binding;
          switch (type) {
            case "plain_text":
            case "secret_text": {
              return { name: bindingName, text: binding.text, type };
            }
            case "r2_bucket": {
              return {
                bucketName: binding.bucketName,
                jurisdiction: binding.jurisdiction,
                name: bindingName,
                type,
              };
            }
            case "queue": {
              return { name: bindingName, queueName: binding.queueName, type };
            }
            case "durable_object_namespace": {
              return {
                className: binding.className,
                name: bindingName,
                namespaceId: binding.namespaceId,
                scriptName: binding.scriptName,
                type,
              };
            }
            case "assets": {
              return { name: bindingName, type };
            }
            case "version_metadata": {
              return { name: bindingName, type };
            }
            default: {
              throw new Error(
                `Runtime upload does not yet support binding type ${type}.`
              );
            }
          }
        })
      ),
      compatibilityDate: args.compatibilityDate,
      compatibilityFlags: args.compatibilityFlags,
      mainModule: "placeholder",
      modules: [
        {
          contentBase64: $util.output(args.contentFile).apply(async (file) => {
            const content = await readFile(file);
            return content.toString("base64");
          }),
          contentType: "application/javascript+module",
          name: "placeholder",
        },
      ],
      workerId: worker.nodes.worker.scriptName,
    },
    { retainOnDelete: true }
  );
};

import { sstSecretNames } from "@quieter/env/sst-secrets";
import type { SstSecretName } from "@quieter/env/sst-secrets";

import type { SecretBindings, SecretResources } from "./types";

const directOnlySecretNames = new Set<SstSecretName>([
  "DATABASE_URL",
  "MAIL_INGEST_TOKEN",
]);

const isSecretName = (name: string): name is SstSecretName =>
  Object.hasOwn(sstSecretNames, name);

export const requireSecretResource = (
  secretResources: SecretResources,
  name: SstSecretName
) => {
  const secret = secretResources[name];
  if (secret === undefined) {
    throw new Error(`SST secret ${sstSecretNames[name]} is not declared`);
  }

  return secret;
};

export const requireSecretBinding = (
  secretBindings: SecretBindings,
  name: SstSecretName
) => {
  const binding = secretBindings[name];
  if (binding === undefined) {
    throw new Error(`Cloudflare secret binding ${name} is not declared`);
  }

  return binding;
};

export const createSecretInfrastructure = (
  gmailBodyStorageEnabled: boolean
) => {
  const secretResources: SecretResources = {};
  for (const [environmentName, secretName] of Object.entries(sstSecretNames)) {
    if (!isSecretName(environmentName)) {
      throw new Error(`Unknown SST secret environment name ${environmentName}`);
    }
    secretResources[environmentName] = new sst.Secret(
      secretName,
      environmentName === "GMAIL_BODY_ENCRYPTION_KEY" &&
        !gmailBodyStorageEnabled
        ? ""
        : undefined
    );
  }

  const secretBindings: SecretBindings = {};
  for (const [environmentName, secret] of Object.entries(secretResources)) {
    if (!isSecretName(environmentName)) {
      throw new Error(`Unknown SST secret environment name ${environmentName}`);
    }
    if (directOnlySecretNames.has(environmentName)) {
      continue;
    }
    const value =
      environmentName === "GMAIL_BODY_ENCRYPTION_KEY" && gmailBodyStorageEnabled
        ? secret.value.apply((keys) => {
            if (!/^[\da-f]{64}(?:,[\da-f]{64})*$/iu.test(keys)) {
              throw new Error(
                "GmailBodyEncryptionKey requires 32-byte hex keys."
              );
            }
            return keys;
          })
        : secret.value;
    secretBindings[environmentName] = new sst.Linkable(environmentName, {
      include: [
        sst.cloudflare.binding({
          properties: { text: value },
          type: "secretTextBindings",
        }),
      ],
      properties: {},
    });
  }

  return { secretBindings, secretResources };
};

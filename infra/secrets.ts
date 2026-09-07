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

export const createSecretInfrastructure = () => {
  const secretResources: SecretResources = {};
  for (const [environmentName, secretName] of Object.entries(sstSecretNames)) {
    if (!isSecretName(environmentName)) {
      throw new Error(`Unknown SST secret environment name ${environmentName}`);
    }
    secretResources[environmentName] = new sst.Secret(secretName);
  }

  const secretBindings: SecretBindings = {};
  for (const [environmentName, secret] of Object.entries(secretResources)) {
    if (!isSecretName(environmentName)) {
      throw new Error(`Unknown SST secret environment name ${environmentName}`);
    }
    if (directOnlySecretNames.has(environmentName)) {
      continue;
    }
    secretBindings[environmentName] = new sst.Linkable(environmentName, {
      include: [
        sst.cloudflare.binding({
          properties: { text: secret.value },
          type: "secretTextBindings",
        }),
      ],
      properties: {},
    });
  }

  return { secretBindings, secretResources };
};

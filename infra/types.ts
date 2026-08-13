// oxlint-disable-next-line typescript-eslint/triple-slash-reference
/// <reference path="../.sst/platform/config.d.ts" />

import type { SstSecretName } from "@quieter/env/sst-secrets";

export type SecretResource = {
  readonly name: $util.Input<string>;
  readonly value: $util.Output<string>;
};

export type SecretResources = Partial<Record<SstSecretName, SecretResource>>;

export type SecretBindings = Partial<Record<SstSecretName, SstLinkable>>;

export type SstLinkable = {
  readonly urn: $util.Output<string>;
  getSSTLink: () => unknown;
};

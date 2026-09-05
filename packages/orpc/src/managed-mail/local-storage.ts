import { serverEnv } from "@quieter/env/server";
import { Resource } from "sst/resource";
import { z } from "zod";

export const LOCAL_MAIL_BUCKET = "quieter-local-mail";

type LocalMailStorage = {
  delete: (key: string) => Promise<void>;
  get: (
    key: string
  ) => Promise<{ arrayBuffer: () => Promise<ArrayBuffer> } | null>;
  put: (key: string, value: Uint8Array) => Promise<unknown>;
};

const localStorageSchema = z.custom<LocalMailStorage>(
  (value) =>
    typeof value === "object" &&
    value !== null &&
    "get" in value &&
    typeof value.get === "function" &&
    "put" in value &&
    typeof value.put === "function" &&
    "delete" in value &&
    typeof value.delete === "function"
);

export const getLocalMailStorage = () => {
  if (serverEnv.QUIETER_DEPLOYMENT_ENV !== "local") {
    throw new Error("Local mail storage is only available in development.");
  }
  return localStorageSchema.parse(Reflect.get(Resource, "LocalMailStorage"));
};

export const assertLocalMailObject = (object: {
  bucket: string;
  key: string;
  provider: string;
}) => {
  if (
    object.provider !== "r2" ||
    object.bucket !== LOCAL_MAIL_BUCKET ||
    !object.key.startsWith("fixtures/")
  ) {
    throw new Error(
      "Local development cannot access remote mail objects. Load local mail fixtures instead."
    );
  }
};

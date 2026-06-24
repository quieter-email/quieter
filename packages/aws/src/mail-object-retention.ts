import {
  hasManagedMailObjectReference,
  hasManagedRawMailObjectReference,
} from "@quieter/orpc/managed-mail/ingestion";
import {
  deleteRawMailObject,
  type RawMailObjectProvider,
  type RawMailObjectReference,
} from "./raw-mail-object";

export const deleteMailObjectUnlessTracked = async (input: {
  bucket: string;
  key: string;
  provider?: RawMailObjectProvider;
}) => {
  const provider = input.provider ?? "s3";
  const tracked =
    provider === "s3"
      ? await hasManagedMailObjectReference({
          s3Bucket: input.bucket,
          s3Key: input.key,
        })
      : await hasManagedRawMailObjectReference({
          bucket: input.bucket,
          key: input.key,
          provider,
        });
  if (tracked) {
    return true;
  }

  const reference: RawMailObjectReference = {
    bucket: input.bucket,
    key: input.key,
    provider,
  };
  await deleteRawMailObject(reference);

  return false;
};

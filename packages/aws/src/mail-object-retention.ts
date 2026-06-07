import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { hasManagedMailObjectReference } from "@quieter/orpc/managed-mail-storage";

export const deleteMailObjectUnlessTracked = async (input: {
  bucket: string;
  key: string;
  s3Client: S3Client;
}) => {
  if (
    await hasManagedMailObjectReference({
      s3Bucket: input.bucket,
      s3Key: input.key,
    })
  ) {
    return true;
  }

  await input.s3Client.send(
    new DeleteObjectCommand({
      Bucket: input.bucket,
      Key: input.key,
    }),
  );

  return false;
};

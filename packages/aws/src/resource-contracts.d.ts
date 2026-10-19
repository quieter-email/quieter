import "sst";

// Local SST runs only the web and background runtimes, so its generated types
// omit these links. AWS handlers require them in the deployed mail stage.
declare module "sst" {
  // oxlint-disable-next-line typescript/consistent-type-definitions
  interface Resource {
    DatabaseUrl: { type: "sst.sst.Secret"; value: string };
    R2AccessKeyId: { type: "sst.sst.Secret"; value: string };
    R2SecretAccessKey: { type: "sst.sst.Secret"; value: string };
    SentryDsn: { type: "sst.sst.Secret"; value: string };
    MailBucket: { name: string; type: "sst.aws.Bucket" };
    MailIngestToken: { type: "sst.sst.Secret"; value: string };
    GmailTokenEncryptionKey: { type: "sst.sst.Secret"; value: string };
    GmailTokenEncryptionKeyCurrent: { type: "sst.sst.Secret"; value: string };
    OpenrouterApiKey: { type: "sst.sst.Secret"; value: string };
    PolarAccessToken: { type: "sst.sst.Secret"; value: string };
    QuieterBackgroundModel: { type: "sst.sst.Secret"; value: string };
  }
}

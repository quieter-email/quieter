import "sst";

// Local SST runs only the web and background runtimes, so its generated types
// omit these links. AWS handlers require them in the deployed mail stage.
declare module "sst" {
  // oxlint-disable-next-line typescript/consistent-type-definitions
  interface Resource {
    MailBucket: { name: string; type: "sst.aws.Bucket" };
    MailIngestToken: { type: "sst.sst.Secret"; value: string };
  }
}

export { assertDatabaseConfigured, db, type DatabaseClient } from "./client";
export {
  account,
  authRelations,
  invitation,
  mailbox,
  mailDomain,
  member,
  organization,
  passkey,
  session,
  tables,
  user,
  verification,
  type MailDomainCheckResult,
  type MailDomainDnsRecord,
  type MailDomainStatus,
} from "./schema";

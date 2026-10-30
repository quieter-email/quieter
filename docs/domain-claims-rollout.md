# Roll out independent domain challenges

This change separates pending DNS challenges from verified ownership. Teams can prepare independent challenges for the same domain. Only one team can verify it. Established ownership survives DNS failures and mode changes until that team removes the domain.

The database and application changes require separate expand and contract releases. The normal deployment runs every committed migration before replacing application Workers, and retains the previous web release for 12 hours. Do not deploy all three new migrations together while the old application can receive requests.

1. In a separately reviewed expand release, include `20261029234109_puzzling_the_call` and `20261029234133_cloudy_gertrude_yorkes`, together with the application changes. Exclude `20261029234137_stale_phil_sheldon` from that release. The first migration adds and backfills permanent ownership in one transaction. The second adds organization-scoped challenge uniqueness and exclusive verified ownership. The original global constraint remains during expansion, so competing pending setup stays unavailable until contraction.
2. Wait for every previous web release to expire and for old domain-management requests to finish. Verify that every process serving domain setup, checks, mode changes, removal, and Domain Connect callbacks uses the new application code. Old removal code can delete shared provider resources without observing the domain lock.
3. In a separately reviewed contract release, include `20261029234137_stale_phil_sheldon`. It removes only the old global domain uniqueness constraint. Keep both new uniqueness constraints. Competing pending challenges now become available.
4. Verify two test teams can prepare independent challenges on a dedicated test domain. Publish only the rightful team's TXT challenge and complete verification. Confirm another team's challenge cannot verify or remove the owner's provider resources.

The migrations carry `quieter:contract` markers where the repository safety checker requires explicit review of data updates and uniqueness constraints. These markers do not enforce release order or drain old Workers. Release packaging and the protected deployment review must enforce the steps above. Do not use the ordinary all-migrations deployment for the expansion step.

The backfill preserves current verified rows, rows with a verification timestamp, and domains already used by managed mailboxes. Historical ownership without any retained proof cannot be reconstructed from a failed row alone. Review such domains before contraction if prior verification was cleared before the expand migration.

Pending challenges retain their organization-specific token across retries. Removing a challenge invalidates its identifier and deletes its Domain Connect attempts through the existing foreign key. Recreating it generates a new token. Pending challenges do not reserve ownership, so no expiry job is required.

Provider identities remain shared while any challenge exists. Removing a losing pending claim leaves shared resources intact. Removing the established owner disables incoming routing; removing the final claim deletes both the identity and routing resources. These operations and verification run under the same transaction-scoped domain lock.

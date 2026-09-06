import type { ReleaseArtifactStore } from "./artifact-store.ts";
import type { AssetArchive } from "./assets.ts";
import type { HealthyRelease } from "./schema.ts";

export class ReleasePreflight {
  private readonly artifacts: Pick<ReleaseArtifactStore, "read">;
  private readonly archive: Pick<AssetArchive, "verify">;

  constructor(
    artifacts: Pick<ReleaseArtifactStore, "read">,
    archive: Pick<AssetArchive, "verify">
  ) {
    this.artifacts = artifacts;
    this.archive = archive;
  }

  async verify(release: HealthyRelease) {
    for (const service of release.services) {
      // oxlint-disable-next-line no-await-in-loop -- Check every retained artifact without unbounded storage requests.
      const manifest = await this.artifacts.read(service.artifactDigest);
      if (manifest.archive !== null) {
        // oxlint-disable-next-line no-await-in-loop -- Read every archived object, including for rollback targets.
        await this.archive.verify(manifest.archive);
      }
    }
  }
}

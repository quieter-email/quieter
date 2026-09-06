import { z } from "zod";

import type { ReleaseArtifact, WorkerArtifact } from "./artifact.ts";
import type { AssetManifest } from "./assets.ts";
import {
  activeDeploymentSchema,
  digestSchema,
  identifierSchema,
} from "./schema.ts";
import type { ActiveDeployment } from "./schema.ts";

export const uploadIntentSchema = z.strictObject({
  artifactDigest: digestSchema,
  baseline: activeDeploymentSchema,
  createdAt: z.iso.datetime(),
  id: z.uuid(),
  scriptName: identifierSchema,
  workflowRunId: z.string().regex(/^\d+$/u),
});
export type UploadIntent = z.infer<typeof uploadIntentSchema>;
export const uploadReceiptSchema = z.strictObject({
  intent: uploadIntentSchema,
  versionId: z.uuid(),
});
export type UploadReceipt = z.infer<typeof uploadReceiptSchema>;
export type UploadStore = {
  claim: (intent: UploadIntent) => Promise<boolean>;
  read: (id: string) => Promise<UploadIntent>;
  receipt: (id: string) => Promise<UploadReceipt | null>;
  complete: (receipt: UploadReceipt) => Promise<void>;
};

type UploadProvider = {
  active: (scriptName: string) => Promise<ActiveDeployment>;
  findUpload: (intent: UploadIntent) => Promise<string | null>;
  uploadArtifact: (
    scriptName: string,
    baselineVersionId: string,
    artifact: WorkerArtifact,
    directory: string,
    intent: UploadIntent
  ) => Promise<{ artifactDigest: string; versionId: string }>;
  verifyArtifact: (
    scriptName: string,
    versionId: string,
    artifact: WorkerArtifact
  ) => Promise<void>;
  verifyBindingInheritance: (
    scriptName: string,
    baselineVersionId: string,
    versionId: string
  ) => Promise<void>;
};

export class ReleaseUpload {
  private readonly store: UploadStore;
  private readonly artifacts: {
    read: (digest: string) => Promise<ReleaseArtifact>;
  };
  private readonly archive: {
    verify: (manifest: AssetManifest) => Promise<void>;
  };
  private readonly provider: UploadProvider;

  constructor(
    store: UploadStore,
    artifacts: { read: (digest: string) => Promise<ReleaseArtifact> },
    archive: { verify: (manifest: AssetManifest) => Promise<void> },
    provider: UploadProvider
  ) {
    this.store = store;
    this.artifacts = artifacts;
    this.archive = archive;
    this.provider = provider;
  }

  async upload(input: UploadIntent, directory: string) {
    const intent = uploadIntentSchema.parse(input);
    const manifest = await this.artifacts.read(intent.artifactDigest);
    if (manifest.archive !== null) {
      await this.archive.verify(manifest.archive);
    }
    const active = await this.provider.active(intent.scriptName);
    if (JSON.stringify(active) !== JSON.stringify(intent.baseline)) {
      throw new Error("Active deployment differs from the upload intent.");
    }
    // Only the process that durably creates the intent may issue the upload.
    if (!(await this.store.claim(intent))) {
      const existing = await this.store.read(intent.id);
      if (JSON.stringify(existing) !== JSON.stringify(intent)) {
        throw new Error("Upload identity already belongs to another intent.");
      }
      return await this.reconcile(intent.id);
    }
    await this.provider.uploadArtifact(
      intent.scriptName,
      intent.baseline.versionId,
      manifest.artifact,
      directory,
      intent
    );
    return await this.reconcile(intent.id);
  }

  async reconcile(id: string): Promise<UploadReceipt> {
    const intent = await this.store.read(id);
    const retained = await this.store.receipt(id);
    if (
      retained !== null &&
      JSON.stringify(retained.intent) !== JSON.stringify(intent)
    ) {
      throw new Error("Upload receipt differs from its durable intent.");
    }
    const versionId = await this.provider.findUpload(intent);
    if (versionId === null) {
      throw new Error(
        "Upload outcome remains unknown. Reconcile later; this intent will not upload again."
      );
    }
    if (retained !== null && retained.versionId !== versionId) {
      throw new Error("Provider upload differs from the retained receipt.");
    }
    const manifest = await this.artifacts.read(intent.artifactDigest);
    await this.provider.verifyArtifact(
      intent.scriptName,
      versionId,
      manifest.artifact
    );
    await this.provider.verifyBindingInheritance(
      intent.scriptName,
      intent.baseline.versionId,
      versionId
    );
    if (manifest.archive !== null) {
      await this.archive.verify(manifest.archive);
    }
    const active = await this.provider.active(intent.scriptName);
    if (JSON.stringify(active) !== JSON.stringify(intent.baseline)) {
      throw new Error(
        "Active deployment changed during upload reconciliation."
      );
    }
    const receipt = { intent, versionId };
    await this.store.complete(receipt);
    return receipt;
  }
}

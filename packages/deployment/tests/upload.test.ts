import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vite-plus/test";

import type { ReleaseArtifact } from "../src/artifact.ts";
import type { ActiveDeployment } from "../src/schema.ts";
import { ReleaseUpload } from "../src/upload.ts";
import type {
  UploadIntent,
  UploadReceipt,
  UploadStore,
} from "../src/upload.ts";

/* oxlint-disable require-await -- Stateful in-memory adapters preserve the asynchronous storage and provider contracts. */
const setup = () => {
  const intent: UploadIntent = {
    artifactDigest: "a".repeat(64),
    baseline: { id: randomUUID(), versionId: randomUUID() },
    createdAt: "2026-09-06T12:00:00.000Z",
    id: randomUUID(),
    scriptName: "proof-worker",
    workflowRunId: "123",
  };
  const versionId = randomUUID();
  let stored: UploadIntent | null = null;
  let receipt: UploadReceipt | null = null;
  const store: UploadStore = {
    claim: vi.fn<UploadStore["claim"]>(async (value) => {
      if (stored !== null) {
        return false;
      }
      stored = structuredClone(value);
      return true;
    }),
    complete: vi.fn<UploadStore["complete"]>(async (value) => {
      receipt = structuredClone(value);
    }),
    read: vi.fn<UploadStore["read"]>(async () => {
      if (stored === null) {
        throw new Error("missing intent");
      }
      return structuredClone(stored);
    }),
    receipt: vi.fn<UploadStore["receipt"]>(async () => receipt),
  };
  const provider = {
    active: vi
      .fn<() => Promise<ActiveDeployment>>()
      .mockResolvedValue(intent.baseline),
    findUpload: vi
      .fn<() => Promise<string | null>>()
      .mockResolvedValue(versionId),
    uploadArtifact: vi
      .fn<() => Promise<{ artifactDigest: string; versionId: string }>>()
      .mockResolvedValue({
        artifactDigest: intent.artifactDigest,
        versionId,
      }),
    verifyArtifact: vi.fn<() => Promise<void>>().mockResolvedValue(),
    verifyBindingInheritance: vi.fn<() => Promise<void>>().mockResolvedValue(),
  };
  const manifest: ReleaseArtifact = {
    archive: null,
    artifact: {
      assetRouting: {
        html_handling: "auto-trailing-slash",
        not_found_handling: "none",
        run_worker_first: false,
      },
      assets: [],
      buildId: "proof",
      compatibilityDate: "2026-08-04",
      compatibilityFlags: ["nodejs_compat"],
      mainModule: "index.js",
      modules: [],
      schemaVersion: 1,
      sourceSha: "a".repeat(40),
    },
    digest: intent.artifactDigest,
  };
  const artifacts = {
    read: vi.fn<() => Promise<ReleaseArtifact>>().mockResolvedValue(manifest),
  };
  const archive = {
    verify: vi.fn<() => Promise<void>>().mockResolvedValue(),
  };
  const uploader = new ReleaseUpload(store, artifacts, archive, provider);
  return { archive, artifacts, intent, provider, store, uploader, versionId };
};
/* oxlint-enable require-await */

describe("durable inactive uploads", () => {
  it("claims before upload and completes only after verifying provider bytes", async () => {
    const { intent, provider, store, uploader, versionId } = setup();
    await expect(uploader.upload(intent, "build")).resolves.toStrictEqual({
      intent,
      versionId,
    });
    expect(vi.mocked(store.claim).mock.invocationCallOrder[0]).toBeLessThan(
      provider.uploadArtifact.mock.invocationCallOrder[0]
    );
    expect(provider.verifyArtifact.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(store.complete).mock.invocationCallOrder[0]
    );
    await uploader.upload(intent, "build");
    expect(provider.uploadArtifact).toHaveBeenCalledOnce();
  });

  it("recovers an accepted upload after losing the response without uploading twice", async () => {
    const { intent, provider, uploader, versionId } = setup();
    provider.uploadArtifact.mockRejectedValueOnce(new Error("lost response"));
    await expect(uploader.upload(intent, "build")).rejects.toThrow(
      "lost response"
    );
    await expect(uploader.reconcile(intent.id)).resolves.toStrictEqual({
      intent,
      versionId,
    });
    await uploader.upload(intent, "build");
    expect(provider.uploadArtifact).toHaveBeenCalledOnce();
  });

  it("never reissues an upload if the claiming runner died before contacting the provider", async () => {
    const { intent, provider, store, uploader } = setup();
    await store.claim(intent);
    provider.findUpload.mockResolvedValue(null);
    await expect(uploader.upload(intent, "build")).rejects.toThrow(
      "outcome remains unknown"
    );
    expect(provider.uploadArtifact).not.toHaveBeenCalled();
    expect(store.complete).not.toHaveBeenCalled();
  });

  it("rejects reusing an upload identity for a different artifact", async () => {
    const { intent, provider, store, uploader } = setup();
    await store.claim({ ...intent, artifactDigest: "b".repeat(64) });
    await expect(uploader.upload(intent, "build")).rejects.toThrow(
      "another intent"
    );
    expect(provider.uploadArtifact).not.toHaveBeenCalled();
  });

  it("does not complete when uploaded bytes differ or the active pointer moves", async () => {
    const { intent, provider, store, uploader } = setup();
    await store.claim(intent);
    provider.verifyArtifact.mockRejectedValueOnce(new Error("bytes differ"));
    await expect(uploader.reconcile(intent.id)).rejects.toThrow("bytes differ");
    provider.active.mockResolvedValueOnce({
      id: randomUUID(),
      versionId: randomUUID(),
    });
    await expect(uploader.reconcile(intent.id)).rejects.toThrow(
      "Active deployment changed"
    );
    expect(store.complete).not.toHaveBeenCalled();
  });

  it("does not contact the provider after an uncertain journal claim", async () => {
    const { intent, provider, store, uploader } = setup();
    vi.mocked(store.claim).mockRejectedValueOnce(
      new Error("uncertain journal write")
    );
    await expect(uploader.upload(intent, "build")).rejects.toThrow(
      "uncertain journal write"
    );
    expect(provider.uploadArtifact).not.toHaveBeenCalled();
  });

  it("refuses to certify a lost-response upload whose namespace differs", async () => {
    const { intent, provider, store, uploader } = setup();
    await store.claim(intent);
    provider.verifyBindingInheritance.mockRejectedValueOnce(
      new Error("namespace differs")
    );
    await expect(uploader.reconcile(intent.id)).rejects.toThrow(
      "namespace differs"
    );
    expect(store.complete).not.toHaveBeenCalled();
    expect(provider.uploadArtifact).not.toHaveBeenCalled();
  });
});

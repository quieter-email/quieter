import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

export const createQuieterTanStackStart = (sitePath: string) => {
  class QuieterTanStackStart extends sst.cloudflare.TanStackStart {
    // eslint-disable-next-line class-methods-use-this -- overrides an SST instance hook
    protected override buildPlan(outputPath: $util.Output<string>) {
      return outputPath.apply(async (directory) => {
        const workerDirectory = ".cloudflare/output/v0/workers/default";
        const config = z
          .object({ manifest: z.object({ mainModule: z.string().min(1) }) })
          .parse(
            JSON.parse(
              await readFile(
                path.join(directory, workerDirectory, "worker.config.json"),
                "utf-8"
              )
            )
          );
        const bundleDirectory = path.resolve(
          directory,
          workerDirectory,
          "bundle"
        );
        const serverPath = path.resolve(
          bundleDirectory,
          config.manifest.mainModule
        );
        const relativePath = path.relative(bundleDirectory, serverPath);
        if (
          relativePath === ".." ||
          relativePath.startsWith(`..${path.sep}`) ||
          path.isAbsolute(relativePath)
        ) {
          throw new Error(
            "The Cloudflare Worker entry must be inside its bundle."
          );
        }
        const assets = `${workerDirectory}/assets`;
        const [serverStats, assetStats] = await Promise.all([
          stat(serverPath),
          stat(path.join(directory, assets)),
        ]);
        if (!serverStats.isFile() || !assetStats.isDirectory()) {
          throw new Error("The Cloudflare web build is incomplete.");
        }
        return {
          assets,
          server: path.relative(directory, serverPath).replaceAll("\\", "/"),
        };
      });
    }

    // eslint-disable-next-line class-methods-use-this -- overrides an SST instance hook
    protected override buildWrangler() {
      return {
        main: path.resolve(sitePath, "src/server.ts"),
      };
    }
  }

  return QuieterTanStackStart;
};

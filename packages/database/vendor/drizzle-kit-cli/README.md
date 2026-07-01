# Drizzle Kit CLI SDK vendor bundle

Published `drizzle-kit@1.0.0-rc.4` npm tarballs omit the `drizzle-kit/cli` programmatic API bundle even though the tag's `package.json` declares it. Database scripts import `check`, `generate`, and `push` from that entrypoint.

`packages/database/scripts/ensure-drizzle-kit-cli.ts` decompresses `cli.mjs.gz` into `node_modules/drizzle-kit/` and adds the `./cli` export on `postinstall`.

**When upgrading `drizzle-kit`:** read the "Upgrading `drizzle-kit` / `drizzle-orm`" bullet in the repo root `AGENTS.md` Schema section. If the new npm package includes `drizzle-kit/cli` natively, remove this vendor directory and the ensure/postinstall workaround.

To rebuild this bundle from the Drizzle source tag (only if the workaround is still needed):

1. Clone `drizzle-team/drizzle-orm` at the target tag and run `pnpm install` + `pnpm run build` in `drizzle-kit/`.
2. Copy `dist/cli.mjs` and `dist/cli.d.mts` here; gzip `cli.mjs` as `cli.mjs.gz` and delete the uncompressed copy.

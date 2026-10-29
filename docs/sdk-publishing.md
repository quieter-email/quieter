# SDK publishing

Publish a release tagged `sdk-v<version>` from a commit incorporated into main. The tagged commit must contain `sdk-release-request.yml`. That workflow requests publication without checking out code or receiving publishing authority.

The request's completion starts `sdk-publish.yml` from the default branch. It checks the request's repository, workflow path, release event, successful result, tag name, and commit ancestry before starting the publishing job. The publishing job checks out that exact commit, validates the package version, runs checks and tests, and publishes with provenance. Artifacts from the request are never used.

For manual publication, dispatch Publish SDK on main with the package version. Other dispatch refs are rejected. Historical tags without the request workflow do not automatically publish through this path.

## Required external protections

Restrict the `npm-publish` environment to the `main` branch, with no tag rules. The default-branch relay allows this restriction while retaining automatic tagged releases. Keep main protected and require reviewed changes to its workflows. The npm trusted publisher must require this repository, `sdk-publish.yml`, and `npm-publish` environment. A publisher that accepts workflows without that environment can bypass the environment's branch restriction.

Keep the Production environment restricted to protected branches for the managed mail backfill, or narrow it to main. Retain the AWS trust restriction to the intended production deployment identity. Source guards cannot prevent a writer from editing a workflow on another branch; these external controls are part of the security boundary.

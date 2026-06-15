# Contribution Policy

Quieter is source-available under the MIT license, but it is not currently accepting general
community contributions.

Please do not open pull requests or issues for:

- features
- refactors
- dependency updates
- styling changes
- general bug reports
- setup or support questions

These may be closed without review.

## Security Contributions

Security research and fixes are welcome when coordinated privately.

1. Submit a private report through
   [GitHub private vulnerability reporting](https://github.com/quieter-email/quieter/security/advisories/new).
2. Include reproduction steps, affected code, impact, and suggested mitigation when available.
3. Do not open a public issue or pull request before the report is triaged.
4. A maintainer may invite a narrowly scoped security pull request after agreeing on the fix.

Security changes must follow existing package boundaries, include focused tests, and pass:

```bash
bun run fmt
bun run lint:fix
bun run typecheck
bun run test
```

Submitting a report or patch does not guarantee acceptance, response time, compensation, or public
credit.

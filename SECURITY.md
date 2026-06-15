# Security Policy

## Supported Versions

Quieter is deep-alpha software and has no supported production release. Security reports should
target the current `main` branch.

## Reporting a Vulnerability

Use
[GitHub private vulnerability reporting](https://github.com/quieter-email/quieter/security/advisories/new).

Do not disclose vulnerabilities through public issues, discussions, pull requests, social media, or
public proof-of-concept repositories.

Include:

- affected component and commit
- reproduction steps or proof of concept
- expected and observed behavior
- security impact
- required privileges and attack conditions
- suggested mitigation, when known

## Scope

Useful reports include vulnerabilities involving:

- authentication or authorization bypass
- cross-mailbox or cross-organization access
- Gmail OAuth credentials or token handling
- managed mailbox grants and message access
- organization API keys and outbound mail authorization
- injection, request forgery, or unsafe content rendering
- secret exposure
- billing or entitlement bypass
- destructive database or deployment behavior

Operational hardening suggestions without a demonstrated security impact may not receive a response.

## Testing Rules

- Test only accounts and infrastructure you own or are authorized to use.
- Do not access other users' mail or data.
- Do not send unsolicited email.
- Do not degrade service, exhaust quotas, or destroy data.
- Stop testing when sensitive data is exposed.

There is no bug bounty program or guaranteed response timeline.

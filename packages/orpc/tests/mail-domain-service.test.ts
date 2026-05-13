import { describe, expect, test } from "bun:test";
import {
  aggregateMailDomainStatus,
  checkMailDomainDnsRecords,
  createMailDomainDnsRecords,
  normalizeMailDomain,
} from "../src/mail-domain";

describe("normalizeMailDomain", () => {
  test("normalizes domains from plain domains and URLs", () => {
    expect(normalizeMailDomain(" Example.COM. ")).toBe("example.com");
    expect(normalizeMailDomain("https://mail.Example.com/settings")).toBe("mail.example.com");
  });

  test("rejects invalid domains", () => {
    expect(() => normalizeMailDomain("localhost")).toThrow();
    expect(() => normalizeMailDomain("-example.com")).toThrow();
    expect(() => normalizeMailDomain("example.invalid-")).toThrow();
  });
});

describe("createMailDomainDnsRecords", () => {
  test("creates SES, inbound, and DMARC records", () => {
    const records = createMailDomainDnsRecords({
      dkimTokens: ["one", "two", "three"],
      domain: "example.com",
      ownershipToken: "team-token",
      region: "eu-central-1",
    });

    expect(records).toEqual([
      {
        name: "_quieter-verify.example.com",
        purpose: "ownership",
        required: true,
        type: "TXT",
        value: "quieter-domain-verification=team-token",
      },
      {
        name: "one._domainkey.example.com",
        purpose: "dkim",
        required: true,
        type: "CNAME",
        value: "one.dkim.amazonses.com",
      },
      {
        name: "two._domainkey.example.com",
        purpose: "dkim",
        required: true,
        type: "CNAME",
        value: "two.dkim.amazonses.com",
      },
      {
        name: "three._domainkey.example.com",
        purpose: "dkim",
        required: true,
        type: "CNAME",
        value: "three.dkim.amazonses.com",
      },
      {
        name: "bounce.example.com",
        priority: 10,
        purpose: "mail_from_mx",
        required: true,
        type: "MX",
        value: "feedback-smtp.eu-central-1.amazonses.com",
      },
      {
        name: "bounce.example.com",
        purpose: "mail_from_spf",
        required: true,
        type: "TXT",
        value: "v=spf1 include:amazonses.com -all",
      },
      {
        name: "example.com",
        priority: 10,
        purpose: "inbound_mx",
        required: true,
        type: "MX",
        value: "inbound-smtp.eu-central-1.amazonaws.com",
      },
      {
        name: "_dmarc.example.com",
        purpose: "dmarc",
        required: true,
        type: "TXT",
        value: "v=DMARC1; p=none",
      },
    ]);
  });
});

describe("checkMailDomainDnsRecords", () => {
  test("checks records against mocked DNS responses", async () => {
    const records = createMailDomainDnsRecords({
      dkimTokens: ["one"],
      domain: "example.com",
      ownershipToken: "team-token",
      region: "eu-central-1",
    });
    const checks = await checkMailDomainDnsRecords(
      {
        resolveCname: async () => ["one.dkim.amazonses.com."],
        resolveMx: async (name) =>
          name === "example.com"
            ? [{ exchange: "inbound-smtp.eu-central-1.amazonaws.com.", priority: 10 }]
            : [{ exchange: "feedback-smtp.eu-central-1.amazonses.com.", priority: 10 }],
        resolveTxt: async (name) =>
          name === "_dmarc.example.com"
            ? [["v=DMARC1; p=none; rua=mailto:dmarc@example.com"]]
            : name === "_quieter-verify.example.com"
              ? [["quieter-domain-verification=team-token"]]
              : [["v=spf1 include:amazonses.com -all"]],
      },
      records,
    );

    expect(checks.every((check) => check.ok)).toBe(true);
    expect(aggregateMailDomainStatus(checks)).toBe("verified");
  });

  test("marks missing DNS as failed", async () => {
    const records = createMailDomainDnsRecords({
      dkimTokens: ["one"],
      domain: "example.com",
      ownershipToken: "team-token",
      region: "eu-central-1",
    });
    const checks = await checkMailDomainDnsRecords(
      {
        resolveCname: async () => [],
        resolveMx: async () => [],
        resolveTxt: async () => [],
      },
      records,
    );

    expect(checks.every((check) => check.ok)).toBe(false);
    expect(aggregateMailDomainStatus(checks)).toBe("failed");
  });
});

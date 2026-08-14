import { describe, expect, test } from "vite-plus/test";

import {
  aggregateMailDomainStatus,
  createMailDomainDnsRecords,
  normalizeMailDomain,
} from "../src/mail-domain/records";
import { checkMailDomainDnsRecords } from "../src/mail-domain/service";

const resolveOwnershipTxt = () => [["quieter-domain-verification=org-token"]];
const resolveSpfTxt = () => [["v=spf1 include:amazonses.com ~all"]];
const resolveDmarcTxt = () => [
  ["v=DMARC1; p=reject; rua=mailto:dmarc@example.com"],
];

const resolveMailDomainTxt = (name: string, includeDmarc: boolean) => {
  if (name === "_dmarc.example.com") {
    return includeDmarc ? resolveDmarcTxt() : [];
  }

  if (name === "_quieter-verify.example.com") {
    return resolveOwnershipTxt();
  }

  return resolveSpfTxt();
};

describe(normalizeMailDomain, () => {
  test("normalizes domains from plain domains and URLs", () => {
    expect(normalizeMailDomain(" Example.COM. ")).toBe("example.com");
    expect(normalizeMailDomain("https://mail.Example.com/settings")).toBe(
      "mail.example.com"
    );
  });

  test("rejects invalid domains", () => {
    expect(() => normalizeMailDomain("localhost")).toThrow(
      "Enter a valid domain."
    );
    expect(() => normalizeMailDomain("-example.com")).toThrow(
      "Enter a valid domain."
    );
    expect(() => normalizeMailDomain("example.invalid-")).toThrow(
      "Enter a valid domain."
    );
  });
});

describe(createMailDomainDnsRecords, () => {
  test("creates SES, inbound, and recommended DMARC records", () => {
    const records = createMailDomainDnsRecords({
      dkimTokens: ["one", "two", "three"],
      domain: "example.com",
      mode: "send_and_receive",
      ownershipToken: "org-token",
      region: "eu-central-1",
    });

    expect(records).toStrictEqual([
      {
        name: "_quieter-verify.example.com",
        purpose: "ownership",
        required: true,
        type: "TXT",
        value: "quieter-domain-verification=org-token",
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
        required: false,
        type: "TXT",
        value: "v=DMARC1; p=quarantine",
      },
    ]);
  });
});

describe(checkMailDomainDnsRecords, () => {
  test("accepts any valid DMARC policy and verifies without DMARC", async () => {
    const records = createMailDomainDnsRecords({
      dkimTokens: ["one"],
      domain: "example.com",
      mode: "send_and_receive",
      ownershipToken: "org-token",
      region: "eu-central-1",
    });
    const dns = {
      resolveCname: async () => {
        await Promise.resolve();
        return ["one.dkim.amazonses.com."];
      },
      resolveMx: async (name: string) => {
        await Promise.resolve();
        return name === "example.com"
          ? [
              {
                exchange: "inbound-smtp.eu-central-1.amazonaws.com.",
                priority: 10,
              },
            ]
          : [
              {
                exchange: "feedback-smtp.eu-central-1.amazonses.com.",
                priority: 10,
              },
            ];
      },
      resolveTxt: async (name: string) => {
        await Promise.resolve();
        return resolveMailDomainTxt(name, true);
      },
    };

    const withDmarc = await checkMailDomainDnsRecords(dns, records);
    expect(withDmarc.every((check) => check.ok)).toBeTruthy();
    expect(aggregateMailDomainStatus(withDmarc)).toBe("verified");

    const withoutDmarc = await checkMailDomainDnsRecords(
      {
        ...dns,
        resolveTxt: async (name: string) => {
          await Promise.resolve();
          return resolveMailDomainTxt(name, false);
        },
      },
      records
    );
    expect(
      withoutDmarc.find((check) => check.purpose === "dmarc")?.ok
    ).toBeFalsy();
    expect(aggregateMailDomainStatus(withoutDmarc)).toBe("verified");
  });

  test("ignores provider sending lag when required DNS checks pass", () => {
    expect(
      aggregateMailDomainStatus([
        {
          message: "Sending identity is not verified yet.",
          ok: false,
          purpose: "ses_identity",
        },
        {
          message: "Custom MAIL FROM is not verified yet.",
          ok: false,
          purpose: "ses_mail_from",
        },
        {
          message: "Incoming mail routing could not be configured.",
          ok: false,
          purpose: "receipt_rule",
        },
        {
          message: "Ownership TXT record is present.",
          ok: true,
          purpose: "ownership",
          recordName: "_quieter-verify.example.com",
        },
      ])
    ).toBe("verified");
  });

  test("marks missing required DNS as failed", async () => {
    const records = createMailDomainDnsRecords({
      dkimTokens: ["one"],
      domain: "example.com",
      mode: "send_and_receive",
      ownershipToken: "org-token",
      region: "eu-central-1",
    });
    const checks = await checkMailDomainDnsRecords(
      {
        resolveCname: async () => {
          await Promise.resolve();
          return [];
        },
        resolveMx: async () => {
          await Promise.resolve();
          return [];
        },
        resolveTxt: async () => {
          await Promise.resolve();
          return [];
        },
      },
      records
    );

    expect(checks.every((check) => check.ok)).toBeFalsy();
    expect(aggregateMailDomainStatus(checks)).toBe("failed");
  });
});

describe("send-only domains", () => {
  test("omit incoming mail routing", () => {
    const records = createMailDomainDnsRecords({
      dkimTokens: ["one", "two", "three"],
      domain: "example.com",
      mode: "send_only",
      ownershipToken: "org-token",
      region: "eu-central-1",
    });

    expect(
      records.some((record) => record.purpose === "inbound_mx")
    ).toBeFalsy();
    expect(records).toHaveLength(7);
  });
});

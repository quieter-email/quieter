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
  test("rejects invalid domains", () => {
    expect(() => normalizeMailDomain("localhost")).toThrow(/valid domain/u);
    expect(() => normalizeMailDomain("-example.com")).toThrow(/valid domain/u);
    expect(() => normalizeMailDomain("example.invalid-")).toThrow(
      /valid domain/u
    );
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

import { describe, expect, test } from "vite-plus/test";

import {
  buildDomainConnectApplyUrl,
  discoverDomainConnect,
} from "../src/mail-domain/domain-connect";
import { createMailDomainDnsRecords } from "../src/mail-domain/records";

const resolveFetcherUrl = (request: RequestInfo | URL) => {
  if (typeof request === "string") {
    return request;
  }

  if (request instanceof URL) {
    return request.href;
  }

  return request.url;
};

describe(discoverDomainConnect, () => {
  test("offers a trusted provider only after it confirms the exact template", async () => {
    const requestedUrls: string[] = [];
    const result = await discoverDomainConnect({
      configured: true,
      domain: "example.com",
      fetcher: async (request) => {
        const url = resolveFetcherUrl(request);
        requestedUrls.push(url);
        if (url.endsWith("/v2/example.com/settings")) {
          return await Promise.resolve(
            Response.json({
              providerDisplayName: "Cloudflare",
              providerId: "cloudflare.com",
              providerName: "cloudflare",
              urlAPI: "https://api.cloudflare.com/client/v4/dns/domainconnect",
              urlSyncUX: "https://dash.cloudflare.com/domainconnect",
            })
          );
        }
        return await Promise.resolve(Response.json({ version: 1 }));
      },
      lookupTxt: async () =>
        await Promise.resolve([
          ["api.cloudflare.com/client/v4/dns/domainconnect"],
        ]),
      mode: "send_only",
    });

    expect(result).toMatchObject({
      available: true,
      provider: { displayName: "Cloudflare", id: "cloudflare.com" },
      serviceId: "send-only",
      templateVersion: 1,
    });
    expect(requestedUrls[1]).toContain(
      "/v2/domainTemplates/providers/quieter.email/services/send-only"
    );
  });

  test("does not fetch untrusted discovery endpoints", async () => {
    let fetched = false;
    const result = await discoverDomainConnect({
      configured: true,
      domain: "example.com",
      fetcher: async () => {
        fetched = true;
        return await Promise.resolve(new Response());
      },
      lookupTxt: async () => await Promise.resolve([["localhost:3000"]]),
      mode: "send_only",
    });

    expect(result).toMatchObject({
      available: false,
      reason: "provider_not_supported",
    });
    expect(fetched).toBeFalsy();
  });
});

describe("Domain Connect apply URLs", () => {
  test("signs the exact apply query and leaves the signature last", async () => {
    const keyPair = await crypto.subtle.generateKey(
      {
        hash: "SHA-256",
        modulusLength: 2048,
        name: "RSASSA-PKCS1-v1_5",
        publicExponent: new Uint8Array([1, 0, 1]),
      },
      true,
      ["sign", "verify"]
    );
    const privateKeyBase64 = btoa(
      String.fromCodePoint(
        ...new Uint8Array(
          await crypto.subtle.exportKey("pkcs8", keyPair.privateKey)
        )
      )
    );
    const privateKey = `-----BEGIN PRIVATE KEY-----\n${privateKeyBase64.match(/.{1,64}/gu)?.join("\n")}\n-----END PRIVATE KEY-----`;
    const records = createMailDomainDnsRecords({
      dkimTokens: ["one", "two", "three"],
      domain: "example.com",
      mode: "send_only",
      ownershipToken: "org-token",
      region: "eu-central-1",
    });
    const applyUrl = new URL(
      buildDomainConnectApplyUrl({
        callbackUrl:
          "https://quieter.email/api/domain-connect/callback?state=state-token",
        domain: "example.com",
        mode: "send_only",
        privateKey,
        provider: {
          apiUrl: "https://api.cloudflare.com/client/v4/dns/domainconnect",
          controlPanelUrl: null,
          displayName: "Cloudflare",
          id: "cloudflare.com",
          syncUrl: "https://dash.cloudflare.com/domainconnect",
          templateVersion: 1,
        },
        records,
        state: "state-token",
      })
    );
    const entries = [...applyUrl.searchParams];
    expect(entries.at(-1)?.[0]).toBe("sig");
    expect({
      awsRegion: applyUrl.searchParams.get("AWS_REGION"),
      dkimSelector: applyUrl.searchParams.get("DKIM1_SELECTOR"),
      ownershipToken: applyUrl.searchParams.get("OWNERSHIP_TOKEN"),
      redirectUri: applyUrl.searchParams.get("redirect_uri"),
    }).toStrictEqual({
      awsRegion: "eu-central-1",
      dkimSelector: "one",
      ownershipToken: "org-token",
      redirectUri:
        "https://quieter.email/api/domain-connect/callback?state=state-token",
    });
    const signature = applyUrl.searchParams.get("sig");
    applyUrl.searchParams.delete("key");
    applyUrl.searchParams.delete("sig");

    await expect(
      crypto.subtle.verify(
        "RSASSA-PKCS1-v1_5",
        keyPair.publicKey,
        Uint8Array.from(
          atob(signature ?? ""),
          (character) => character.codePointAt(0) ?? 0
        ),
        new TextEncoder().encode(applyUrl.searchParams.toString())
      )
    ).resolves.toBeTruthy();
  });
});

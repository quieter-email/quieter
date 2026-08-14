import { describe, expect, test } from "vite-plus/test";

import { createBimiResolver, sanitizeBimiSvg } from "../src/bimi";
import { getSenderAvatarUrls } from "../src/sender-avatar";

const VALID_SVG = (label: string) => `
  <svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny-ps" viewBox="0 0 128 128">
    <title>${label}</title>
    <path fill="#123456" d="M0 0h128v128H0z"/>
  </svg>
`;

const getRequestUrl = (input: RequestInfo | URL): string => {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
};

const txtAnswer = (value: string, ttl = 60) =>
  Response.json({
    Answer: [
      {
        TTL: ttl,
        data: JSON.stringify(value),
        type: 16,
      },
    ],
  });

const authHeaders = (domain: string) => [
  {
    name: "Authentication-Results",
    value: `mx.example; dmarc=pass header.from=${domain}`,
  },
];

describe(sanitizeBimiSvg, () => {
  test("rebuilds a supported SVG without declarations or active content", () => {
    const sanitized = sanitizeBimiSvg(`<?xml version="1.0"?>
      <svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny-ps" viewBox="0 0 128 128">
        <title>Example</title>
        <defs><linearGradient id="brand"><stop offset="0" stop-color="#123456"/></linearGradient></defs>
        <g fill="url(#brand)"><path d="M0 0h128v128H0z"/></g>
      </svg>
    `);

    expect(sanitized).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(sanitized).toContain("<title>Example</title>");
    expect(sanitized).toContain('fill="url(#brand)"');
    expect(sanitized).not.toContain("<?xml");
  });

  test("rejects scripts, external references, missing titles, and unsafe dimensions", () => {
    const cases = [
      VALID_SVG("<script>alert(1)</script>"),
      VALID_SVG("Example").replace(
        '<path fill="#123456"',
        '<path fill="url(https://evil.example/logo.svg)"'
      ),
      VALID_SVG("Example").replace("<title>Example</title>", ""),
      VALID_SVG("Example").replace(
        'viewBox="0 0 128 128"',
        'width="999999" height="1"'
      ),
    ];

    expect(cases.map((value) => sanitizeBimiSvg(value))).toStrictEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });
});

describe(createBimiResolver, () => {
  test("requires aligned DMARC authentication evidence and an enforced policy", async () => {
    const calls: string[] = [];
    const resolver = createBimiResolver({
      assetHostnames: ["assets.authenticated.example"],
      fetch: async (input) => {
        const url = new URL(getRequestUrl(input));
        calls.push(url.href);
        if (url.searchParams.get("type") === "TXT") {
          const name = url.searchParams.get("name");
          if (name === "default._bimi.authenticated.example") {
            return await Promise.resolve(
              txtAnswer(
                "v=BIMI1; l=https://assets.authenticated.example/logo.svg"
              )
            );
          }
          if (name === "_dmarc.authenticated.example") {
            return await Promise.resolve(
              txtAnswer("v=DMARC1; p=reject; pct=100")
            );
          }
        }
        if (url.href === "https://assets.authenticated.example/logo.svg") {
          return await Promise.resolve(
            new Response(VALID_SVG("Authenticated"), {
              headers: {
                "cache-control": "max-age=60",
                "content-type": "image/svg+xml",
              },
            })
          );
        }
        return await Promise.resolve(new Response(null, { status: 404 }));
      },
    });

    await expect(
      resolver.resolve({
        domain: "authenticated.example",
        headers: authHeaders("authenticated.example"),
      })
    ).resolves.toMatch(/^data:image\/svg\+xml,/u);

    const callsWithoutAuthentication = calls.length;
    await expect(
      resolver.resolve({
        domain: "unauthenticated.example",
        headers: [],
      })
    ).resolves.toBeUndefined();
    expect(calls).toHaveLength(callsWithoutAuthentication);

    const noEnforcementResolver = createBimiResolver({
      fetch: async (input) => {
        const url = new URL(getRequestUrl(input));
        if (url.searchParams.get("type") === "TXT") {
          if (url.searchParams.get("name") === "default._bimi.none.example") {
            return await Promise.resolve(
              txtAnswer("v=BIMI1; l=https://assets.none.example/logo.svg")
            );
          }
          if (url.searchParams.get("name") === "_dmarc.none.example") {
            return await Promise.resolve(txtAnswer("v=DMARC1; p=none"));
          }
        }
        return await Promise.resolve(new Response(null, { status: 404 }));
      },
    });

    await expect(
      noEnforcementResolver.resolve({
        domain: "none.example",
        headers: authHeaders("none.example"),
      })
    ).resolves.toBeUndefined();
  });

  test("does not fetch a BIMI asset from an untrusted hostname", async () => {
    const assetRequests: string[] = [];
    const resolver = createBimiResolver({
      assetHostnames: ["assets.brand.example"],
      fetch: async (input) => {
        const url = new URL(getRequestUrl(input));
        if (url.searchParams.get("type") === "TXT") {
          const name = url.searchParams.get("name");
          if (name === "default._bimi.brand.example") {
            return await Promise.resolve(
              txtAnswer("v=BIMI1; l=https://private.example.net/logo.svg")
            );
          }
          if (name === "_dmarc.brand.example") {
            return await Promise.resolve(txtAnswer("v=DMARC1; p=reject"));
          }
        }
        assetRequests.push(url.href);
        return await Promise.resolve(new Response(null, { status: 404 }));
      },
    });

    await expect(
      resolver.resolve({
        domain: "brand.example",
        headers: authHeaders("brand.example"),
      })
    ).resolves.toBeUndefined();
    expect(assetRequests).toStrictEqual([]);
  });

  test("uses the organizational-domain record and refreshes expired DNS and asset caches", async () => {
    let now = 0;
    let label = "First";
    let assetRequests = 0;
    const resolver = createBimiResolver({
      assetHostnames: ["assets.example.org"],
      fetch: async (input) => {
        const url = new URL(getRequestUrl(input));
        if (url.searchParams.get("type") === "TXT") {
          const name = url.searchParams.get("name");
          if (name === "default._bimi.example.org") {
            return await Promise.resolve(
              txtAnswer("v=BIMI1; l=https://assets.example.org/logo.svg")
            );
          }
          if (name === "_dmarc.example.org") {
            return await Promise.resolve(
              txtAnswer("v=DMARC1; p=quarantine", 60)
            );
          }
        }
        if (url.href === "https://assets.example.org/logo.svg") {
          assetRequests += 1;
          return await Promise.resolve(
            new Response(VALID_SVG(label), {
              headers: {
                "cache-control": "max-age=60",
                "content-type": "image/svg+xml",
              },
            })
          );
        }
        return await Promise.resolve(new Response(null, { status: 404 }));
      },
      now: () => now,
    });

    const input = {
      domain: "billing.example.org",
      headers: authHeaders("billing.example.org"),
    };
    const first = await resolver.resolve(input);
    const second = await resolver.resolve(input);
    expect(first).toBe(second);
    expect(assetRequests).toBe(1);

    label = "Second";
    now = 60_001;
    const refreshed = await resolver.resolve(input);
    expect(refreshed).not.toBe(first);
    expect(
      decodeURIComponent(refreshed?.slice("data:image/svg+xml,".length) ?? "")
    ).toContain("Second");
    expect(assetRequests).toBe(2);
  });
});

describe(getSenderAvatarUrls, () => {
  test("does not fetch an untrusted BIMI asset", async () => {
    const originalFetch = globalThis.fetch;
    const assetRequests: string[] = [];
    globalThis.fetch = async (input) => {
      const url = new URL(getRequestUrl(input));
      if (url.searchParams.get("type") === "TXT") {
        if (
          url.searchParams.get("name") === "default._bimi.integration.example"
        ) {
          return await Promise.resolve(
            txtAnswer(
              "v=BIMI1; l=https://assets.integration.example/integration.svg"
            )
          );
        }
        if (url.searchParams.get("name") === "_dmarc.integration.example") {
          return await Promise.resolve(txtAnswer("v=DMARC1; p=reject"));
        }
      }
      if (url.href === "https://assets.integration.example/integration.svg") {
        assetRequests.push(url.href);
        return await Promise.resolve(
          new Response(VALID_SVG("Integration"), {
            headers: { "content-type": "image/svg+xml" },
          })
        );
      }
      return await Promise.resolve(new Response(null, { status: 404 }));
    };

    try {
      const result = await getSenderAvatarUrls(
        "Brand <sender@integration.example>",
        {
          headers: authHeaders("integration.example"),
        }
      );
      expect(result).toBeUndefined();
      expect(assetRequests).toStrictEqual([]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

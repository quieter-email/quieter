import type { MailDomainDnsRecord, MailDomainMode } from "@quieter/database/schema";
import { ORPCError } from "@orpc/server";
import { createSign } from "node:crypto";
import { resolveTxt } from "node:dns/promises";
import { z } from "zod";

export const DOMAIN_CONNECT_PROVIDER_ID = "quieter.email";
export const DOMAIN_CONNECT_PUBLIC_KEY_NAME = "_dck1";
export const DOMAIN_CONNECT_STATE_TTL_MS = 10 * 60 * 1000;

const domainConnectServices = {
  send_and_receive: {
    id: "send-and-receive",
    name: "Send and receive mail with Quieter",
    version: 1,
  },
  send_only: {
    id: "send-only",
    name: "Send mail with Quieter",
    version: 1,
  },
} as const satisfies Record<MailDomainMode, { id: string; name: string; version: number }>;

export const domainConnectModes = Object.keys(domainConnectServices) as Array<
  keyof typeof domainConnectServices
>;

const trustedProviderEndpoints = [
  {
    discovery: ["https://api.cloudflare.com/client/v4/dns/domainconnect"],
    providerIds: ["cloudflare.com"],
    urlApi: ["https://api.cloudflare.com/client/v4/dns/domainconnect"],
    urlSyncUx: ["https://dash.cloudflare.com/domainconnect"],
  },
  {
    discovery: ["https://domainconnect.godaddy.com"],
    providerIds: ["godaddy.com"],
    urlApi: ["https://api.domainconnect.godaddy.com"],
    urlSyncUx: ["https://domainconnect.godaddy.com"],
  },
] as const;

const providerSettingsSchema = z.object({
  providerDisplayName: z.string().trim().min(1).optional(),
  providerId: z.string().trim().min(1),
  providerName: z.string().trim().min(1),
  urlAPI: z.url(),
  urlControlPanel: z.url().optional(),
  urlSyncUX: z.url().optional(),
});

type DomainConnectProvider = {
  apiUrl: string;
  controlPanelUrl: string | null;
  displayName: string;
  id: string;
  syncUrl: string;
  templateVersion: number | null;
};

type DomainConnectFetch = (input: Request | string | URL, init?: RequestInit) => Promise<Response>;

export type DomainConnectDiscovery =
  | {
      available: false;
      controlPanelUrl: string | null;
      providerName: string | null;
      reason: "not_configured" | "provider_not_supported" | "template_not_supported";
    }
  | {
      available: true;
      provider: DomainConnectProvider;
      serviceId: string;
      templateVersion: number;
    };

type DomainConnectTemplateRecord =
  | {
      data: string;
      essential?: "OnApply";
      host: string;
      ttl: number;
      txtConflictMatchingMode: "Prefix";
      txtConflictMatchingPrefix: string;
      type: "TXT";
    }
  | {
      host: string;
      spfRules: string;
      type: "SPFM";
    }
  | {
      host: string;
      pointsTo: string;
      ttl: number;
      type: "CNAME";
    }
  | {
      host: string;
      pointsTo: string;
      priority: number;
      ttl: number;
      type: "MX";
    };

const sharedTemplateRecords = [
  {
    data: "quieter-domain-verification=%OWNERSHIP_TOKEN%",
    host: "_quieter-verify",
    ttl: 300,
    txtConflictMatchingMode: "Prefix",
    txtConflictMatchingPrefix: "quieter-domain-verification=",
    type: "TXT",
  },
  {
    host: "%DKIM1_SELECTOR%._domainkey",
    pointsTo: "%DKIM1_TOKEN%.dkim.amazonses.com",
    ttl: 300,
    type: "CNAME",
  },
  {
    host: "%DKIM2_SELECTOR%._domainkey",
    pointsTo: "%DKIM2_TOKEN%.dkim.amazonses.com",
    ttl: 300,
    type: "CNAME",
  },
  {
    host: "%DKIM3_SELECTOR%._domainkey",
    pointsTo: "%DKIM3_TOKEN%.dkim.amazonses.com",
    ttl: 300,
    type: "CNAME",
  },
  {
    host: "bounce",
    pointsTo: "feedback-smtp.%AWS_REGION%.amazonses.com",
    priority: 10,
    ttl: 300,
    type: "MX",
  },
  {
    host: "bounce",
    spfRules: "include:amazonses.com",
    type: "SPFM",
  },
  {
    data: "v=DMARC1; p=quarantine",
    essential: "OnApply",
    host: "_dmarc",
    ttl: 300,
    txtConflictMatchingMode: "Prefix",
    txtConflictMatchingPrefix: "v=DMARC1",
    type: "TXT",
  },
] satisfies DomainConnectTemplateRecord[];

export const createDomainConnectTemplate = (mode: MailDomainMode) => {
  const service = domainConnectServices[mode];
  return {
    description:
      mode === "send_only"
        ? "Authenticate this domain for outbound mail from Quieter."
        : "Authenticate this domain and route incoming mail to Quieter.",
    logoUrl: "https://quieter.email/icon.svg",
    providerId: DOMAIN_CONNECT_PROVIDER_ID,
    providerName: "Quieter",
    records: [
      ...sharedTemplateRecords,
      ...(mode === "send_and_receive"
        ? [
            {
              host: "@",
              pointsTo: "inbound-smtp.%AWS_REGION%.amazonaws.com",
              priority: 10,
              ttl: 300,
              type: "MX" as const,
            },
          ]
        : []),
    ],
    serviceId: service.id,
    serviceName: service.name,
    syncBlock: false,
    syncPubKeyDomain: "quieter.email",
    syncRedirectDomain: "quieter.email",
    version: service.version,
  };
};

export const getDomainConnectService = (mode: MailDomainMode) => domainConnectServices[mode];

const normalizeEndpoint = (value: string) => {
  const url = new URL(value.includes("://") ? value : `https://${value}`);
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.search) {
    return null;
  }
  return url.toString().replace(/\/+$/, "");
};

const getTrustedProvider = (discoveryEndpoint: string) =>
  trustedProviderEndpoints.find((provider) =>
    provider.discovery.some((endpoint) => endpoint === discoveryEndpoint),
  );

const isTrustedEndpoint = (value: string, allowed: readonly string[]) => {
  const endpoint = normalizeEndpoint(value);
  return endpoint != null && allowed.some((candidate) => candidate === endpoint);
};

const readDiscoveryEndpoint = async (
  domain: string,
  lookupTxt: (name: string) => Promise<string[][]>,
) => {
  try {
    const answers = await lookupTxt(`_domainconnect.${domain}`);
    for (const answer of answers) {
      const endpoint = normalizeEndpoint(answer.join("").trim());
      if (endpoint && getTrustedProvider(endpoint)) return endpoint;
    }
  } catch {
    return null;
  }
  return null;
};

export const discoverDomainConnect = async (input: {
  configured: boolean;
  domain: string;
  fetcher?: DomainConnectFetch;
  lookupTxt?: (name: string) => Promise<string[][]>;
  mode: MailDomainMode;
}): Promise<DomainConnectDiscovery> => {
  if (!input.configured) {
    return {
      available: false,
      controlPanelUrl: null,
      providerName: null,
      reason: "not_configured",
    };
  }

  const discoveryEndpoint = await readDiscoveryEndpoint(
    input.domain,
    input.lookupTxt ?? resolveTxt,
  );
  if (!discoveryEndpoint) {
    return {
      available: false,
      controlPanelUrl: null,
      providerName: null,
      reason: "provider_not_supported",
    };
  }

  const trustedProvider = getTrustedProvider(discoveryEndpoint);
  if (!trustedProvider) {
    return {
      available: false,
      controlPanelUrl: null,
      providerName: null,
      reason: "provider_not_supported",
    };
  }

  const fetcher = input.fetcher ?? fetch;
  const settingsResponse = await fetcher(
    `${discoveryEndpoint}/v2/${encodeURIComponent(input.domain)}/settings`,
    { headers: { accept: "application/json" }, signal: AbortSignal.timeout(5_000) },
  ).catch(() => null);
  if (!settingsResponse?.ok) {
    return {
      available: false,
      controlPanelUrl: null,
      providerName: null,
      reason: "provider_not_supported",
    };
  }

  const parsedSettings = providerSettingsSchema.safeParse(
    await settingsResponse.json().catch(() => null),
  );
  if (
    !parsedSettings.success ||
    !trustedProvider.providerIds.some(
      (providerId) => providerId === parsedSettings.data.providerId,
    ) ||
    !isTrustedEndpoint(parsedSettings.data.urlAPI, trustedProvider.urlApi) ||
    !parsedSettings.data.urlSyncUX ||
    !isTrustedEndpoint(parsedSettings.data.urlSyncUX, trustedProvider.urlSyncUx)
  ) {
    return {
      available: false,
      controlPanelUrl: null,
      providerName: null,
      reason: "provider_not_supported",
    };
  }

  const service = domainConnectServices[input.mode];
  const apiUrl = normalizeEndpoint(parsedSettings.data.urlAPI);
  const syncUrl = normalizeEndpoint(parsedSettings.data.urlSyncUX);
  if (!apiUrl || !syncUrl) {
    return {
      available: false,
      controlPanelUrl: null,
      providerName: null,
      reason: "provider_not_supported",
    };
  }

  const supportResponse = await fetcher(
    `${apiUrl}/v2/domainTemplates/providers/${DOMAIN_CONNECT_PROVIDER_ID}/services/${service.id}`,
    { headers: { accept: "application/json" }, signal: AbortSignal.timeout(5_000) },
  ).catch(() => null);
  const providerName = parsedSettings.data.providerDisplayName ?? parsedSettings.data.providerName;
  const controlPanelUrl = parsedSettings.data.urlControlPanel
    ? parsedSettings.data.urlControlPanel.replaceAll("%domain%", encodeURIComponent(input.domain))
    : null;
  if (!supportResponse?.ok) {
    return {
      available: false,
      controlPanelUrl,
      providerName,
      reason: "template_not_supported",
    };
  }

  const responseBody = await supportResponse.text();
  const templateVersion = (() => {
    if (!responseBody.trim()) return null;
    try {
      const parsed = z
        .object({ version: z.number().int().positive() })
        .safeParse(JSON.parse(responseBody));
      return parsed.success ? parsed.data.version : null;
    } catch {
      return null;
    }
  })();
  if (templateVersion != null && templateVersion !== service.version) {
    return {
      available: false,
      controlPanelUrl,
      providerName,
      reason: "template_not_supported",
    };
  }

  return {
    available: true,
    provider: {
      apiUrl,
      controlPanelUrl,
      displayName: providerName,
      id: parsedSettings.data.providerId,
      syncUrl,
      templateVersion,
    },
    serviceId: service.id,
    templateVersion: service.version,
  };
};

export const getDomainConnectVariables = (domain: string, records: MailDomainDnsRecord[]) => {
  const getRecord = (purpose: MailDomainDnsRecord["purpose"]) => {
    const record = records.find((candidate) => candidate.purpose === purpose);
    if (!record) {
      throw new ORPCError("BAD_REQUEST", {
        message: "The domain DNS setup is incomplete. Refresh the setup before continuing.",
      });
    }
    return record;
  };
  const dkim = records.filter((record) => record.purpose === "dkim");
  if (dkim.length !== 3) {
    throw new ORPCError("BAD_REQUEST", {
      message: "The domain signing records are incomplete. Refresh the setup before continuing.",
    });
  }

  const getDkimParts = (record: MailDomainDnsRecord) => {
    const suffix = `._domainkey.${domain}`;
    const selector = record.name.endsWith(suffix) ? record.name.slice(0, -suffix.length) : null;
    const token = record.value.match(/^([^.]+)\.dkim\.amazonses\.com\.?$/)?.[1];
    if (!selector || selector.includes(".") || !token) {
      throw new ORPCError("BAD_REQUEST", {
        message: "The domain signing records are invalid. Refresh the setup before continuing.",
      });
    }
    return { selector, token };
  };
  const ownership = getRecord("ownership").value.match(/^quieter-domain-verification=(.+)$/)?.[1];
  const region = getRecord("mail_from_mx").value.match(
    /^feedback-smtp\.([a-z0-9-]+)\.amazonses\.com\.?$/,
  )?.[1];
  if (!ownership || !region) {
    throw new ORPCError("BAD_REQUEST", {
      message: "The domain DNS setup is invalid. Refresh the setup before continuing.",
    });
  }
  const dkimParts = dkim.map(getDkimParts);
  const variables = new URLSearchParams({
    AWS_REGION: region,
    DKIM1_SELECTOR: dkimParts[0]!.selector,
    DKIM1_TOKEN: dkimParts[0]!.token,
    DKIM2_SELECTOR: dkimParts[1]!.selector,
    DKIM2_TOKEN: dkimParts[1]!.token,
    DKIM3_SELECTOR: dkimParts[2]!.selector,
    DKIM3_TOKEN: dkimParts[2]!.token,
    OWNERSHIP_TOKEN: ownership,
  });
  variables.sort();
  return variables;
};

export const buildDomainConnectApplyUrl = (input: {
  callbackUrl: string;
  domain: string;
  mode: MailDomainMode;
  privateKey: string;
  provider: DomainConnectProvider;
  records: MailDomainDnsRecord[];
  state: string;
}) => {
  const service = domainConnectServices[input.mode];
  const applyUrl = new URL(
    `${input.provider.syncUrl}/v2/domainTemplates/providers/${DOMAIN_CONNECT_PROVIDER_ID}/services/${service.id}/apply`,
  );
  applyUrl.searchParams.set("domain", input.domain);
  applyUrl.searchParams.set("redirect_uri", input.callbackUrl);
  applyUrl.searchParams.set("state", input.state);
  for (const [name, value] of getDomainConnectVariables(input.domain, input.records)) {
    applyUrl.searchParams.set(name, value);
  }

  const signer = createSign("RSA-SHA256");
  signer.update(applyUrl.searchParams.toString());
  signer.end();
  const signature = signer.sign(input.privateKey, "base64");
  applyUrl.searchParams.set("key", DOMAIN_CONNECT_PUBLIC_KEY_NAME);
  applyUrl.searchParams.set("sig", signature);
  return applyUrl.toString();
};

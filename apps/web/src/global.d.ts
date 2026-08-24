declare const __QUIETER_BUILD_ID__: string;

/**
 * Only the asset archive binding is declared. Pulling in the full Cloudflare
 * Worker types would collide with the DOM lib this app is built against, and
 * this is the one object binding the web Worker reaches for.
 */
declare module "cloudflare:workers" {
  export const env: {
    WebAssetArchive?: {
      get: (key: string) => Promise<{
        body: ReadableStream;
        httpEtag: string;
        writeHttpMetadata: (headers: Headers) => void;
      } | null>;
    };
  };
}

declare module "*.css";
declare module "*.css?url";
declare module "@barkleapp/css-sanitizer" {
  export type CssSanitizerOptions = {
    allowedAtRules?: Iterable<string>;
    allowedProperties?: Iterable<string>;
    allowedPseudoClasses?: Iterable<string>;
    disallowedAtRules?: Iterable<string>;
    disallowedFunctions?: Iterable<string>;
    maxCssLength?: number;
    sanitizeUrl?: (url: string) => string;
    validateUrl?: (url: string) => boolean;
  };

  export class CssSanitizer {
    constructor(options?: CssSanitizerOptions);
    sanitizeCss(css: string, options?: CssSanitizerOptions): string;
  }
}

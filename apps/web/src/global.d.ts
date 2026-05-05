declare module "*.css";
declare module "*.css?url";
declare module "@barkleapp/css-sanitizer" {
  type CssSanitizerOptions = {
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

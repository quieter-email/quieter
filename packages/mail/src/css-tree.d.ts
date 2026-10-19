declare module "css-tree/parser" {
  import type { parse as parser } from "css-tree";

  const parse: typeof parser;
  export default parse;
}

declare module "css-tree/walker" {
  import type { walk as walker } from "css-tree";

  const walk: typeof walker;
  export default walk;
}

declare module "css-tree/generator" {
  import type { generate as generator } from "css-tree";

  const generate: typeof generator;
  export default generate;
}

declare module "css-tree/utils" {
  import type { ident as identifier } from "css-tree";

  export const ident: typeof identifier;
}

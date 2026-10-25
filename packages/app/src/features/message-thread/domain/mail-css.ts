import { find, generate, ident, parse, walk } from "css-tree";
import type { CssNode, List } from "css-tree";

const BLOCKED_PSEUDOS = new Set(["host", "host-context", "slotted", "part"]);
const BLOCKED_PROPERTIES = new Set([
  "behavior",
  "-ms-behavior",
  "-moz-binding",
  "-webkit-user-modify",
  "view-transition-name",
]);
const BLOCKED_FUNCTIONS = new Set([
  "attr",
  "expression",
  "paint",
  "element",
  "-moz-element",
  "src",
  "url",
]);
const IMAGE_STRING_FUNCTIONS = new Set([
  "image",
  "image-set",
  "-webkit-image-set",
]);
const GROUPING_AT_RULES = new Set(["media", "supports"]);

type MailCssOptions = {
  context: "declarationList" | "stylesheet";
  resolveImage: (value: string) => string | null;
};

const sanitizeValue = (
  value: CssNode,
  resolveImage: MailCssOptions["resolveImage"]
): boolean => {
  if (find(value, (node) => node.type === "Raw")) {
    return false;
  }
  let safe = true;

  walk(value, (node) => {
    if (node.type === "Url") {
      const resolved = resolveImage(node.value);
      if (resolved === null) {
        safe = false;
      } else {
        node.value = resolved;
      }
    }
    if (node.type !== "Function") {
      return;
    }

    const name = ident.decode(node.name).toLowerCase();
    if (BLOCKED_FUNCTIONS.has(name)) {
      safe = false;
      return;
    }
    if (!IMAGE_STRING_FUNCTIONS.has(name)) {
      return;
    }

    // A variable can substitute a bare URL string after this tree was checked.
    if (
      find(
        node,
        (child) =>
          child.type === "Function" &&
          ident.decode(child.name).toLowerCase() === "var"
      )
    ) {
      safe = false;
      return;
    }

    for (const child of node.children) {
      if (child.type !== "String") {
        continue;
      }
      const resolved = resolveImage(child.value);
      if (resolved === null) {
        safe = false;
      } else {
        child.value = resolved;
      }
    }
  });

  return safe;
};

const sanitizeChildren = (
  children: List<CssNode>,
  resolveImage: MailCssOptions["resolveImage"],
  declarations: boolean
) => {
  // oxlint-disable-next-line unicorn/no-array-for-each -- CSS Tree's linked list supports removal during traversal.
  children.forEach((node, item) => {
    if (node.type === "Declaration" && declarations) {
      const property = ident.decode(node.property).toLowerCase();
      if (
        BLOCKED_PROPERTIES.has(property) ||
        !sanitizeValue(node.value, resolveImage)
      ) {
        children.remove(item);
      }
      return;
    }

    if (node.type === "Rule" && node.prelude.type === "SelectorList") {
      let safe = !find(node.prelude, (selector) => selector.type === "Raw");
      walk(node.prelude, (selector, selectorItem, selectorList) => {
        if (
          selector.type !== "PseudoClassSelector" &&
          selector.type !== "PseudoElementSelector"
        ) {
          return;
        }
        const name = ident.decode(selector.name).toLowerCase();
        if (BLOCKED_PSEUDOS.has(name)) {
          safe = false;
        }
        if (selector.type === "PseudoClassSelector" && name === "root") {
          selectorList.replace(
            selectorItem,
            selectorList.createItem({ name: "html", type: "TypeSelector" })
          );
        }
      });

      if (safe) {
        sanitizeChildren(node.block.children, resolveImage, true);
      }
      if (!safe || node.block.children.isEmpty) {
        children.remove(item);
      }
      return;
    }

    if (
      node.type === "Atrule" &&
      GROUPING_AT_RULES.has(ident.decode(node.name).toLowerCase()) &&
      node.prelude !== null &&
      node.block !== null &&
      sanitizeValue(node.prelude, resolveImage)
    ) {
      sanitizeChildren(node.block.children, resolveImage, declarations);
      if (node.block.children.isEmpty) {
        children.remove(item);
      }
      return;
    }

    children.remove(item);
  });
};

export const sanitizeMailCss = (
  source: string,
  { context, resolveImage }: MailCssOptions
): string => {
  try {
    let unknownRecovery = false;
    const ast = parse(source, {
      context,
      onParseError: (_error, fallback) => {
        if (fallback.type !== "Raw") {
          unknownRecovery = true;
        }
      },
      parseCustomProperty: true,
    });
    if (
      unknownRecovery ||
      (ast.type !== "StyleSheet" && ast.type !== "DeclarationList")
    ) {
      return "";
    }

    sanitizeChildren(
      ast.children,
      resolveImage,
      ast.type === "DeclarationList"
    );
    if (find(ast, (node) => node.type === "Raw")) {
      return "";
    }
    // The document is serialized and reparsed before mounting in the shadow tree.
    return generate(ast).replaceAll(/<(?=\/style)/giu, "\\3c ");
  } catch {
    return "";
  }
};

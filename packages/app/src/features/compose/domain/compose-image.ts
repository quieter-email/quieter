import { resolveComposeImageSource } from "@quieter/app/features/message-thread/domain/mail-html";
import {
  readExternalImagesEnabled,
  subscribeToExternalImagesEnabled,
} from "@quieter/app/features/settings/domain/external-images-setting";
import { Image } from "@tiptap/extension-image";

export const ComposeImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      "data-compose-inline-id": { default: null },
    };
  },
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("img");
      let currentNode = node;
      const render = () => {
        const source: unknown = currentNode.attrs.src;
        const resolved =
          typeof source === "string"
            ? resolveComposeImageSource(source, readExternalImagesEnabled())
            : null;
        if (resolved === null) {
          dom.removeAttribute("src");
        } else {
          dom.setAttribute("src", resolved);
        }
        dom.setAttribute("referrerpolicy", "no-referrer");
        for (const name of [
          "alt",
          "title",
          "width",
          "height",
          "data-compose-inline-id",
        ]) {
          const value: unknown = currentNode.attrs[name];
          if (typeof value === "string" || typeof value === "number") {
            dom.setAttribute(name, String(value));
          } else {
            dom.removeAttribute(name);
          }
        }
      };
      render();
      const unsubscribe = subscribeToExternalImagesEnabled(render);
      return {
        destroy: unsubscribe,
        dom,
        update: (nextNode) => {
          if (nextNode.type !== currentNode.type) {
            return false;
          }
          currentNode = nextNode;
          render();
          return true;
        },
      };
    };
  },
});

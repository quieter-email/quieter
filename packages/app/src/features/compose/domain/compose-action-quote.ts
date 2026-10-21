import type { ComposeDraftState } from "@quieter/app/features/compose/domain/draft";

export type ComposeActionQuote = {
  attachments: ComposeDraftState["attachments"];
  html: string;
  inlineImages: ComposeDraftState["inlineImages"];
  replyHtml: string;
  forwardHtml: string;
};

export type ComposeActionDraft = ComposeDraftState & {
  actionQuote?: ComposeActionQuote;
};

export const getReferencedComposeActionImages = (
  bodyHtml: string,
  inlineImages: ComposeDraftState["inlineImages"]
) => {
  const doc = new DOMParser().parseFromString(bodyHtml, "text/html");
  const references = [...doc.querySelectorAll<HTMLImageElement>("img")];
  return inlineImages.filter((asset) =>
    references.some(
      (image) =>
        image.dataset.composeInlineId === asset.id ||
        image.getAttribute("src")?.toLowerCase() ===
          `cid:${asset.contentId.toLowerCase()}`
    )
  );
};

export const prepareComposeActionQuote = ({
  quote,
  inlineImages,
  sameSource,
}: {
  quote: ComposeActionQuote;
  inlineImages: ComposeDraftState["inlineImages"];
  sameSource: boolean;
}) => {
  const doc = new DOMParser().parseFromString(quote.html, "text/html");
  const images = quote.inlineImages.map((asset) => {
    const existing = inlineImages.find(
      (image) => image.contentId.toLowerCase() === asset.contentId.toLowerCase()
    );
    if (!existing) {
      return asset;
    }
    if (sameSource) {
      return existing;
    }
    const contentId = `compose-${asset.id}`;
    for (const image of doc.querySelectorAll<HTMLImageElement>("img")) {
      if (
        image.getAttribute("src")?.toLowerCase() ===
        `cid:${asset.contentId.toLowerCase()}`
      ) {
        image.setAttribute("src", `cid:${contentId}`);
      }
    }
    return { ...asset, contentId };
  });
  const bodyHtml = doc.body.innerHTML;
  return {
    bodyHtml,
    inlineImages: getReferencedComposeActionImages(bodyHtml, images),
  };
};

export const replaceComposeActionQuote = ({
  currentHtml,
  previousHtml,
  nextHtml,
  inlineImages,
}: {
  currentHtml: string;
  previousHtml: string;
  nextHtml: string;
  inlineImages: ComposeDraftState["inlineImages"];
}) => {
  const current = new DOMParser().parseFromString(currentHtml, "text/html");
  const previous = new DOMParser().parseFromString(previousHtml, "text/html");
  const next = new DOMParser().parseFromString(nextHtml, "text/html");
  const previousParts = [
    ...previous.body.querySelectorAll<HTMLElement>(
      ":scope > [data-compose-quote]"
    ),
  ];
  const comparable = new Map<Element, string>();
  for (const element of [...current.body.children, ...previousParts]) {
    const copy = element.cloneNode(true);
    if (!(copy instanceof HTMLElement)) {
      continue;
    }
    delete copy.dataset.composeQuote;
    for (const image of copy.querySelectorAll<HTMLImageElement>("img")) {
      const asset = inlineImages.find(
        (candidate) => candidate.id === image.dataset.composeInlineId
      );
      if (asset) {
        image.setAttribute("src", `cid:${asset.contentId.toLowerCase()}`);
      } else if (
        image.getAttribute("src")?.toLowerCase().startsWith("cid:") === true
      ) {
        image.setAttribute(
          "src",
          image.getAttribute("src")?.toLowerCase() ?? ""
        );
      }
      delete image.dataset.composeInlineId;
    }
    comparable.set(element, copy.outerHTML);
  }
  let currentParts = [
    ...current.body.querySelectorAll<HTMLElement>(
      ":scope > [data-compose-quote]"
    ),
  ];
  if (currentParts.length === 0 && previousParts.length > 0) {
    const children = [
      ...current.body.querySelectorAll<HTMLElement>(":scope > *"),
    ];
    const start = children.findIndex((_, index) =>
      previousParts.every((part, offset) => {
        const candidate = children[index + offset];
        return (
          candidate !== undefined &&
          comparable.get(candidate) === comparable.get(part)
        );
      })
    );
    if (start !== -1) {
      currentParts = children.slice(start, start + previousParts.length);
      for (const [index, element] of currentParts.entries()) {
        const marker = previousParts[index]?.dataset.composeQuote;
        if (marker) {
          element.dataset.composeQuote = marker;
        }
      }
    }
  }
  const incoming = [
    ...next.body.querySelectorAll<HTMLElement>(":scope > [data-compose-quote]"),
  ];
  const [before] = currentParts;
  for (const element of incoming) {
    current.body.insertBefore(element, before ?? null);
  }
  for (const element of currentParts) {
    const expected = previousParts.find(
      (part) =>
        part.dataset.composeQuote === element.dataset.composeQuote &&
        comparable.get(part) === comparable.get(element)
    );
    if (expected) {
      element.remove();
    } else {
      delete element.dataset.composeQuote;
    }
  }
  return current.body.innerHTML;
};

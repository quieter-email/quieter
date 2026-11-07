import { toastError } from "@quieter/app/lib/error-toast";

export const openAttachmentPreview = async ({
  fileName,
  loadFile,
}: {
  fileName: string;
  loadFile: () => Promise<File>;
}) => {
  const preview = window.open("", "_blank");
  if (!preview) {
    throw new Error("The attachment tab could not be opened.");
  }
  preview.opener = null;
  const previewDocument = preview.document;
  previewDocument.title = fileName;
  const policy = previewDocument.createElement("meta");
  policy.httpEquiv = "Content-Security-Policy";
  policy.content =
    "default-src 'none'; img-src blob:; font-src blob: data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";
  previewDocument.head.append(policy);
  // This isolated document cannot consume React controls or the app stylesheet.
  const theme = getComputedStyle(document.documentElement);
  previewDocument.body.style.cssText =
    "box-sizing:border-box;margin:0;padding:1rem;font-size:14px;line-height:1.5;min-height:100vh";
  previewDocument.body.style.fontFamily = getComputedStyle(
    document.body
  ).fontFamily;
  previewDocument.body.style.background = theme.getPropertyValue("--panel");
  previewDocument.body.style.color = theme.getPropertyValue("--fg");
  previewDocument.body.textContent = "Loading attachment…";
  let disposed = false;
  let destroyPdf: (() => Promise<void>) | undefined;

  try {
    const file = await loadFile();
    if (preview.closed) {
      return;
    }
    const mime = file.type.split(";")[0]?.trim().toLowerCase() ?? "";
    const objectUrl = URL.createObjectURL(file);
    // A preview owns its URL independently of draft removal and composer cleanup.
    const closedTimer = window.setInterval(() => {
      if (preview.closed) {
        disposed = true;
        URL.revokeObjectURL(objectUrl);
        window.clearInterval(closedTimer);
        void destroyPdf?.();
      }
    }, 1000);
    preview.addEventListener(
      "pagehide",
      () => {
        disposed = true;
        URL.revokeObjectURL(objectUrl);
        window.clearInterval(closedTimer);
        void destroyPdf?.();
      },
      { once: true }
    );
    previewDocument.body.replaceChildren();
    const header = previewDocument.createElement("header");
    header.style.cssText = "display:flex;align-items:center;gap:1rem";
    const heading = previewDocument.createElement("p");
    heading.textContent = fileName;
    heading.style.cssText =
      "flex:1;min-width:0;margin:0;font-weight:500;overflow-wrap:anywhere";
    const download = previewDocument.createElement("a");
    download.href = objectUrl;
    download.download = fileName;
    download.textContent = "Download";
    download.style.cssText =
      "display:inline-flex;align-items:center;flex-shrink:0;padding:.5rem .75rem;text-decoration:none;font-weight:500";
    download.style.borderRadius = theme.getPropertyValue("--radius-md");
    download.style.background = theme.getPropertyValue("--primary");
    download.style.color = theme.getPropertyValue("--primary-fg");
    header.append(heading, download);
    previewDocument.body.append(header);
    if (/^image\/(?:avif|bmp|gif|jpeg|png|svg\+xml|webp)$/u.test(mime)) {
      const image = previewDocument.createElement("img");
      image.alt = fileName;
      image.src = objectUrl;
      image.style.display = "block";
      image.style.maxWidth = "100%";
      image.style.marginTop = "1rem";
      previewDocument.body.append(image);
    } else if (mime === "application/pdf") {
      const [pdfjs, worker] = await Promise.all([
        import("pdfjs-dist"),
        import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
      ]);
      const data = new Uint8Array(await file.arrayBuffer());
      if (disposed || preview.closed) {
        return;
      }
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      const loading = pdfjs.getDocument({
        data,
        maxImageSize: 16_000_000,
        ownerDocument: previewDocument,
        useWasm: false,
      });
      destroyPdf = async () => {
        await loading.destroy();
      };
      const pdf = await loading.promise;
      if (disposed || preview.closed) {
        await loading.destroy();
        return;
      }
      let pageNumber = 1;
      let rendering = false;
      const previous = previewDocument.createElement("button");
      previous.textContent = "Previous";
      const next = previewDocument.createElement("button");
      next.textContent = "Next";
      const status = previewDocument.createElement("span");
      status.setAttribute("aria-live", "polite");
      for (const button of [previous, next]) {
        button.style.cssText = download.style.cssText;
        button.style.border = "0";
        button.style.font = "inherit";
        button.style.background = theme.getPropertyValue("--secondary");
        button.style.color = theme.getPropertyValue("--secondary-fg");
      }
      download.before(previous, status, next);
      header.style.flexWrap = "wrap";
      const canvas = previewDocument.createElement("canvas");
      canvas.style.cssText = "display:block;max-width:100%;margin:1rem auto 0";
      canvas.setAttribute("role", "img");
      previewDocument.body.append(canvas);
      const renderPage = async () => {
        rendering = true;
        previous.disabled = true;
        next.disabled = true;
        try {
          const page = await pdf.getPage(pageNumber);
          const baseViewport = page.getViewport({ scale: 1 });
          const scale = Math.min(
            (preview.innerWidth - 32) / baseViewport.width,
            1.5,
            2048 / Math.max(baseViewport.width, baseViewport.height)
          );
          const viewport = page.getViewport({ scale });
          const pixelScale = Math.min(preview.devicePixelRatio || 1, 2);
          canvas.width = Math.floor(viewport.width * pixelScale);
          canvas.height = Math.floor(viewport.height * pixelScale);
          canvas.style.width = `${viewport.width}px`;
          canvas.style.height = `${viewport.height}px`;
          canvas.setAttribute(
            "aria-label",
            `Page ${pageNumber} of ${pdf.numPages}`
          );
          status.textContent = `${pageNumber} / ${pdf.numPages}`;
          await page.render({
            canvas,
            // The originating app tab can be backgrounded while this preview is visible.
            intent: "print",
            transform: [pixelScale, 0, 0, pixelScale, 0, 0],
            viewport,
          }).promise;
          page.cleanup();
        } finally {
          rendering = false;
          previous.disabled = pageNumber === 1;
          next.disabled = pageNumber === pdf.numPages;
        }
      };
      const changePage = async (direction: number) => {
        if (rendering || disposed) {
          return;
        }
        pageNumber += direction;
        try {
          await renderPage();
        } catch (error) {
          if (disposed) {
            return;
          }
          status.textContent =
            "Could not display this page. Download to view it.";
          toastError(error, { boundary: "attachment-pdf-preview" });
        }
      };
      previous.addEventListener("click", () => {
        void changePage(-1);
      });
      next.addEventListener("click", () => {
        void changePage(1);
      });
      await renderPage();
    } else if (
      mime.startsWith("text/") ||
      ["application/json", "application/xml", "application/xhtml+xml"].includes(
        mime
      )
    ) {
      const content = previewDocument.createElement("pre");
      content.style.whiteSpace = "pre-wrap";
      content.style.overflowWrap = "anywhere";
      content.textContent = await file.text();
      previewDocument.body.append(content);
    } else {
      const unavailable = previewDocument.createElement("p");
      unavailable.textContent = "Download this file to view it.";
      previewDocument.body.append(unavailable);
    }
  } catch (error) {
    if (disposed || preview.closed) {
      return;
    }
    await destroyPdf?.();
    if (previewDocument.querySelector("a[download]")) {
      const unavailable = previewDocument.createElement("p");
      unavailable.textContent =
        "Could not display this file. Download to view it.";
      previewDocument.body.append(unavailable);
    } else {
      preview.close();
    }
    throw error;
  }
};

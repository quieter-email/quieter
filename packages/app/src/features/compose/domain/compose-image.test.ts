import { resolveComposeImageSource } from "@quieter/app/features/message-thread/domain/mail-html";
import { describe, expect, test } from "vite-plus/test";

describe("compose image resource policy", () => {
  test.each([
    "https://sender.example/track",
    "http://sender.example/track",
    "//sender.example/track",
    "https://user:password@sender.example/track",
    "https:\n//sender.example/track",
    "/track",
    "file:///tracking.png",
    "data:image/svg+xml,<svg></svg>",
  ])("withholds unapproved or unsafe image source %s", (source) => {
    expect(resolveComposeImageSource(source, false)).toBeNull();
  });

  test("permits authorized remote images without relaxing unsafe schemes", () => {
    expect(resolveComposeImageSource("//sender.example/photo.png", true)).toBe(
      "https://sender.example/photo.png"
    );
    expect(resolveComposeImageSource("file:///tracking.png", true)).toBeNull();
    expect(
      resolveComposeImageSource("https://user:pass@sender.example/image", true)
    ).toBeNull();
  });

  test.each([
    "blob:https://quieter.example/owned-image",
    "data:image/png;base64,aGVsbG8=",
    "cid:inline-photo",
  ])(
    "retains non-remote inline images while blocking is active %s",
    (source) => {
      expect(resolveComposeImageSource(source, false)).toBe(source);
    }
  );
});

import { useState } from "react";
import { Linking } from "react-native";
import { WebView } from "react-native-webview";
import { useResolveClassNames } from "uniwind";

import { Text } from "#/components/ui/text";

type MessageBodyProps = {
  bodyHtml?: string | null;
  bodyText?: string | null;
};

const HEIGHT_SCRIPT = `
  (function () {
    var post = function () {
      window.ReactNativeWebView.postMessage(String(document.body.scrollHeight));
    };
    setTimeout(post, 30);
    setTimeout(post, 250);
    true;
  })();
`;

/**
 * Email HTML renders inside a locked-down WebView: no remote subresources
 * (tracking pixels stay blocked by default), inline styles preserved, and the
 * app's theme injected so the message body matches the surrounding surface.
 */
export const MessageBody = ({ bodyHtml, bodyText }: MessageBodyProps) => {
  const [height, setHeight] = useState(96);
  const { color: fgValue } = useResolveClassNames("text-fg");
  const { color: mutedFgValue } = useResolveClassNames("text-muted-fg");
  const { backgroundColor: bgValue } = useResolveClassNames("bg-bg-raised");
  const fg = typeof fgValue === "string" ? fgValue : "#000000";
  const mutedFg = typeof mutedFgValue === "string" ? mutedFgValue : "#888888";
  const bg = typeof bgValue === "string" ? bgValue : "transparent";

  const html = bodyHtml?.trim() ?? "";

  if (html.length === 0) {
    return (
      <Text className="text-body text-fg" selectable>
        {bodyText?.trim() ?? ""}
      </Text>
    );
  }

  return (
    <WebView
      androidLayerType="hardware"
      injectedJavaScript={HEIGHT_SCRIPT}
      javaScriptEnabled
      onMessage={(event) => {
        const nextHeight = Number(event.nativeEvent.data);
        if (Number.isFinite(nextHeight) && nextHeight > 0) {
          setHeight(Math.min(nextHeight + 8, 20_000));
        }
      }}
      onShouldStartLoadWithRequest={(request) => {
        if (
          request.url.startsWith("http://") ||
          request.url.startsWith("https://")
        ) {
          void Linking.openURL(request.url);
          return false;
        }
        return request.url.startsWith("about:");
      }}
      originWhitelist={["about:*"]}
      scrollEnabled={false}
      setBuiltInZoomControls={false}
      showsVerticalScrollIndicator={false}
      source={{
        html: `<!doctype html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:">
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0;
    padding: 0;
    background: ${bg};
    color: ${fg};
    font-family: -apple-system, "Geist", system-ui, sans-serif;
    font-size: 15px;
    line-height: 1.55;
    overflow-wrap: break-word;
    word-break: break-word;
  }
  a { color: ${fg}; }
  blockquote {
    margin: 0 0 0 0.5rem;
    padding-left: 0.75rem;
    border-left: 2px solid ${mutedFg}44;
    color: ${mutedFg};
  }
  img { max-width: 100%; height: auto; }
  table { max-width: 100%; }
  pre { white-space: pre-wrap; }
</style>
</head><body>${html}</body></html>`,
      }}
      style={{ backgroundColor: bg, height, width: "100%" }}
    />
  );
};

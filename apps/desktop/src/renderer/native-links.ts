import { toastError } from "@quieter/app/lib/error-toast";
import { rpc } from "@quieter/app/lib/orpc";
import { useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";

import { NativeLinkConsumer } from "./native-link-consumer";
import { loadDesktopUser, router } from "./router";

export const useNativeMailLinks = (userId: string | null): void => {
  const location = useRouterState({
    router,
    select: (state) => state.location.href,
  });
  useEffect(() => {
    let consumer: NativeLinkConsumer | undefined;
    let stop: (() => void) | undefined;
    if (userId !== null) {
      consumer = new NativeLinkConsumer({
        listMailboxes: async (signal) =>
          await rpc.mail.listMailboxes(undefined, { signal }),
        nativeLinks: window.quieterDesktop.nativeLinks,
        navigate: async (target) => {
          await router.navigate({
            search:
              target.kind === "mailto"
                ? { compose: "mailto", mailto: target.url }
                : {
                    mailbox: target.mailbox,
                    mailboxId: target.mailboxId,
                    messageId: target.messageId,
                    threadId: target.threadId,
                  },
            to: "/",
          });
        },
        onError: (error) => {
          toastError(error, { boundary: "desktop-native-link" });
        },
        readUser: loadDesktopUser,
        userId,
      });
      const current = consumer;
      stop = window.quieterDesktop.nativeLinks.onPending(() => {
        void current.consume();
      });
    }
    return () => {
      consumer?.stop();
      stop?.();
    };
  }, [location, userId]);
};

"use client";

import { MailboxWorkspace } from "@quieter/app/features/mailbox/components/mailbox-workspace";
import { getCalendarQueryKey } from "@quieter/app/lib/calendar-query";
import { toastError } from "@quieter/app/lib/error-toast";
import { getMailboxesQueryKey } from "@quieter/app/lib/mailboxes-query";
import { inboxRouteApi } from "@quieter/app/lib/route-apis";
import { toast } from "@quieter/ui/toast";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

type InboxPageClientProps = {
  gmailError?: { message: string; status: number } | null;
  user: {
    id?: string | null;
    email?: string | null;
    name?: string | null;
  };
};

export const InboxPageClient = ({ gmailError, user }: InboxPageClientProps) => {
  const navigate = useNavigate({ from: "/" });
  const queryClient = useQueryClient();
  const gmail = inboxRouteApi.useSearch({ select: (search) => search.gmail });
  const handled = useRef<typeof gmail | null>(null);
  const userId = user.id;

  useEffect(() => {
    if (gmail === undefined) {
      handled.current = null;
      return;
    }
    if (handled.current === gmail) {
      return;
    }
    handled.current = gmail;

    if (gmail === "connected") {
      toast.success("Gmail connected.");
      void queryClient.invalidateQueries({ queryKey: getMailboxesQueryKey() });
      if (userId) {
        void queryClient.invalidateQueries({
          queryKey: getCalendarQueryKey(userId),
        });
      }
    } else {
      toastError(gmailError, {
        boundary: "gmail-connect",
        fallback: "Gmail connection didn't finish. Please try again.",
        report: false,
      });
    }

    void navigate({
      replace: true,
      resetScroll: false,
      search: (previous) => ({ ...previous, gmail: undefined }),
      to: ".",
    });
  }, [gmail, gmailError, navigate, queryClient, userId]);

  return <MailboxWorkspace user={user} />;
};

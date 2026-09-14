import type { MessageListItem } from "@quieter/mail/messages";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";

import { MobileHeader } from "#/components/mobile-header";
import { Button } from "#/components/ui/button";
import { Text } from "#/components/ui/text";
import { TextField } from "#/components/ui/text-field";
import {
  buildComposeDraft,
  buildOutgoingBody,
  validateComposeDraft,
} from "#/features/compose/domain/draft";
import type { ComposeMode } from "#/features/compose/domain/draft";
import { useSelectedMailboxId } from "#/features/workspace/workspace-store";
import { authClient } from "#/lib/auth-client";
import { api } from "#/lib/orpc";
import { queryClient } from "#/lib/query-client";
import { toast, toastError } from "#/lib/toast";

const resolveMode = (value: string | string[] | undefined): ComposeMode => {
  const mode = Array.isArray(value) ? value[0] : value;
  if (mode === "reply" || mode === "reply-all" || mode === "forward") {
    return mode;
  }
  return "new";
};

const firstParam = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

export const ComposeScreen = () => {
  const router = useRouter();
  const params = useLocalSearchParams<{
    messageId?: string;
    mode?: string;
    threadId?: string;
  }>();
  const mailboxId = useSelectedMailboxId();
  const { data: session } = authClient.useSession();
  const mode = resolveMode(params.mode);
  const threadId = firstParam(params.threadId);
  const messageId = firstParam(params.messageId);

  const threadQuery = useQuery({
    ...api.mail.thread({
      mailboxId: mailboxId ?? "",
      threadId: threadId ?? "",
    }),
    enabled: mailboxId !== null && threadId !== undefined && mode !== "new",
  });

  const sourceMessage: MessageListItem | null = useMemo(() => {
    const messages = threadQuery.data?.messages ?? [];
    if (messageId === undefined) {
      return messages.at(-1) ?? null;
    }
    return (
      messages.find((message) => message.id === messageId) ??
      messages.at(-1) ??
      null
    );
  }, [messageId, threadQuery.data]);

  const draft = useMemo(
    () =>
      buildComposeDraft({
        currentUserEmail: session?.user.email,
        message: sourceMessage,
        mode,
      }),
    [mode, session?.user.email, sourceMessage]
  );

  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [initializedKey, setInitializedKey] = useState<string | null>(null);

  const draftKey = `${mode}:${threadId ?? "new"}:${sourceMessage?.id ?? ""}`;
  useEffect(() => {
    if (initializedKey === draftKey) {
      return;
    }
    if (mode !== "new" && sourceMessage === null) {
      return;
    }
    setTo(draft.recipients.to);
    setCc(draft.recipients.cc);
    setSubject(draft.subject);
    setBody(draft.bodyText.trimStart());
    setInitializedKey(draftKey);
  }, [draft, draftKey, initializedKey, mode, sourceMessage]);

  // oxlint-disable-next-line react-doctor/query-mutation-missing-invalidation -- The mailbox cache is invalidated in `onSuccess`.
  const sendMutation = useMutation({
    mutationFn: async () => {
      if (mailboxId === null) {
        throw new Error("Choose a mailbox before sending.");
      }
      const outgoing = {
        ...draft,
        recipients: { bcc: draft.recipients.bcc, cc, to },
        saveStatus: "sending" as const,
        subject,
        updatedAt: Date.now(),
        ...buildOutgoingBody(body),
      };
      const validationError = validateComposeDraft(outgoing);
      if (validationError !== null) {
        throw Object.assign(new Error(validationError), { status: 422 });
      }
      return await api.client.mail.sendMessage({
        mailboxId,
        message: outgoing,
      });
    },
    onError: (error) => {
      toastError(error);
    },
    onSuccess: async () => {
      toast.message("Message sent.");
      if (mailboxId !== null) {
        await api.invalidate.mail(queryClient, mailboxId);
      }
      router.back();
    },
  });

  // oxlint-disable-next-line react-doctor/query-mutation-missing-invalidation -- The mailbox cache is invalidated in `onSuccess`.
  const saveDraftMutation = useMutation({
    mutationFn: async () => {
      if (mailboxId === null) {
        throw new Error("Choose a mailbox before saving.");
      }
      return await api.client.mail.saveDraft({
        draft: {
          ...draft,
          recipients: { bcc: draft.recipients.bcc, cc, to },
          saveStatus: "saved",
          subject,
          updatedAt: Date.now(),
          ...buildOutgoingBody(body),
        },
        mailboxId,
      });
    },
    onError: (error) => {
      toastError(error);
    },
    onSuccess: async () => {
      toast.message("Draft saved.");
      if (mailboxId !== null) {
        await api.invalidate.mail(queryClient, mailboxId);
      }
    },
  });

  const isSending = sendMutation.isPending;
  const isSaving = saveDraftMutation.isPending;

  return (
    <View className="flex-1 bg-bg">
      <MobileHeader
        leading="back"
        onLeadingClick={() => {
          router.back();
        }}
        title={mode === "new" ? "New message" : "Draft"}
      >
        <Button
          onPress={() => {
            saveDraftMutation.mutate();
          }}
          pending={isSaving}
          size="sm"
          variant="ghost"
        >
          Save
        </Button>
        <Button
          onPress={() => {
            sendMutation.mutate();
          }}
          pending={isSending}
          size="sm"
        >
          Send
        </Button>
      </MobileHeader>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        className="flex-1"
      >
        <ScrollView
          className="flex-1"
          contentContainerClassName="gap-3 p-4"
          keyboardShouldPersistTaps="handled"
        >
          <View className="gap-1.5">
            <Text className="text-caption text-muted-fg">To</Text>
            <TextField
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              onChangeText={setTo}
              placeholder="name@example.com"
              value={to}
            />
          </View>
          <View className="gap-1.5">
            <Text className="text-caption text-muted-fg">Cc</Text>
            <TextField
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              onChangeText={setCc}
              placeholder="Optional"
              value={cc}
            />
          </View>
          <View className="gap-1.5">
            <Text className="text-caption text-muted-fg">Subject</Text>
            <TextField onChangeText={setSubject} value={subject} />
          </View>
          <View className="gap-1.5">
            <Text className="text-caption text-muted-fg">Message</Text>
            <TextField
              className="min-h-64 py-3"
              multiline
              onChangeText={setBody}
              placeholder="Write your message"
              style={{ textAlignVertical: "top" }}
              value={body}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
};

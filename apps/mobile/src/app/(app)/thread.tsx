import { useLocalSearchParams } from "expo-router";

import { ThreadScreen } from "#/features/message-thread/components/thread-screen";

const ThreadRoute = () => {
  const { threadId } = useLocalSearchParams<{ threadId?: string }>();
  if (threadId === undefined || threadId.length === 0) {
    return null;
  }
  return <ThreadScreen threadId={threadId} />;
};

export default ThreadRoute;

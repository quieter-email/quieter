export type DailyBriefSource = {
  messageId: string;
  threadId: string;
  subject: string;
  fromName?: string;
};

export type DailyBriefItem = {
  id: string;
  title: string;
  summary: string;
  reason: string;
  group: string;
  priority: number;
  urgent: boolean;
  urgentAddition?: boolean;
  sources: DailyBriefSource[];
  deferredUntil: string | null;
};

export type DailyBriefView = {
  settings: {
    enabled: boolean;
    scheduleEnabled: boolean;
    localTime: string;
    timeZone: string;
  };
  edition: {
    id: string;
    generatedAt: string;
    updatedAt: string;
    localDate: string;
  } | null;
  items: DailyBriefItem[];
  generationInProgress: boolean;
  lastError: string | null;
  stale: boolean;
};

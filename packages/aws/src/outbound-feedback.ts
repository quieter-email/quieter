import { withRequestDatabaseClient } from "@quieter/database/client";
import { serverEnv } from "@quieter/env/server";
import { recordOrganizationMailFeedback } from "@quieter/orpc/organization-mail-delivery";
import { parseSesFeedbackNotification } from "@quieter/orpc/ses-feedback";

import { reportAwsError } from "./sentry";

export { parseSesFeedbackNotification } from "@quieter/orpc/ses-feedback";
type SnsNotification = {
  Message: string;
  MessageId: string;
  TopicArn: string;
  Type: string;
};

type SnsEvent = {
  Records: {
    Sns: SnsNotification;
  }[];
};

const processNotification = async (notification: SnsNotification) => {
  const feedback = parseSesFeedbackNotification(
    notification,
    serverEnv.SES_FEEDBACK_TOPIC_ARN
  );
  if (feedback === null) {
    return;
  }
  await recordOrganizationMailFeedback(feedback);
};

export const handler = async (event: SnsEvent) => {
  await withRequestDatabaseClient(async () => {
    await Promise.all(
      event.Records.map(async (record) => {
        try {
          await processNotification(record.Sns);
        } catch (error) {
          await reportAwsError(error, "MailOutboundFeedbackProcessor");
          throw error;
        }
      })
    );
  });
};

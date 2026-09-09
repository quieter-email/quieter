import type { RouterOutputs } from "@quieter/orpc";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, test } from "vite-plus/test";

import { applyDeliveryChange } from "./delivery-adapter";

describe("delivery and recovery", () => {
  test("updates delivery recipients immediately without overwriting another mailbox or its event history", () => {
    const client = new QueryClient();
    const detail = {
      events: [],
      messageId: "provider-message",
      recipients: [
        {
          lastEventAt: new Date(0),
          recipient: "test@example.test",
          status: "sent" as const,
        },
      ],
    };
    client.setQueryData(["message-delivery", "first", "message"], detail);
    client.setQueryData(["message-delivery", "second", "message"], detail);
    client.setQueryData(["message-delivery-list", "first", ["message"]], {
      message: ["sent"],
    });
    applyDeliveryChange(client, "first", {
      data: {
        kind: "delivery",
        value: {
          messageId: "message",
          recipients: [
            {
              lastEventAt: new Date(1).toISOString(),
              recipient: "test@example.test",
              status: "delivered",
            },
          ],
          threadId: "thread",
          updatedAt: new Date(1).toISOString(),
        },
      },
      id: "message",
      kind: "delivery",
      version: "1",
    });
    expect(
      client.getQueryData<RouterOutputs["mail"]["getMessageDelivery"]>([
        "message-delivery",
        "first",
        "message",
      ])?.recipients[0].status
    ).toBe("delivered");
    expect(
      client.getQueryData(["message-delivery", "second", "message"])
    ).toStrictEqual(detail);
    expect(
      client.getQueryData(["message-delivery-list", "first", ["message"]])
    ).toStrictEqual({ message: ["delivered"] });
    client.clear();
  });
});

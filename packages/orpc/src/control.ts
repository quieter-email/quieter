import { ORPCError } from "@orpc/server";
import * as audienceSchemas from "@quieter/mail/audiences";
import * as campaignSchemas from "@quieter/mail/campaigns";
import { controlOperations } from "@quieter/mail/control";
import type { ControlOperation } from "@quieter/mail/control";

import * as audiences from "./audiences/service";
import * as campaigns from "./campaigns/service";
import { assertGrowthAccess } from "./growth-access";
import type { GrowthActor } from "./growth-access";

export const executeControlOperation = async (
  actor: GrowthActor,
  operation: ControlOperation,
  input: unknown
): Promise<unknown> => {
  const contract = controlOperations[operation];
  await assertGrowthAccess(actor, contract.scope);
  const parsed = contract.input.safeParse(input);
  if (!parsed.success) {
    throw new ORPCError("BAD_REQUEST", {
      data: { issues: parsed.error.issues },
      message: "The request contains invalid fields.",
    });
  }
  const scoped = { ...parsed.data, organizationId: actor.organizationId };
  let result: unknown;
  switch (operation) {
    case "audiences.list": {
      result = await audiences.list(
        actor,
        audienceSchemas.audienceListInputSchema.parse(scoped)
      );
      break;
    }
    case "audiences.get": {
      result = await audiences.get(
        actor,
        audienceSchemas.audienceGetInputSchema.parse(scoped)
      );
      break;
    }
    case "audiences.create": {
      result = await audiences.create(
        actor,
        audienceSchemas.audienceCreateInputSchema.parse(scoped)
      );
      break;
    }
    case "audiences.update": {
      result = await audiences.update(
        actor,
        audienceSchemas.audienceUpdateInputSchema.parse(scoped)
      );
      break;
    }
    case "audiences.listContacts": {
      result = await audiences.listContacts(
        actor,
        audienceSchemas.audienceListContactsInputSchema.parse(scoped)
      );
      break;
    }
    case "audiences.registerContact": {
      result = await audiences.registerContact(
        actor,
        audienceSchemas.audienceRegisterContactInputSchema.parse(scoped)
      );
      break;
    }
    case "audiences.importContacts": {
      result = await audiences.importContacts(
        actor,
        audienceSchemas.audienceImportContactsInputSchema.parse(scoped)
      );
      break;
    }
    case "audiences.updateContact": {
      result = await audiences.updateContact(
        actor,
        audienceSchemas.audienceUpdateContactInputSchema.parse(scoped)
      );
      break;
    }
    case "audiences.unsubscribeContact": {
      result = await audiences.unsubscribeContact(
        actor,
        audienceSchemas.audienceUnsubscribeContactInputSchema.parse(scoped)
      );
      break;
    }
    case "audiences.resubscribeContact": {
      result = await audiences.resubscribeContact(
        actor,
        audienceSchemas.audienceResubscribeContactInputSchema.parse(scoped)
      );
      break;
    }
    case "audiences.removeContact": {
      result = await audiences.removeContact(
        actor,
        audienceSchemas.audienceRemoveContactInputSchema.parse(scoped)
      );
      break;
    }
    case "audiences.setSuppression": {
      result = await audiences.setSuppression(
        actor,
        audienceSchemas.audienceSetSuppressionInputSchema.parse(scoped)
      );
      break;
    }
    case "audiences.listHistory": {
      result = await audiences.listHistory(
        actor,
        audienceSchemas.audienceListHistoryInputSchema.parse(scoped)
      );
      break;
    }
    case "audiences.listSegments": {
      result = await audiences.listSegments(
        actor,
        audienceSchemas.audienceListSegmentsInputSchema.parse(scoped)
      );
      break;
    }
    case "audiences.createSegment": {
      result = await audiences.createSegment(
        actor,
        audienceSchemas.audienceCreateSegmentInputSchema.parse(scoped)
      );
      break;
    }
    case "audiences.updateSegment": {
      result = await audiences.updateSegment(
        actor,
        audienceSchemas.audienceUpdateSegmentInputSchema.parse(scoped)
      );
      break;
    }
    case "audiences.deleteSegment": {
      result = await audiences.deleteSegment(
        actor,
        audienceSchemas.audienceDeleteSegmentInputSchema.parse(scoped)
      );
      break;
    }
    case "campaigns.list": {
      result = await campaigns.listCampaigns(
        actor,
        campaignSchemas.campaignListInputSchema.parse(scoped)
      );
      break;
    }
    case "campaigns.get": {
      result = await campaigns.getCampaign(
        actor,
        campaignSchemas.campaignGetInputSchema.parse(scoped)
      );
      break;
    }
    case "campaigns.create": {
      result = await campaigns.createCampaign(
        actor,
        campaignSchemas.campaignCreateInputSchema.parse(scoped)
      );
      break;
    }
    case "campaigns.update": {
      result = await campaigns.updateCampaign(
        actor,
        campaignSchemas.campaignUpdateInputSchema.parse(scoped)
      );
      break;
    }
    case "campaigns.preview": {
      result = await campaigns.previewCampaign(
        actor,
        campaignSchemas.campaignPreviewInputSchema.parse(scoped)
      );
      break;
    }
    case "campaigns.send": {
      result = await campaigns.sendCampaign(
        actor,
        campaignSchemas.campaignSendInputSchema.parse(scoped)
      );
      break;
    }
    case "campaigns.cancel": {
      result = await campaigns.cancelCampaign(
        actor,
        campaignSchemas.campaignCancelInputSchema.parse(scoped)
      );
      break;
    }
    case "campaigns.retry": {
      result = await campaigns.retryCampaign(
        actor,
        campaignSchemas.campaignRetryInputSchema.parse(scoped)
      );
      break;
    }
    default: {
      throw new ORPCError("BAD_REQUEST", {
        message: "Unknown control operation.",
      });
    }
  }
  return contract.output.parse(result);
};

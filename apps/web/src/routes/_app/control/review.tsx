import { createFileRoute } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";
import { z } from "zod";

import { ControlReviewPage } from "#/components/control-review/control-review-page";

const ControlReviewRoute = () => {
  const { approvalId } = Route.useSearch();
  return <ControlReviewPage approvalId={approvalId ?? ""} />;
};

export const Route = createFileRoute("/_app/control/review")({
  validateSearch: zodValidator(z.object({ approvalId: z.string().optional() })),
  ssr: false,
  component: ControlReviewRoute,
});

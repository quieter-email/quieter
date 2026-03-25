import type { InferClientInputs, InferClientOutputs } from "@orpc/client";
import type { RouterClient } from "@orpc/server";
import type { AppRouter } from "./router";

type AppRouterClient = RouterClient<AppRouter>;

export type RouterInputs = InferClientInputs<AppRouterClient>;
export type RouterOutputs = InferClientOutputs<AppRouterClient>;
export type { AppRouter };

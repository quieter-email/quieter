import { localAppOrigin, productionAppOrigin } from "@quieter/env/hosts";

export const { stage } = $app;
export const production = stage === "production";

export const getEnvironmentValue = (name: string, fallback: string) => {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
};

export const appOrigin = production
  ? productionAppOrigin
  : getEnvironmentValue("BETTER_AUTH_URL", localAppOrigin);

export const deploymentEnvironment = production ? "production" : "local";

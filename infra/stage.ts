export const { stage } = $app;
export const production = stage === "production";

export const getEnvironmentValue = (name: string, fallback: string) => {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
};

export const appOrigin = production
  ? "https://quieter.email"
  : getEnvironmentValue("BETTER_AUTH_URL", "http://localhost:3000");

export const deploymentEnvironment = production ? "production" : "local";

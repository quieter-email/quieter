import type { HealthyRelease, ServiceVersion } from "./schema.ts";

export const assertCompatible = (services: ServiceVersion[]) => {
  const byName = new Map(services.map((service) => [service.service, service]));
  if (
    byName.size !== services.length ||
    new Set(services.map((service) => service.scriptName)).size !==
      services.length
  ) {
    throw new Error("Release services and physical Workers must be unique.");
  }
  for (const service of services) {
    for (const [dependency, contracts] of Object.entries(
      service.requirements
    )) {
      const target = byName.get(dependency);
      if (
        !target ||
        contracts.some((contract) => !target.contracts.includes(contract))
      ) {
        throw new Error(
          `Unsupported contract between ${service.service} and ${dependency}.`
        );
      }
    }
  }
};

export const planPromotion = (
  baseline: HealthyRelease,
  candidate: HealthyRelease
) => {
  assertCompatible(baseline.services);
  assertCompatible(candidate.services);
  const previous = new Map(
    baseline.services.map((service) => [service.service, service])
  );
  if (previous.size !== candidate.services.length) {
    throw new Error(
      "Adding or removing runtimes requires an infrastructure transition."
    );
  }
  assertCompatible(
    baseline.services.map((service) => ({
      ...service,
      requirements:
        candidate.services.find((next) => next.service === service.service)
          ?.requirements ?? service.requirements,
    }))
  );
  const remaining = candidate.services.filter((service) => {
    const old = previous.get(service.service);
    if (
      !old ||
      old.scriptName !== service.scriptName ||
      old.bindingGeneration !== service.bindingGeneration
    ) {
      throw new Error(
        "Runtime promotion cannot change resource or binding generations."
      );
    }
    if (
      old.versionId === service.versionId &&
      JSON.stringify(old) !== JSON.stringify(service)
    ) {
      throw new Error(
        "An unchanged version cannot change its recorded artifact or contracts."
      );
    }
    return old.versionId !== service.versionId;
  });
  const order: string[] = [];
  let active = [...baseline.services];
  while (remaining.length > 0) {
    // oxlint-disable-next-line no-loop-func -- findIndex runs synchronously against this iteration's active map.
    const index = remaining.findIndex((service) => {
      const proposed = active.map((current) =>
        current.service === service.service ? service : current
      );
      try {
        assertCompatible(proposed);
        return true;
      } catch {
        return false;
      }
    });
    if (index === -1) {
      throw new Error(
        "No compatible promotion order exists. Ship additive contracts first."
      );
    }
    const [next] = remaining.splice(index, 1);
    active = active.map((current) =>
      current.service === next.service ? next : current
    );
    order.push(next.service);
  }
  return order;
};

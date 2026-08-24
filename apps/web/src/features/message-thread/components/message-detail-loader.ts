export const loadMessageDetail = async () =>
  await import("./message-detail").then(({ MessageDetail: Component }) => ({
    default: Component,
  }));

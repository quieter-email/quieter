export const lazyAuth = <Auth extends object>(create: () => Auth): Auth => {
  let instance: Auth | undefined;
  // Module loading can run outside the request's database scope in Workers.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return new Proxy({} as Auth, {
    get(_target, property): unknown {
      instance ??= create();
      return Reflect.get(instance, property);
    },
  });
};

// Minimal stubs for remark-math / remark-parse / remark-gfm / unified in headless game sidecar.
const noopPlugin = () => undefined;
export default noopPlugin;

export function unified() {
  const chain = {
    use() {
      return chain;
    },
    freeze() {
      return chain;
    },
    parse(_source: string) {
      return { type: "root" as const, children: [] as Array<never> };
    },
  };
  return chain;
}

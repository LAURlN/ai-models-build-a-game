export const DataType = {
  I32: 0,
  U32: 1,
  String: 2,
  External: 3,
  BigInt: 4,
  U8Array: 5,
  WString: 6,
} as const;

export function open(_options: { library: string; path: string }): void {}

export function load<T = Promise<{ value: number; errnoCode?: number } | number>>(_options: {
  library: string;
  funcName: string;
  retType: unknown;
  paramsType: ReadonlyArray<unknown>;
  paramsValue?: ReadonlyArray<unknown>;
  errno?: boolean;
  runInNewThread?: boolean;
}): T {
  return Promise.reject(new Error("ffi-rs is disabled in headless game sidecar")) as unknown as T;
}

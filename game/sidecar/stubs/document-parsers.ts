export const characterEntities: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
};

export class SaxesParser {
  on(_event: string, _handler: (...args: any[]) => void): void {}
  write(_chunk: string): this {
    return this;
  }
  close(): this {
    return this;
  }
}

export function open(_path: string, _options?: any, cb?: (err: Error | null, zipfile?: any) => void): void {
  cb?.(new Error("yauzl is disabled in headless game sidecar"));
}

export function fromBuffer(
  _buf: Buffer,
  _options?: any,
  cb?: (err: Error | null, zipfile?: any) => void,
): void {
  cb?.(new Error("yauzl is disabled in headless game sidecar"));
}

export const none = Symbol("none");
export type Many<T> = T | T[];
export class Assembler {
  on(_event: string, _handler: (...args: any[]) => void): void {}
  consume(_token: unknown): void {}
}
export type ParserOptions = Record<string, any>;
export type Token = { name: string; value?: unknown };
export function parser(_options?: ParserOptions): any {
  throw new Error("stream-json is disabled in headless game sidecar");
}
export function makeStreamParser(_options?: ParserOptions): any {
  return parser();
}

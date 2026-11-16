export class FileFinder {
  static create(): never {
    throw new Error("@ff-labs/fff-node is disabled in headless game sidecar");
  }
}
export type Result<T = unknown> = { ok: boolean; value?: T; error?: string };
export type DirItem = { path: string; relativePath: string };
export type FileItem = { path: string; relativePath: string; fileName: string; modified?: number };
export type GrepCursor = unknown;
export type MixedItem = FileItem | DirItem;
export type WatchEvent = unknown;
export type WatchUnsubscribe = () => void;

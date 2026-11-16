export interface IDisposable {
  dispose(): void;
}

export interface IPty {
  readonly pid: number;
  readonly cols: number;
  readonly rows: number;
  readonly process: string;
  write(data: string): void;
  resize(columns: number, rows: number): void;
  kill(signal?: string): void;
  onData(listener: (data: string) => void): IDisposable;
  onExit(listener: (e: { exitCode: number; signal?: number }) => void): IDisposable;
}

export function spawn(): IPty {
  throw new Error("node-pty is disabled in headless game sidecar");
}

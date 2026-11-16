import type { ChronicleApi } from '../shared/contracts';

declare global {
  interface Window {
    chronicleApi: ChronicleApi;
  }
}

export {};

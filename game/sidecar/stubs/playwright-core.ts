export type CDPSession = Record<string, any>;
export type Browser = Record<string, any>;
export type BrowserContext = Record<string, any>;
export type ConsoleMessage = Record<string, any>;
export type Dialog = Record<string, any>;
export type Download = Record<string, any>;
export type FileChooser = Record<string, any>;
export type Frame = Record<string, any>;
export type Locator = Record<string, any>;
export type Page = Record<string, any>;

export const chromium = {
  async launch(): Promise<Browser> {
    throw new Error("playwright-core is disabled in headless game sidecar");
  },
  async launchPersistentContext(): Promise<BrowserContext> {
    throw new Error("playwright-core is disabled in headless game sidecar");
  },
};

declare module "electron" {
  export type WebContents = {
    id: number;
  };

  export type IpcMainInvokeEvent = {
    sender: WebContents;
  };

  export type OpenDialogReturnValue = {
    canceled: boolean;
    filePaths: string[];
  };

  export class BrowserWindow {
    constructor(options?: unknown);
    static getAllWindows(): BrowserWindow[];
    static fromWebContents(contents: WebContents): BrowserWindow | null;
    once(event: "ready-to-show", listener: () => void): this;
    show(): void;
    loadFile(path: string): Promise<void>;
    setMenuBarVisibility(visible: boolean): void;
  }

  export const app: {
    whenReady(): Promise<void>;
    on(event: "activate" | "window-all-closed", listener: () => void): void;
    quit(): void;
  };

  export const dialog: {
    showOpenDialog(
      window: BrowserWindow,
      options: { properties: string[] },
    ): Promise<OpenDialogReturnValue>;
  };

  export const ipcMain: {
    handle(
      channel: string,
      listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown,
    ): void;
  };

  export const contextBridge: {
    exposeInMainWorld(name: string, api: unknown): void;
  };

  export const ipcRenderer: {
    invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  };
}

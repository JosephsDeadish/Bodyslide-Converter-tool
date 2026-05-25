declare module "electron" {
  export type ContextMenuParams = {
    selectionText: string;
    isEditable: boolean;
    editFlags: {
      canCut: boolean;
      canCopy: boolean;
      canPaste: boolean;
      canSelectAll: boolean;
    };
  };

  export type WebContents = {
    id: number;
    send(channel: string, ...args: unknown[]): void;
    on(
      event: "context-menu",
      listener: (event: unknown, params: ContextMenuParams) => void,
    ): void;
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
    webContents: WebContents;
    once(event: "ready-to-show", listener: () => void): this;
    show(): void;
    loadFile(path: string): Promise<void>;
    setMenuBarVisibility(visible: boolean): void;
  }

  export type MenuItemConstructorOptions = {
    role: "cut" | "copy" | "paste" | "selectAll";
  };

  export const Menu: {
    buildFromTemplate(template: MenuItemConstructorOptions[]): {
      popup(options: { window: BrowserWindow }): void;
    };
  };

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

  export const shell: {
    openExternal(url: string): Promise<void>;
    openPath(fullPath: string): Promise<string>;
  };

  export const ipcMain: {
    handle<TArgs extends unknown[], TResult>(
      channel: string,
      listener: (
        event: IpcMainInvokeEvent,
        ...args: TArgs
      ) => TResult | Promise<TResult>,
    ): void;
    removeHandler(channel: string): void;
  };

  export const contextBridge: {
    exposeInMainWorld(name: string, api: unknown): void;
  };

  export const ipcRenderer: {
    invoke<TResult>(channel: string, ...args: unknown[]): Promise<TResult>;
    on(
      channel: string,
      listener: (event: unknown, ...args: unknown[]) => void,
    ): void;
    off(
      channel: string,
      listener: (event: unknown, ...args: unknown[]) => void,
    ): void;
  };
}

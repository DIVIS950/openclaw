import { BrowserWindow, screen, type BrowserWindowConstructorOptions } from "electron";

interface WindowState {
  x: number;
  y: number;
  width: number;
  height: number;
  isMaximized: boolean;
}

// Track all managed windows
const managedWindows = new Map<number, { window: BrowserWindow; state: WindowState }>();

function getDefaultBounds(): { width: number; height: number; x: number; y: number } {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
  const width = 1400;
  const height = 900;
  return {
    width,
    height,
    x: Math.round((screenWidth - width) / 2),
    y: Math.round((screenHeight - height) / 2),
  };
}

function trackWindowState(window: BrowserWindow): void {
  const id = window.id;

  const updateState = () => {
    if (window.isDestroyed()) return;
    const bounds = window.getBounds();
    const entry = managedWindows.get(id);
    if (entry) {
      entry.state = {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        isMaximized: window.isMaximized(),
      };
    }
  };

  window.on("resize", updateState);
  window.on("move", updateState);
  window.on("maximize", updateState);
  window.on("unmaximize", updateState);

  window.on("closed", () => {
    managedWindows.delete(id);
  });
}

/**
 * Create the main application window. Accepts full BrowserWindowConstructorOptions
 * so the caller (main.ts) can pass webPreferences, frame, etc.
 */
export function createMainWindow(
  options: BrowserWindowConstructorOptions = {},
): BrowserWindow {
  const defaults = getDefaultBounds();

  const window = new BrowserWindow({
    x: defaults.x,
    y: defaults.y,
    width: defaults.width,
    height: defaults.height,
    ...options,
  });

  const bounds = window.getBounds();
  const state: WindowState = {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    isMaximized: false,
  };

  managedWindows.set(window.id, { window, state });
  trackWindowState(window);

  return window;
}

/**
 * Create a lightweight popup/child window for external links or auth flows.
 */
export function createPopupWindow(url: string): BrowserWindow {
  const popup = new BrowserWindow({
    width: 1024,
    height: 768,
    minWidth: 400,
    minHeight: 300,
    frame: true,
    backgroundColor: "#050510",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  popup.loadURL(url);

  const bounds = popup.getBounds();
  const state: WindowState = {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    isMaximized: false,
  };

  managedWindows.set(popup.id, { window: popup, state });
  trackWindowState(popup);

  return popup;
}

/**
 * Get the saved state for a window by its id.
 */
export function getWindowState(windowId: number): WindowState | undefined {
  return managedWindows.get(windowId)?.state;
}

/**
 * Get all currently open managed windows.
 */
export function getAllWindows(): BrowserWindow[] {
  return [...managedWindows.values()].map((entry) => entry.window);
}

/**
 * Get the focused window, falling back to the first managed window.
 */
export function getFocusedWindow(): BrowserWindow | undefined {
  return (
    BrowserWindow.getFocusedWindow() ??
    managedWindows.values().next().value?.window
  );
}

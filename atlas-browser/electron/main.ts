import {
  app,
  BrowserWindow,
  globalShortcut,
  session,
  type WebContents,
} from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createMainWindow, createPopupWindow } from "./window-manager.js";
import { registerIpcHandlers } from "./ipc-handlers.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const IS_DEV = !app.isPackaged;
const VITE_DEV_SERVER_URL = "http://localhost:5173";
const PRELOAD_PATH = path.join(__dirname, "preload.js");
const RENDERER_PATH = path.join(__dirname, "../dist/index.html");

let mainWindow: BrowserWindow | null = null;

function createWindow(): BrowserWindow {
  mainWindow = createMainWindow({
    width: 1400,
    height: 900,
    minWidth: 1400,
    minHeight: 900,
    frame: false,
    titleBarStyle: "hidden",
    backgroundColor: "#050510",
    transparent: false,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: PRELOAD_PATH,
      sandbox: true,
      spellcheck: true,
      webviewTag: false,
    },
  });

  // Graceful show once ready to avoid white flash
  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  if (IS_DEV) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(RENDERER_PATH);
  }

  // Handle new-window requests (e.g. target="_blank") as popups
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    createPopupWindow(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  return mainWindow;
}

function registerGlobalShortcuts(): void {
  // New tab
  globalShortcut.register("CommandOrControl+T", () => {
    mainWindow?.webContents.send("shortcut:new-tab");
  });

  // Close tab
  globalShortcut.register("CommandOrControl+W", () => {
    mainWindow?.webContents.send("shortcut:close-tab");
  });

  // Reload
  globalShortcut.register("CommandOrControl+R", () => {
    mainWindow?.webContents.send("shortcut:reload");
  });

  // Focus address bar
  globalShortcut.register("CommandOrControl+L", () => {
    mainWindow?.webContents.send("shortcut:focus-address-bar");
  });

  // Toggle dev tools (dev only)
  if (IS_DEV) {
    globalShortcut.register("CommandOrControl+Shift+I", () => {
      mainWindow?.webContents.toggleDevTools();
    });
  }

  // Navigate tabs
  globalShortcut.register("CommandOrControl+Tab", () => {
    mainWindow?.webContents.send("shortcut:next-tab");
  });

  globalShortcut.register("CommandOrControl+Shift+Tab", () => {
    mainWindow?.webContents.send("shortcut:prev-tab");
  });

  // AI assistant
  globalShortcut.register("CommandOrControl+Shift+A", () => {
    mainWindow?.webContents.send("shortcut:toggle-ai");
  });
}

// Configure CSP for the session
function configureSession(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'",
        ],
      },
    });
  });
}

// --- App lifecycle ---

app.whenReady().then(() => {
  configureSession();
  registerIpcHandlers();
  createWindow();
  registerGlobalShortcuts();

  app.on("activate", () => {
    // macOS dock click with no windows open
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

export { mainWindow };

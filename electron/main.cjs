/**
 * The desktop shell.
 *
 * Keyframe Studio's editor is the same code the web build runs; this process
 * gives it a window, native file dialogs and a real path to save to, so the
 * app behaves like a desktop application rather than a page.
 */

const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const { promises: fs } = require('node:fs');
const path = require('node:path');

/** Set by `npm run dev:desktop`; empty in a packaged build. */
const devServerUrl = process.env.VITE_DEV_SERVER_URL || '';

const PROJECT_FILTERS = [
  { name: 'Keyframe Studio project', extensions: ['json'] },
  { name: 'All files', extensions: ['*'] },
];

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 950,
    minWidth: 1024,
    minHeight: 640,
    // The editor's own background, so startup does not flash white.
    backgroundColor: '#1b1b1b',
    show: false,
    autoHideMenuBar: true,
    title: 'Keyframe Studio',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

  // The editor owns every key the way After Effects does, so there is no
  // application menu to take Ctrl+N, Ctrl+O or Ctrl+W away from it.
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F12') {
      mainWindow.webContents.toggleDevTools();
      event.preventDefault();
    }
    if (input.key === 'F5' || (input.control && input.shift && input.key.toLowerCase() === 'r')) {
      mainWindow.webContents.reloadIgnoringCache();
      event.preventDefault();
    }
  });

  // Links open in the user's browser, never in a second app window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  if (devServerUrl) mainWindow.loadURL(devServerUrl);
  else mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  mainWindow.on('closed', () => { mainWindow = null; });
}

// -- native file access ------------------------------------------------------

ipcMain.handle('project:open', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open Project',
    filters: PROJECT_FILTERS,
    properties: ['openFile'],
  });
  const filePath = result.filePaths[0];
  if (result.canceled || !filePath) return null;
  return { path: filePath, name: path.basename(filePath), text: await fs.readFile(filePath, 'utf8') };
});

ipcMain.handle('project:save', async (_event, request) => {
  let filePath = request.path;
  // Save writes straight back to the open file; Save As, and the first save
  // of a new project, ask where it should go.
  if (!filePath || request.forcePicker) {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Save Project',
      defaultPath: filePath || request.suggestedName,
      filters: PROJECT_FILTERS,
    });
    if (result.canceled || !result.filePath) return null;
    filePath = result.filePath;
  }
  await fs.writeFile(filePath, request.text, 'utf8');
  return { path: filePath, name: path.basename(filePath) };
});

ipcMain.handle('file:save', async (_event, request) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save',
    defaultPath: request.suggestedName,
    filters: request.filters?.length ? request.filters : [{ name: 'All files', extensions: ['*'] }],
  });
  if (result.canceled || !result.filePath) return null;
  await fs.writeFile(result.filePath, Buffer.from(request.data));
  return { path: result.filePath, name: path.basename(result.filePath) };
});

ipcMain.handle('shell:reveal', (_event, filePath) => {
  if (filePath) shell.showItemInFolder(filePath);
});

// -- lifecycle ---------------------------------------------------------------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

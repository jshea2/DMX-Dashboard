const { app, BrowserWindow, shell, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const http = require('http');
const dns = require('dns').promises;
const { fork } = require('child_process');

const DEFAULT_PORT = 3000;
const isDev = !app.isPackaged;
const RELEASES_URL = 'https://github.com/jshea2/DMX-Dashboard/releases';

let serverProcess = null;
let serverLogPath = null;
let serverLogStream = null;
let updaterLogPath = null;

const logUpdater = (message) => {
  try {
    if (!updaterLogPath) {
      updaterLogPath = path.join(app.getPath('userData'), 'updater.log');
    }
    fs.appendFileSync(updaterLogPath, `[${new Date().toISOString()}] ${message}\n`);
  } catch (err) {
    // Ignore logging failures.
  }
};

app.setName('DMX Dashboard');

const getConfigPath = () => {
  if (process.env.DMX_CONFIG_PATH) {
    return process.env.DMX_CONFIG_PATH;
  }
  if (!app.isPackaged) {
    return path.join(app.getAppPath(), 'server', 'config.json');
  }
  return path.join(app.getPath('userData'), 'config.json');
};

const readServerPort = () => {
  try {
    const raw = fs.readFileSync(getConfigPath(), 'utf8');
    const cfg = JSON.parse(raw);
    if (Number.isInteger(cfg?.server?.port)) {
      return cfg.server.port;
    }
  } catch (err) {
    // Ignore missing/invalid config - fall back to default port.
  }
  return DEFAULT_PORT;
};

const getAutoUpdateEnabled = () => {
  try {
    const raw = fs.readFileSync(getConfigPath(), 'utf8');
    const cfg = JSON.parse(raw);
    if (typeof cfg?.webServer?.autoUpdateCheck === 'boolean') {
      return cfg.webServer.autoUpdateCheck;
    }
  } catch (err) {
    // Ignore missing/invalid config - fall back to enabled.
  }
  return true;
};

const hasInternet = async (timeoutMs = 2000) => {
  const timeout = new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs));
  const lookup = dns.lookup('github.com').then(() => true).catch(() => false);
  return Promise.race([lookup, timeout]);
};

const waitForServer = (port, retries = 60, delayMs = 250) => {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const tryOnce = () => {
      attempts += 1;
      const req = http.get(`http://127.0.0.1:${port}/api/state`, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 500) {
          resolve();
          return;
        }
        if (attempts >= retries) {
          reject(new Error(`Server not ready on port ${port}`));
          return;
        }
        setTimeout(tryOnce, delayMs);
      });
      req.on('error', () => {
        if (attempts >= retries) {
          reject(new Error(`Server not ready on port ${port}`));
          return;
        }
        setTimeout(tryOnce, delayMs);
      });
    };
    tryOnce();
  });
};

const getPortFromUrl = (urlValue) => {
  try {
    const parsed = new URL(urlValue);
    if (parsed.port) {
      return Number(parsed.port);
    }
    return parsed.protocol === 'https:' ? 443 : 80;
  } catch (err) {
    return null;
  }
};

const startServer = () => {
  const configPath = getConfigPath();
  const serverEntry = path.join(app.getAppPath(), 'server', 'server.js');

  if (isDev && process.env.ELECTRON_START_URL) {
    return readServerPort();
  }

  serverLogPath = path.join(app.getPath('userData'), 'server.log');
  serverLogStream = fs.createWriteStream(serverLogPath, { flags: 'a' });

  serverProcess = fork(serverEntry, [], {
    execPath: process.execPath,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      ELECTRON_RUN_AS_NODE: '1',
      DMX_CONFIG_PATH: configPath
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc']
  });

  if (serverProcess.stdout && serverLogStream) {
    serverProcess.stdout.pipe(serverLogStream);
  }
  if (serverProcess.stderr && serverLogStream) {
    serverProcess.stderr.pipe(serverLogStream);
  }

  serverProcess.on('exit', (code, signal) => {
    if (serverLogStream && !serverLogStream.writableEnded) {
      serverLogStream.write(`\n[server] exited code=${code} signal=${signal}\n`);
    }
  });

  return readServerPort();
};

const showLoadError = (win, message) => {
  const safeMessage = message.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const logNote = serverLogPath ? `Server log: ${serverLogPath}` : 'Server log not available yet.';
  const html = `
    <html>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background:#1a1a2e; color:#fff; padding:32px;">
        <h2>DMX Dashboard failed to load</h2>
        <p>${safeMessage}</p>
        <p>${logNote}</p>
        <p>Try restarting the app. If it still fails, send the log file.</p>
      </body>
    </html>
  `;
  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
};

const createWindow = async () => {
  const port = startServer();
  const startUrl = process.env.ELECTRON_START_URL || `http://127.0.0.1:${port}`;
  const waitPort = getPortFromUrl(startUrl) || port;
  let serverReady = true;
  try {
    await waitForServer(waitPort);
  } catch (err) {
    serverReady = false;
    console.warn('[Electron] Server wait timeout:', err.message);
  }

  const win = new BrowserWindow({
    width: 850,
    height: 950,
    minWidth: 400,
    minHeight: 400,
    title: 'DMX Dashboard',
    backgroundColor: '#1a1a2e',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  if (serverReady) {
    win.loadURL(startUrl);
  } else {
    showLoadError(win, `Server did not respond on ${startUrl}.`);
  }

  win.webContents.on('did-fail-load', (_event, _code, desc) => {
    showLoadError(win, `Failed to load ${startUrl}. ${desc}`);
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
};

const setupAutoUpdater = () => {
  if (isDev) return;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on('update-available', async (info) => {
    logUpdater(`Update available: ${JSON.stringify({ version: info?.version, files: info?.files?.map(f => f?.url) })}`);
    const currentVersion = app.getVersion();
    const result = await dialog.showMessageBox({
      type: 'info',
      title: 'Update available',
      message: `DMX Dashboard ${info.version} is available`,
      detail: `Current version: ${currentVersion}\nNew version: ${info.version}\n\nWould you like to download and install now?`,
      buttons: ['Download and Install', 'View Releases', 'Later'],
      defaultId: 0,
      cancelId: 2
    });

    if (result.response === 1) {
      shell.openExternal(RELEASES_URL);
      return;
    }

    if (result.response === 0) {
      try {
        await autoUpdater.downloadUpdate();
      } catch (err) {
        console.warn('[Updater] Download failed:', err);
        logUpdater(`Download failed: ${err?.message || err}`);
        dialog.showMessageBox({
          type: 'error',
          title: 'Update failed',
          message: 'Failed to download the update.',
          detail: `Please check your internet connection or download manually from the releases page.\n\nLog: ${updaterLogPath || path.join(app.getPath('userData'), 'updater.log')}`,
          buttons: ['OK', 'Open Releases'],
          defaultId: 0,
          cancelId: 0
        }).then(({ response }) => {
          if (response === 1) {
            shell.openExternal(RELEASES_URL);
          }
        });
      }
    }
  });

  autoUpdater.on('update-downloaded', () => {
    logUpdater('Update downloaded. Quitting to install.');
    autoUpdater.quitAndInstall();
  });

  autoUpdater.on('error', (err) => {
    console.warn('[Updater] Error:', err?.message || err);
    logUpdater(`Updater error: ${err?.message || err}`);
  });
};

const checkForUpdatesOnLaunch = async () => {
  if (isDev) return;
  if (!getAutoUpdateEnabled()) return;
  const online = await hasInternet();
  if (!online) {
    console.log('[Updater] Offline - skipping update check.');
    logUpdater('Offline - skipping update check.');
    return;
  }
  try {
    logUpdater('Checking for updates...');
    await autoUpdater.checkForUpdates();
  } catch (err) {
    console.warn('[Updater] Update check failed:', err?.message || err);
    logUpdater(`Update check failed: ${err?.message || err}`);
  }
};

app.whenReady().then(async () => {
  await createWindow();
  setupAutoUpdater();
  checkForUpdatesOnLaunch();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', () => {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
  if (serverLogStream) {
    serverLogStream.end();
    serverLogStream = null;
  }
});

const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { fork } = require('child_process');

const DEFAULT_PORT = 3000;
const isDev = !app.isPackaged;

let serverProcess = null;

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

  serverProcess = fork(serverEntry, [], {
    env: {
      ...process.env,
      NODE_ENV: 'production',
      DMX_CONFIG_PATH: configPath
    },
    stdio: 'inherit'
  });

  return readServerPort();
};

const createWindow = async () => {
  const port = startServer();
  const startUrl = process.env.ELECTRON_START_URL || `http://127.0.0.1:${port}`;
  const waitPort = getPortFromUrl(startUrl) || port;
  try {
    await waitForServer(waitPort);
  } catch (err) {
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

  win.loadURL(startUrl);

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
};

app.whenReady().then(createWindow);

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
});

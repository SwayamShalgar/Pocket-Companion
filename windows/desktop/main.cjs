const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  ipcMain,
  dialog,
  clipboard,
  utilityProcess
} = require('electron');

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');

let win;
let tray;
let child;
let timer;

let bound = '';
let quitting = false;
let stopped = false;

let status = 'Starting…';
let data;
let settings;
let token;

let chain = Promise.resolve();

function serial(job) {
  const result = chain.then(job);
  chain = result.catch(() => {});
  return result;
}

function write(name, value) {
  const target = path.join(data, name);

  fs.writeFileSync(
    target + '.tmp',
    JSON.stringify(value, null, 2)
  );

  fs.renameSync(target + '.tmp', target);
}

function snapshot() {
  const config = JSON.parse(
    fs.readFileSync(path.join(data, 'config.json'), 'utf8')
  );

  return {
    status,
    address: bound ? `http://${bound}:4782` : '',
    stopped,
    startup: app.getLoginItemSettings().openAtLogin,
    controls: settings.controls,
    folders: config.roots,
    data
  };
}

function publish() {
  if (win && !win.isDestroyed()) {
    win.webContents.send('state', snapshot());
  }
}

function show() {
  if (win) {
    win.show();
    win.focus();
  }
}

async function stopBackend() {
  const old = child;

  child = null;
  bound = '';

  if (!old) return;

  await new Promise(resolve => {
    old.once('exit', resolve);
    old.kill();
  });
}

async function tailscaleIP() {
  const exe = path.join(
    process.env.ProgramFiles || 'C:/Program Files',
    'Tailscale',
    'tailscale.exe'
  );

  const output = await new Promise((resolve, reject) => {
    execFile(
      exe,
      ['ip', '-4'],
      {
        windowsHide: true,
        timeout: 4000
      },
      (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout);
      }
    );
  });

  const ip = output.trim().split(/\s+/)[0];
  const pieces = ip.split('.').map(Number);

  if (
    pieces.length !== 4 ||
    pieces[0] !== 100 ||
    pieces[1] < 64 ||
    pieces[1] > 127 ||
    !pieces.every(
      n => Number.isInteger(n) && n >= 0 && n <= 255
    )
  ) {
    throw new Error('No Tailscale IPv4 address.');
  }

  const available = Object.values(os.networkInterfaces())
    .flat()
    .some(item => item && item.address === ip);

  if (!available) {
    throw new Error('Tailscale is not connected.');
  }

  return ip;
}

async function reconcile() {
  if (quitting || stopped) return;

  let ip;

  try {
    ip = await tailscaleIP();
  } catch {
    await stopBackend();

    status =
      'Waiting for Tailscale. Install it and connect this laptop.';

    publish();
    return;
  }

  if (child && bound === ip) return;

  await stopBackend();

  status = 'Starting companion…';
  bound = ip;

  const current = utilityProcess.fork(
    path.join(__dirname, 'worker.cjs'),
    [],
    {
      cwd: data,
      stdio: 'pipe',
      serviceName: 'Pocket Companion backend',

      env: {
        ...process.env,
        COMPANION_DATA_DIR: data,
        COMPANION_DESKTOP: '1',
        COMPANION_CONTROLS: settings.controls ? '1' : '0',
        HOST: ip,
        PORT: '4782',
        TOKEN: token
      }
    }
  );

  child = current;

  // Drain output so the backend cannot block on a full pipe.
  current.stdout?.on('data', () => {});
  current.stderr?.on('data', () => {});

  current.on('message', message => {
    if (child !== current) return;

    status = message.ready
      ? 'Ready. Connect your phone using the address and token.'
      : message.error || 'Backend error.';

    publish();
  });

  current.once('exit', () => {
    if (child !== current) return;

    child = null;
    bound = '';

    if (!status.startsWith('Port ')) {
      status =
        'Backend stopped. Retrying in a few seconds.';
    }

    publish();
  });

  publish();
}

function createWindow() {
  win = new BrowserWindow({
    width: 740,
    height: 760,
    minWidth: 560,
    minHeight: 600,
    show: false,
    backgroundColor: '#0b1020',

    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  win.setMenu(null);

  win.webContents.setWindowOpenHandler(() => ({
    action: 'deny'
  }));

  win.webContents.on('will-navigate', event => {
    event.preventDefault();
  });

  win.loadFile(path.join(__dirname, 'index.html'));
  win.once('ready-to-show', show);

  win.on('close', event => {
    if (!quitting) {
      event.preventDefault();
      win.hide();
    }
  });

  const icon = nativeImage
    .createFromPath(path.join(__dirname, 'icon.png'))
    .resize({ width: 24, height: 24 });

  tray = new Tray(icon);
  tray.setToolTip('Pocket Companion');

  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: 'Open Pocket Companion',
        click: show
      },
      {
        label: 'Quit',
        click: () => app.quit()
      }
    ])
  );

  tray.on('double-click', show);
}

function handle(name, fn) {
  ipcMain.handle(name, (event, ...args) => {
    if (
      event.sender !== win.webContents ||
      event.senderFrame !== win.webContents.mainFrame
    ) {
      throw new Error('Untrusted request.');
    }

    return serial(() => fn(...args));
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', show);

  app.whenReady()
    .then(() => {
      data = path.join(
        app.getPath('userData'),
        'companion'
      );

      fs.mkdirSync(data, { recursive: true });

      const envFile = path.join(data, '.env');

      if (!fs.existsSync(envFile)) {
        fs.writeFileSync(
          envFile,
          [
            `TOKEN=${crypto.randomBytes(32).toString('hex')}`,
            'OPENAI_API_KEY=',
            'OPENAI_MODEL=gpt-4.1-mini',
            ''
          ].join('\n')
        );
      }

      token = require('dotenv').parse(
        fs.readFileSync(envFile)
      ).TOKEN;

      if (!token || token.length < 32) {
        throw new Error('Invalid TOKEN in ' + envFile);
      }

      const preferenceFile = path.join(
        data,
        'desktop-settings.json'
      );

      settings = fs.existsSync(preferenceFile)
        ? JSON.parse(
            fs.readFileSync(preferenceFile, 'utf8')
          )
        : { controls: false };

      if (
        !fs.existsSync(path.join(data, 'config.json'))
      ) {
        const windows =
          process.env.SystemRoot || 'C:/Windows';

        write('config.json', {
          roots: {},

          apps: {
            notepad: {
              label: 'Notepad',
              exe: path.join(
                windows,
                'System32/notepad.exe'
              ),
              args: []
            },

            calculator: {
              label: 'Calculator',
              exe: path.join(
                windows,
                'System32/calc.exe'
              ),
              args: []
            }
          },

          modes: []
        });
      }

      handle('state', snapshot);

      handle('copy-token', () => {
        clipboard.writeText(token);
        return true;
      });

      handle('reveal-token', () => token);

      handle('startup', value => {
        if (
          typeof value !== 'boolean' ||
          !app.isPackaged
        ) {
          throw new Error(
            'Startup is available in the installed application.'
          );
        }

        app.setLoginItemSettings({
          openAtLogin: value
        });

        return snapshot();
      });

      handle('controls', async value => {
        if (typeof value !== 'boolean') {
          throw new Error('Invalid setting.');
        }

        await stopBackend();

        settings.controls = value;

        write('desktop-settings.json', settings);

        await reconcile();
        return snapshot();
      });

      handle('folder-add', async () => {
        const result = await dialog.showOpenDialog(
          win,
          {
            title:
              'Choose a folder to share with your phone',
            properties: ['openDirectory']
          }
        );

        if (result.canceled) return snapshot();

        await stopBackend();

        const config = JSON.parse(
          fs.readFileSync(
            path.join(data, 'config.json'),
            'utf8'
          )
        );

        const id =
          'folder-' +
          crypto.randomBytes(4).toString('hex');

        config.roots[id] = result.filePaths[0];

        write('config.json', config);

        await reconcile();
        return snapshot();
      });

      handle('folder-remove', async id => {
        if (typeof id !== 'string') {
          throw new Error('Invalid folder.');
        }

        await stopBackend();

        const config = JSON.parse(
          fs.readFileSync(
            path.join(data, 'config.json'),
            'utf8'
          )
        );

        delete config.roots[id];

        write('config.json', config);

        await reconcile();
        return snapshot();
      });

      handle('toggle-server', async () => {
        stopped = !stopped;

        if (stopped) {
          await stopBackend();

          status =
            'Stopped. Remote access is disabled until you press Start.';
        } else {
          await reconcile();
        }

        return snapshot();
      });

      createWindow();

      timer = setInterval(() => {
        serial(reconcile).catch(() => {
          status =
            'Could not start companion. Restart the Windows app.';

          publish();
        });
      }, 5000);

      serial(reconcile).catch(error => {
        status = error.message;
        publish();
      });
    })
    .catch(error => {
      dialog.showErrorBox(
        'Pocket Companion could not start',
        error.message
      );

      app.quit();
    });

  app.on('before-quit', event => {
    if (quitting) return;

    event.preventDefault();

    quitting = true;
    clearInterval(timer);

    serial(stopBackend).finally(() => {
      app.quit();
    });
  });

  app.on('window-all-closed', () => {
    // Keep running in the system tray.
  });
}
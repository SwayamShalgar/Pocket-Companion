const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn, execFile } = require('node:child_process');
const express = require('express');
const si = require('systeminformation');

const dataDir = process.env.COMPANION_DATA_DIR || __dirname;

fs.mkdirSync(dataDir, { recursive: true });
process.chdir(dataDir);

if (!fs.existsSync('.env')) {
  fs.writeFileSync(
    '.env',
    `HOST=127.0.0.1
PORT=4782
TOKEN=${crypto.randomBytes(32).toString('hex')}
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini
`,
    { mode: 0o600 }
  );
}

require('dotenv').config({ quiet: true });

if (!fs.existsSync('config.json')) {
  const folder = path.join(dataDir, 'Shared');
  fs.mkdirSync(folder, { recursive: true });

  fs.writeFileSync('config.json', JSON.stringify({
    roots: { shared: folder },
    apps: {
      notepad: {
        label: 'Notepad',
        exe: 'C:\\Windows\\System32\\notepad.exe',
        args: []
      },
      calculator: {
        label: 'Calculator',
        exe: 'C:\\Windows\\System32\\calc.exe',
        args: []
      }
    },
    modes: [
      { id: 'work', name: 'Work', apps: ['notepad', 'calculator'] }
    ]
  }, null, 2));
}

const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
const token = process.env.TOKEN || '';
const host = process.env.HOST || '127.0.0.1';

function tailnetIP(ip) {
  const n = ip.split('.').map(Number);
  return n.length === 4 &&
    n.every(x => Number.isInteger(x) && x >= 0 && x <= 255) &&
    n[0] === 100 && n[1] >= 64 && n[1] <= 127;
}

if (token.length < 32) {
  throw new Error('TOKEN must contain at least 32 characters.');
}
if (host !== '127.0.0.1' && !tailnetIP(host)) {
  throw new Error('HOST must be localhost or your Tailscale IPv4 address.');
}

const app = express();
app.disable('x-powered-by');

app.use((req, res, next) => {
  const supplied = Buffer.from(req.headers.authorization || '');
  const expected = Buffer.from(`Bearer ${token}`);

  if (
    supplied.length !== expected.length ||
    !crypto.timingSafeEqual(supplied, expected)
  ) {
    return res.status(401).json({ error: 'Invalid connection token.' });
  }

  res.set('Cache-Control', 'no-store');
  next();
});

app.use(express.json({ limit: '32kb' }));
app.use((req, res, next) => {
  if (
    process.env.COMPANION_DESKTOP === '1' &&
    process.env.COMPANION_CONTROLS !== '1'
  ) {
    const route = req.path;

    const needsControls =
      [
        '/open',
        '/launch',
        '/mode',
        '/control',
        '/remote',
        '/chat'
      ].includes(route) ||
      route.startsWith('/screen/') ||
      route.startsWith('/system') ||
      route.startsWith('/running-apps');

    if (needsControls) {
      return res.status(403).json({
        error:
          'Enable laptop controls in the Windows companion settings first.'
      });
    }
  }

  next();
});

const own = (obj, key) =>
  typeof key === 'string' && Object.hasOwn(obj, key);

function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}

function filePath(root, relative = '') {
  if (!own(config.roots, root) || typeof relative !== 'string') {
    fail('Unknown folder.');
  }

  if (
    path.isAbsolute(relative) ||
    relative.split(/[\\/]/).includes('..') ||
    /[:\0]/.test(relative)
  ) {
    fail('Invalid path.');
  }

  const base = fs.realpathSync(config.roots[root]);
  const target = fs.realpathSync(path.resolve(base, relative));
  const rest = path.relative(base, target);

  if (
    rest === '..' ||
    rest.startsWith(`..${path.sep}`) ||
    path.isAbsolute(rest)
  ) {
    fail('Path is outside the shared folder.', 403);
  }

  return target;
}

function launch(exe, args = []) {
  if (process.platform !== 'win32') fail('Launching requires Windows.');

  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, {
      detached: true,
      stdio: 'ignore',
      shell: false
    });

    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

async function launchApp(id) {
  if (!own(config.apps, id)) fail('Unknown app.');
  const item = config.apps[id];
  await launch(item.exe, item.args || []);
}

async function status() {
  const [battery, disks, memory] = await Promise.all([
    si.battery(), si.fsSize(), si.mem()
  ]);

  return {
    computer: os.hostname(),
    battery: {
      present: battery.hasBattery,
      percent: battery.percent,
      charging: battery.isCharging
    },
    disks: disks.map(d => ({
      name: d.mount || d.fs,
      size: d.size,
      available: d.available
    })),
    memory: { total: memory.total, used: memory.active },
    uptime: os.uptime()
  };
}

app.get('/status', async (req, res) => {
  res.json(await status());
});

app.get('/catalog', (req, res) => {
  res.json({
    roots: Object.keys(config.roots),
    apps: Object.entries(config.apps).map(([id, item]) => ({
      id, label: item.label
    })),
    modes: config.modes
  });
});

app.get('/files', (req, res) => {
  const folder = filePath(req.query.root, req.query.path || '');
  if (!fs.statSync(folder).isDirectory()) fail('Choose a folder.');

  const all = fs.readdirSync(folder, { withFileTypes: true })
    .sort((a, b) =>
      Number(b.isDirectory()) - Number(a.isDirectory()) ||
      a.name.localeCompare(b.name)
    );

  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);

  res.json({
    entries: all.slice(offset, offset + 200).map(e => ({
      name: e.name,
      directory: e.isDirectory()
    })),
    next: offset + 200 < all.length ? offset + 200 : null
  });
});

app.get('/download', (req, res, next) => {
  const file = filePath(req.query.root, req.query.path || '');
  if (!fs.statSync(file).isFile()) fail('Choose a file.');

  res.download(file, path.basename(file), err => {
    if (err && !res.headersSent) next(err);
  });
});

app.post('/open', async (req, res) => {
  const file = filePath(req.body.root, req.body.path);

  if (!fs.statSync(file).isFile()) {
    fail('Choose a file.');
  }

  if (process.platform !== 'win32') {
    fail('Opening files requires Windows.');
  }

  const script =
    `Start-Process -FilePath '${file.replace(/'/g, "''")}' ` +
    '-ErrorAction Stop';

  const powershell = path.join(
    process.env.SystemRoot || 'C:/Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe'
  );

  await new Promise((resolve, reject) => {
    execFile(
      powershell,
      [
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(script, 'utf16le').toString('base64')
      ],
      {
        windowsHide: true,
        timeout: 20000
      },
      error => {
        if (error) {
          reject(
            Object.assign(
              new Error(
                'Windows could not open this file. Check its default application, permissions, or any prompt on the laptop.'
              ),
              { status: 400 }
            )
          );
        } else {
          resolve();
        }
      }
    );
  });

  res.json({
    message:
      'Windows accepted the open request. Check the laptop for the application or any prompt.'
  });
});

app.post('/launch', async (req, res) => {
  await launchApp(req.body.id);
  res.json({ message: 'App launch requested.' });
});

app.post('/modes', (req, res) => {
  const { name, apps } = req.body;

  if (
    typeof name !== 'string' ||
    !name.trim() ||
    name.length > 60 ||
    !Array.isArray(apps) ||
    !apps.length ||
    apps.length > 10 ||
    !apps.every(id => own(config.apps, id))
  ) {
    fail('Choose a name and 1–10 known apps.');
  }

  if (config.modes.length >= 50) {
    fail('Maximum 50 modes. Remove old modes in config.json.');
  }

  const mode = {
    id: crypto.randomUUID(),
    name: name.trim(),
    apps: [...new Set(apps)]
  };

  const updated = {
    ...config,
    modes: [...config.modes, mode]
  };

  fs.writeFileSync('config.json.tmp', JSON.stringify(updated, null, 2));
  fs.renameSync('config.json.tmp', 'config.json');
  config.modes = updated.modes;

  res.json(mode);
});

app.post('/mode', async (req, res) => {
  const mode = config.modes.find(m => m.id === req.body.id);
  if (!mode) fail('Unknown mode.');

  const results = [];

  for (const id of mode.apps) {
    try {
      await launchApp(id);
      results.push({ id, ok: true });
    } catch {
      results.push({ id, ok: false });
    }
  }

  res.json({
    message: results.every(r => r.ok)
      ? `${mode.name}: launch requests sent.`
      : `${mode.name}: some apps failed. Check their executable paths.`,
    results
  });
});

let chatting = false;

app.post('/chat', async (req, res) => {
  if (!process.env.OPENAI_API_KEY) {
    fail(
      'Add OPENAI_API_KEY to the Windows .env file and restart. Chat API usage is billed separately.',
      503
    );
  }

  if (chatting) {
    fail('Another reply is in progress. Try again shortly.', 429);
  }

  const messages = req.body.messages;

  if (
    !Array.isArray(messages) ||
    !messages.length ||
    messages.length > 20 ||
    !messages.every(m =>
      ['user', 'assistant'].includes(m.role) &&
      typeof m.content === 'string' &&
      m.content.length <= 4000
    )
  ) {
    fail('Invalid chat messages.');
  }

  chatting = true;

  try {
    const current = await status();
    const catalog = {
      apps: Object.entries(config.apps).map(([id, a]) => ({
        id, name: a.label
      })),
      modes: config.modes
    };

    const response = await fetch(
      'https://api.openai.com/v1/chat/completions',
      {
        method: 'POST',
        signal: AbortSignal.timeout(45000),
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
          max_completion_tokens: 700,
          messages: [
            {
              role: 'system',
              content:
                `You are a friendly laptop companion. Be concise. ` +
                `Current status: ${JSON.stringify(current)}. ` +
                `Available actions: ${JSON.stringify(catalog)}. ` +
                `You can propose launching one app or mode using propose_action. ` +
                `Proposals require a user tap and have NOT executed. ` +
                `Never claim an action succeeded. ` +
                `You cannot read file contents or run commands.`
            },
            ...messages
          ],
          tools: [{
            type: 'function',
            function: {
              name: 'propose_action',
              description: 'Propose one supported action for user approval.',
              parameters: {
                type: 'object',
                properties: {
                  kind: { type: 'string', enum: ['app', 'mode'] },
                  id: { type: 'string' }
                },
                required: ['kind', 'id'],
                additionalProperties: false
              }
            }
          }]
        })
      }
    );

    if (!response.ok) {
      fail(
        `AI service returned ${response.status}. Check the key, model, and API billing.`,
        502
      );
    }

    const data = await response.json();
    const message = data.choices?.[0]?.message;
    if (!message) fail('AI returned no response.', 502);

    let action = null;

    const call = message.tool_calls?.find(
      c => c.function?.name === 'propose_action'
    );

    if (call) {
      try {
        const a = JSON.parse(call.function.arguments);

        if (a.kind === 'app' && own(config.apps, a.id)) {
          action = {
            kind: 'app',
            id: a.id,
            label: config.apps[a.id].label
          };
        }

        if (
          a.kind === 'mode' &&
          config.modes.some(m => m.id === a.id)
        ) {
          action = {
            kind: 'mode',
            id: a.id,
            label: config.modes.find(m => m.id === a.id).name
          };
        }
      } catch {}
    }

    res.json({
      reply: message.content || (
        action
          ? `Tap Run to start ${action.label}.`
          : 'Please try asking again.'
      ),
      action
    });
  } finally {
    chatting = false;
  }
});

require('./upgrades.cjs')(app, config, filePath);
require('./remote.cjs')(app);
require('./system-controls.cjs')(app);
require('./screen.cjs')(app);

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);

  console.error(err.message);

  const code = err.status || (err.code === 'ENOENT' ? 404 : 500);

  res.status(code).json({
    error: code === 500
      ? 'Windows operation failed. Check the companion terminal and config.json.'
      : err.message
  });
});

if (require.main === module) {
  app.listen(Number(process.env.PORT || 4782), host, () => {
    console.log(
      `Companion listening at http://${host}:${process.env.PORT || 4782}`
    );
    console.log('Pair using TOKEN from .env. Keep this terminal running.');

    if (host === '127.0.0.1') {
      console.log(
        'For Android: set HOST in .env to your Tailscale IPv4 address, then restart.'
      );
    }
  }).on('error', err => {
    console.error(err.message);
    process.exitCode = 1;
  });
}

module.exports = { app, filePath, config };
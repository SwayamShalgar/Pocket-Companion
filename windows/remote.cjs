const { spawn } = require('node:child_process');
const path = require('node:path');
const readline = require('node:readline');

const keys = new Set([
  'enter',
  'tab',
  'backspace',
  'escape',
  'up',
  'down',
  'left',
  'right',
  'copy',
  'paste',
  'selectAll',
  'switchApp',
  'desktop'
]);

function validate(body) {
  const bad = () => {
    throw Object.assign(
      new Error('Invalid remote action.'),
      { status: 400 }
    );
  };

  if (!body || typeof body !== 'object') return bad();

  const { action } = body;

  if (
    action === 'ping' ||
    action === 'clipboardGet'
  ) {
    return { action };
  }

  if (
    action === 'move' &&
    [body.dx, body.dy].every(
      n => Number.isInteger(n) && Math.abs(n) <= 500
    )
  ) {
    return {
      action,
      dx: body.dx,
      dy: body.dy
    };
  }

  if (
    action === 'click' &&
    ['left', 'right'].includes(body.button)
  ) {
    return {
      action,
      button: body.button
    };
  }

  if (
    action === 'scroll' &&
    Number.isInteger(body.amount) &&
    Math.abs(body.amount) <= 1200
  ) {
    return {
      action,
      amount: body.amount
    };
  }

  if (
    action === 'key' &&
    keys.has(body.key)
  ) {
    return {
      action,
      key: body.key
    };
  }

  if (
    ['text', 'clipboardSet'].includes(action) &&
    typeof body.text === 'string' &&
    body.text.length <= (
      action === 'text' ? 1000 : 10000
    ) &&
    !body.text.includes('\0')
  ) {
    return {
      action,
      text: body.text
    };
  }

  return bad();
}

function makeWorker() {
  let child;
  let sequence = 0;
  const pending = new Map();

  function stop(
    error = new Error(
      'Remote helper stopped. Open Remote again to reconnect.'
    )
  ) {
    const old = child;
    child = null;

    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.reject(error);
    }

    pending.clear();
    old?.kill();
  }

  function start() {
    const exe = path.join(
      process.env.SystemRoot || 'C:/Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe'
    );

    const current = spawn(
      exe,
      [
        '-NoProfile',
        '-NonInteractive',
        '-STA',
        '-ExecutionPolicy',
        'RemoteSigned',
        '-File',
        path.join(__dirname, 'remote-worker.ps1')
      ],
      {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      }
    );

    child = current;

    const lines = readline.createInterface({
      input: current.stdout
    });

    lines.on('line', line => {
      let message;

      try {
        message = JSON.parse(line);
      } catch {
        return;
      }

      const item = pending.get(message.id);
      if (!item) return;

      pending.delete(message.id);
      clearTimeout(item.timer);

      if (message.ok) {
        item.resolve(message);
      } else {
        item.reject(
          new Error(
            message.error || 'Windows input failed.'
          )
        );
      }
    });

    current.stderr.on('data', () => {});

    current.stdin.on('error', () => {
      if (child === current) stop();
    });

    current.on('error', () => {
      if (child === current) {
        stop(
          new Error(
            'Could not start PowerShell remote helper.'
          )
        );
      }
    });

    current.on('exit', () => {
      lines.close();

      if (child === current) {
        stop(
          new Error(
            'Remote helper exited. Check remote-worker.ps1 and Windows script policy.'
          )
        );
      }
    });
  }

  return {
    stop,

    send(command) {
      if (process.platform !== 'win32') {
        return Promise.reject(
          new Error(
            'Remote controls require Windows.'
          )
        );
      }

      if (pending.size >= 8) {
        return Promise.reject(
          new Error(
            'Remote controls are busy. Try again shortly.'
          )
        );
      }

      if (!child) start();

      return new Promise((resolve, reject) => {
        const id = ++sequence;

        const timer = setTimeout(
          () => stop(
            new Error(
              'Remote action timed out. It will not be retried automatically.'
            )
          ),
          8000
        );

        pending.set(id, {
          resolve,
          reject,
          timer
        });

        child.stdin.write(
          JSON.stringify({ ...command, id }) + '\n'
        );
      });
    }
  };
}

function install(app, worker = makeWorker()) {
  app.post('/remote', async (req, res) => {
    const command = validate(req.body);

    try {
      res.json(await worker.send(command));
    } catch (error) {
      res.status(503).json({
        error: error.message
      });
    }
  });

  return worker;
}

module.exports = install;
module.exports.validate = validate;
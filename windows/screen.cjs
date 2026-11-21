const { spawn } = require('node:child_process');
const path = require('node:path');
const readline = require('node:readline');

const fail = (message, status = 503) =>
  Object.assign(new Error(message), { status });

function createWorker() {
  let child;
  let pending;
  let sequence = 0;
  let idle;

  function stop(
    error = fail(
      'Screen helper stopped. Reopen the viewer.'
    )
  ) {
    clearTimeout(idle);

    const old = child;
    child = null;

    if (pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      pending = null;
    }

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

    const processChild = spawn(
      exe,
      [
        '-NoProfile',
        '-NonInteractive',
        '-STA',
        '-ExecutionPolicy',
        'RemoteSigned',
        '-File',
        path.join(__dirname, 'screen-worker.ps1')
      ],
      {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      }
    );

    child = processChild;

    const lines = readline.createInterface({
      input: processChild.stdout
    });

    let diagnostic = '';

    processChild.stderr.on('data', chunk => {
      diagnostic = (
        diagnostic + chunk.toString()
      ).slice(-2000);
    });

    lines.on('line', line => {
      let reply;

      try {
        reply = JSON.parse(line);
      } catch {
        return;
      }

      if (
        !pending ||
        reply.id !== pending.id
      ) {
        return;
      }

      const request = pending;
      pending = null;

      clearTimeout(request.timer);

      if (reply.ok) {
        request.resolve(reply.result);
      } else {
        request.reject(
          fail(
            reply.error ||
            'Capture unavailable. Unlock the laptop.'
          )
        );
      }

      idle = setTimeout(() => stop(), 30000);
    });

    processChild.stdin.on('error', () => {
      if (child === processChild) stop();
    });

    processChild.on('error', () => {
      if (child === processChild) {
        stop(
          fail('Could not start Windows screen capture.')
        );
      }
    });

    processChild.on('exit', () => {
      lines.close();

      if (child === processChild) {
        if (diagnostic) {
          console.error(
            'Screen helper:',
            diagnostic
          );
        }

        stop(
          fail(
            'Screen helper exited. Check screen-worker.ps1 and the Windows companion log.'
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
          fail('Screen viewing requires Windows.')
        );
      }

      if (pending) {
        return Promise.reject(
          fail('Screen capture is busy.', 429)
        );
      }

      clearTimeout(idle);
      if (!child) start();

      return new Promise((resolve, reject) => {
        const id = ++sequence;

        const timer = setTimeout(
          () => stop(
            fail(
              'Screen capture timed out. Unlock the laptop and retry.'
            )
          ),
          10000
        );

        pending = {
          id,
          timer,
          resolve,
          reject
        };

        child.stdin.write(
          JSON.stringify({ ...command, id }) + '\n'
        );
      });
    }
  };
}

function install(app, worker = createWorker()) {
  let lastFrame = 0;

  app.get('/screen/displays', async (req, res) => {
    res.set('Cache-Control', 'no-store');

    res.json(
      await worker.send({
        action: 'displays'
      })
    );
  });

  app.get('/screen/frame', async (req, res) => {
    const value = req.query.display ?? '-1';

    if (
      typeof value !== 'string' ||
      !/^-?\d+$/.test(value)
    ) {
      throw fail('Invalid monitor.', 400);
    }

    const display = Number(value);

    if (
      !Number.isInteger(display) ||
      display < -1 ||
      display > 64
    ) {
      throw fail('Invalid monitor.', 400);
    }

    if (Date.now() - lastFrame < 500) {
      throw fail('Wait for the next frame.', 429);
    }

    lastFrame = Date.now();

    const frame = await worker.send({
      action: 'frame',
      display
    });

    if (
      typeof frame.jpeg !== 'string' ||
      frame.jpeg.length > 6000000 ||
      !Number.isFinite(frame.width) ||
      !Number.isFinite(frame.height) ||
      frame.width <= 0 ||
      frame.height <= 0
    ) {
      throw fail('Invalid screenshot from Windows.');
    }

    res.set('Cache-Control', 'no-store');

    if (!res.destroyed) {
      res.json(frame);
    }
  });

  return worker;
}

module.exports = install;
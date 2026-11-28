const { app } = require('../server.cjs');

const server = app.listen(4782, process.env.HOST, () => {
  process.parentPort.postMessage({ ready: true });
});

server.on('error', error => {
  process.parentPort.postMessage({
    error:
      error.code === 'EADDRINUSE'
        ? 'Port 4782 is already in use. Quit the old companion or its tray launcher.'
        : `Server could not start: ${error.code || error.message}`
  });

  process.exitCode = 1;
});
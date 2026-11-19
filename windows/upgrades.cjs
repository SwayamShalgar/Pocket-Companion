const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { execFile } = require('node:child_process');

module.exports = function upgrades(app, config, filePath) {
  const limit = 25 * 1024 * 1024;
  let uploading = false;
  let controlling = false;

  const keys = {
    volumeUp: 175,
    volumeDown: 174,
    mute: 173,
    playPause: 179,
    nextTrack: 176,
    previousTrack: 177
  };

  const error = (message, status) =>
    Object.assign(new Error(message), { status });

  const roots = () =>
    (config.uploadRoots || ['shared']).filter(
      r => Object.hasOwn(config.roots, r)
    );

  app.get('/capabilities', (req, res) => {
    res.json({
      uploadRoots: roots(),
      uploadLimit: limit,
      controls: process.platform === 'win32'
        ? Object.keys(keys)
        : []
    });
  });

  app.post('/upload', async (req, res) => {
    if (uploading) {
      throw error('Another upload is in progress.', 429);
    }

    if (!req.is('application/octet-stream')) {
      throw error('Send a binary file.', 415);
    }

    const { root, name } = req.query;

    if (typeof root !== 'string' || !roots().includes(root)) {
      throw error('Uploads are disabled for this folder.', 403);
    }

    if (
      typeof name !== 'string' ||
      !name ||
      name.length > 180 ||
      /[<>:"/\\|?*\x00-\x1f]/.test(name) ||
      /[. ]$/.test(name) ||
      /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(name) ||
      name.startsWith('.')
    ) {
      throw error('Choose a normal Windows filename.', 400);
    }

    if (Number(req.headers['content-length']) > limit) {
      throw error('Maximum upload size is 25 MB.', 413);
    }

    const directory = filePath(root, '');
    const destination = path.join(directory, name);
    const temporary = path.join(
      directory,
      `.upload-${crypto.randomUUID()}`
    );

    uploading = true;
    let bytes = 0;

    try {
      await pipeline(
        req,
        new Transform({
          transform(chunk, encoding, done) {
            bytes += chunk.length;

            done(
              bytes > limit
                ? error('Maximum upload size is 25 MB.', 413)
                : null,
              chunk
            );
          }
        }),
        fs.createWriteStream(temporary, { flags: 'wx' })
      );

      // Publish a complete file without overwriting an existing name.
      await fsp.link(temporary, destination);

      res.json({
        message: `Uploaded ${name}`,
        bytes
      });
    } catch (e) {
      if (e.code === 'EEXIST') {
        throw error(
          'That filename already exists. Rename your file first.',
          409
        );
      }

      throw e;
    } finally {
      await fsp.unlink(temporary).catch(() => {});
      uploading = false;
    }
  });

  app.post('/control', async (req, res) => {
    const id = req.body?.id;

    if (typeof id !== 'string' || !Object.hasOwn(keys, id)) {
      throw error('Unknown control.', 400);
    }

    if (process.platform !== 'win32') {
      throw error('Media controls require Windows.', 501);
    }

    if (controlling) {
      throw error('A control is already in progress.', 429);
    }

    const script = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class CompanionKeys {
  [DllImport("user32.dll")]
  public static extern void keybd_event(
    byte key, byte scan, uint flags, UIntPtr extra
  );
}
'@
[CompanionKeys]::keybd_event(${keys[id]},0,0,[UIntPtr]::Zero)
[CompanionKeys]::keybd_event(${keys[id]},0,2,[UIntPtr]::Zero)
`;

    controlling = true;

    try {
      await new Promise((resolve, reject) => {
        execFile(
          'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-EncodedCommand',
            Buffer.from(script, 'utf16le').toString('base64')
          ],
          {
            windowsHide: true,
            timeout: 15000
          },
          err => err ? reject(err) : resolve()
        );
      });

      res.json({
        message: 'Media key sent to Windows.'
      });
    } finally {
      controlling = false;
    }
  });
};
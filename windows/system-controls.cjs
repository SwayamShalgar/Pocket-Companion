const { execFile } = require('node:child_process');
const path = require('node:path');
const crypto = require('node:crypto');

const settings = {
    home: ['All Windows settings', 'ms-settings:'],
    wifi: ['Wi-Fi', 'ms-settings:network-wifi'],
    ethernet: ['Ethernet', 'ms-settings:network-ethernet'],
    bluetooth: ['Bluetooth & devices', 'ms-settings:bluetooth'],
    display: ['Display', 'ms-settings:display'],
    sound: ['Sound', 'ms-settings:sound'],
    power: ['Power & sleep', 'ms-settings:powersleep'],
    battery: ['Battery', 'ms-settings:batterysaver'],
    storage: ['Storage', 'ms-settings:storagesense'],
    apps: ['Installed apps', 'ms-settings:appsfeatures'],
    notifications: ['Notifications', 'ms-settings:notifications'],
    update: ['Windows Update', 'ms-settings:windowsupdate'],
    privacy: ['Privacy', 'ms-settings:privacy'],
    personalization: ['Personalization', 'ms-settings:personalization'],
    vpn: ['VPN', 'ms-settings:network-vpn'],
    mouse: ['Mouse', 'ms-settings:mousetouchpad']
};

const actions = {
    shutdown: 'Shut down',
    restart: 'Restart',
    sleep: 'Sleep',
    lock: 'Lock Windows',
    wifiOff: 'Turn Wi-Fi adapters off',
    wifiOn: 'Turn Wi-Fi adapters on',
    bluetoothOn: 'Turn Bluetooth on',
    bluetoothOff: 'Turn Bluetooth off'
};

const error = (message, status = 400) =>
    Object.assign(new Error(message), { status });

function ps(script, timeout = 30000) {
    const exe = path.join(
        process.env.SystemRoot || 'C:/Windows',
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe'
    );

    const encoded = Buffer.from(
        "$ErrorActionPreference='Stop';\n" + script,
        'utf16le'
    ).toString('base64');

    return new Promise((resolve, reject) => {
        execFile(
            exe,
            [
                '-NoProfile',
                '-NonInteractive',
                '-EncodedCommand',
                encoded
            ],
            {
                windowsHide: true,
                timeout,
                maxBuffer: 1024 * 1024
            },
            (err, stdout, stderr) => {
                if (err) {
                    reject(new Error(stderr.trim() || err.message));
                } else {
                    resolve(stdout.trim());
                }
            }
        );
    });
}

async function executeWindows(kind, value) {
    if (
        kind === 'bluetoothOn' ||
        kind === 'bluetoothOff'
    ) {
        const exe = path.join(
            process.env.SystemRoot || 'C:/Windows',
            'System32',
            'WindowsPowerShell',
            'v1.0',
            'powershell.exe'
        );

        return new Promise((resolve, reject) => {
            execFile(
                exe,
                [
                    '-NoProfile',
                    '-NonInteractive',
                    '-STA',
                    '-ExecutionPolicy',
                    'RemoteSigned',
                    '-File',
                    path.join(__dirname, 'bluetooth.ps1'),
                    '-Mode',
                    kind === 'bluetoothOn' ? 'On' : 'Off'
                ],
                {
                    windowsHide: true,
                    timeout: 60000
                },
                (err, stdout, stderr) => {
                    if (err) {
                        reject(
                            new Error(stderr.trim() || err.message)
                        );
                    } else {
                        resolve(stdout.trim());
                    }
                }
            );
        });
    }
    if (kind === 'settings') {
        return ps(
            `Start-Process '${settings[value][1]}' -ErrorAction Stop`
        );
    }

    if (kind === 'brightnessGet') {
        const result = await ps(`
$b = Get-CimInstance -Namespace root/wmi -ClassName WmiMonitorBrightness |
    Select-Object -First 1
if (-not $b) {
    throw 'This display does not expose brightness controls.'
}
[int]$b.CurrentBrightness
`);

        const level = Number(result);

        if (
            !Number.isInteger(level) ||
            level < 0 ||
            level > 100
        ) {
            throw new Error('Brightness information is unavailable.');
        }

        return level;
    }

    if (kind === 'brightnessSet') {
        return ps(`
$m = Get-CimInstance -Namespace root/wmi -ClassName WmiMonitorBrightnessMethods |
    Select-Object -First 1
if (-not $m) {
    throw 'This display does not expose brightness controls.'
}
$r = Invoke-CimMethod -InputObject $m -MethodName WmiSetBrightness -Arguments @{
    Timeout = [uint32]1
    Brightness = [byte]${value}
}
if ($r.ReturnValue -ne 0) {
    throw 'Windows rejected the brightness change.'
}
`);
    }

    if (kind === 'shutdown' || kind === 'restart') {
        const exe = path.join(
            process.env.SystemRoot || 'C:/Windows',
            'System32',
            'shutdown.exe'
        );

        return new Promise((resolve, reject) => {
            execFile(
                exe,
                [
                    kind === 'shutdown' ? '/s' : '/r',
                    '/t',
                    '0'
                ],
                {
                    windowsHide: true,
                    timeout: 15000
                },
                err => err ? reject(err) : resolve()
            );
        });
    }

    if (kind === 'lock') {
        return ps(`
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class PocketLock {
  [DllImport("user32.dll")]
  public static extern bool LockWorkStation();
}
'@

if (-not [PocketLock]::LockWorkStation()) {
    throw 'Windows could not lock this session.'
}
`);
    }

    if (kind === 'sleep') {
        return ps(`
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class PocketSleep {
  [DllImport("powrprof.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.U1)]
  public static extern bool SetSuspendState(
    [MarshalAs(UnmanagedType.U1)] bool hibernate,
    [MarshalAs(UnmanagedType.U1)] bool force,
    [MarshalAs(UnmanagedType.U1)] bool disableWake
  );
}
'@

if (-not [PocketSleep]::SetSuspendState($false, $false, $false)) {
    throw 'Windows rejected the sleep request.'
}
`, 0);
    }

    if (kind === 'wifiOff' || kind === 'wifiOn') {
        const verb = kind === 'wifiOff'
            ? 'Disable-NetAdapter'
            : 'Enable-NetAdapter';

        const elevated = `
$ErrorActionPreference = 'Stop'
$wifi = @(
    Get-NetAdapter -Physical |
    Where-Object {
        [int]$_.NdisPhysicalMedium -in @(1, 9)
    }
)

if ($wifi.Count -eq 0) {
    throw 'No Wi-Fi adapter found.'
}

$wifi | ${verb} -Confirm:$false
`;

        const encoded = Buffer.from(
            elevated,
            'utf16le'
        ).toString('base64');

        return ps(`
$exe = Join-Path $PSHOME 'powershell.exe'
$p = Start-Process -FilePath $exe -Verb RunAs -ArgumentList '-NoProfile -NonInteractive -EncodedCommand ${encoded}' -PassThru -Wait

if ($p.ExitCode -ne 0) {
    throw 'Wi-Fi change failed or administrator permission was denied.'
}
`, 0);
    }

    throw new Error('Unsupported Windows action.');
}

function install(
    app,
    {
        execute = executeWindows,
        supported = process.platform === 'win32',
        delay = 10000
    } = {}
) {
    let pending = null;
    let last = null;
    let timer;

    const requireWindows = () => {
        if (!supported) {
            throw error('System controls require Windows.', 501);
        }
    };

    app.get('/system', (req, res) => {
        res.json({
            supported,

            settings: Object.entries(settings).map(
                ([id, [label]]) => ({ id, label })
            ),

            pending: pending
                ? {
                    ...pending,
                    remainingSeconds: Math.max(
                        0,
                        Math.ceil(
                            (pending.executeAt - Date.now()) / 1000
                        )
                    )
                }
                : null,

            last
        });
    });

    app.post('/system/settings', async (req, res) => {
        requireWindows();

        if (
            typeof req.body?.id !== 'string' ||
            !Object.hasOwn(settings, req.body.id)
        ) {
            throw error('Unknown settings page.');
        }

        await execute('settings', req.body.id);

        res.json({
            message: 'Settings page requested on your laptop.'
        });
    });

    app.get('/system/brightness', async (req, res) => {
        requireWindows();

        try {
            res.json({
                percent: await execute('brightnessGet')
            });
        } catch {
            res.status(501).json({
                error:
                    'This display does not support this brightness API. Use Display settings on the laptop.'
            });
        }
    });

    app.post('/system/brightness', async (req, res) => {
        requireWindows();

        const value = req.body?.percent;

        if (
            !Number.isInteger(value) ||
            value < 0 ||
            value > 100
        ) {
            throw error(
                'Brightness must be an integer from 0 to 100.'
            );
        }

        await execute('brightnessSet', value);

        res.json({
            message: 'Brightness change requested.'
        });
    });

    app.post('/system/action', (req, res) => {
        requireWindows();

        const action = req.body?.action;

        if (
            typeof action !== 'string' ||
            !Object.hasOwn(actions, action) ||
            req.body.confirmed !== true
        ) {
            throw error(
                'Choose a supported action and confirm it first.'
            );
        }

        if (pending) {
            throw error(
                'An action is already scheduled or running.',
                409
            );
        }

        const job = {
            id: crypto.randomUUID(),
            action,
            label: actions[action],
            executeAt: Date.now() + delay,
            state: 'queued'
        };

        pending = job;

        timer = setTimeout(async () => {
            job.state = 'running';

            try {
                await execute(action);

                last = {
                    action,
                    message:
                        `${actions[action]}: Windows accepted the request.`,
                    at: Date.now()
                };
            } catch (e) {
                console.error(
                    'System action failed:',
                    e.message
                );

                last = {
                    action,
                    message:
                        `${actions[action]} failed. Check Windows permissions or prompts on your laptop.`,
                    at: Date.now()
                };
            } finally {
                pending = null;
            }
        }, delay);

        res.status(202).json({
            id: job.id,
            message:
                `${actions[action]} scheduled in ${Math.ceil(delay / 1000)} seconds.` +
                (
                    action.startsWith('wifi')
                        ? ' Approve the administrator prompt on your laptop to continue.'
                        : ''
                )
        });
    });

    app.post('/system/cancel', (req, res) => {
        requireWindows();

        if (
            !pending ||
            pending.id !== req.body?.id ||
            pending.state !== 'queued'
        ) {
            throw error(
                'This action has already started or is no longer scheduled.',
                409
            );
        }

        clearTimeout(timer);

        last = {
            action: pending.action,
            message: 'Scheduled action cancelled.',
            at: Date.now()
        };

        pending = null;

        res.json({
            message: 'Scheduled action cancelled.'
        });
    });

    return {
        dispose: () => clearTimeout(timer)
    };
}

module.exports = install;
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = 'Stop'
$created = $false

$mutex = New-Object System.Threading.Mutex(
    $true,
    'Local\PocketCompanionTray',
    [ref]$created
)

if (-not $created) {
    $mutex.Dispose()
    exit
}

$script:serverProcess = $null
$script:tray = $null

$shortcutPath = Join-Path `
    ([Environment]::GetFolderPath('Startup')) `
    'Pocket Companion.lnk'

try {
    $node = (Get-Command node.exe -ErrorAction Stop).Source

    $script:serverProcess = Start-Process `
        -FilePath $node `
        -ArgumentList 'server.cjs' `
        -WorkingDirectory $PSScriptRoot `
        -WindowStyle Hidden `
        -PassThru `
        -RedirectStandardOutput (
            Join-Path $PSScriptRoot 'companion.log'
        ) `
        -RedirectStandardError (
            Join-Path $PSScriptRoot 'companion-error.log'
        )

    $script:tray = New-Object System.Windows.Forms.NotifyIcon
    $script:tray.Icon = [System.Drawing.SystemIcons]::Application
    $script:tray.Text = 'Pocket Companion - starting'

    $menu = New-Object System.Windows.Forms.ContextMenuStrip

    $status = $menu.Items.Add('Starting companion...')
    $status.Enabled = $false

    $open = $menu.Items.Add('Open companion folder')
    $open.add_Click({
        Start-Process explorer.exe -ArgumentList (
            '"' + $PSScriptRoot + '"'
        )
    })

    $logs = $menu.Items.Add('Open error log')
    $logs.add_Click({
        Start-Process notepad.exe -ArgumentList (
            '"' +
            (Join-Path $PSScriptRoot 'companion-error.log') +
            '"'
        )
    })

    $startup = $menu.Items.Add('Start when I sign in')
    $startup.Checked = Test-Path $shortcutPath

    $startup.add_Click({
        try {
            if (Test-Path $shortcutPath) {
                Remove-Item -LiteralPath $shortcutPath
                $startup.Checked = $false
            } else {
                $shell = New-Object -ComObject WScript.Shell
                $shortcut = $shell.CreateShortcut($shortcutPath)

                $shortcut.TargetPath = (
                    "$env:SystemRoot\System32\" +
                    "WindowsPowerShell\v1.0\powershell.exe"
                )

                $shortcut.Arguments = (
                    '-NoProfile -STA -WindowStyle Hidden ' +
                    '-ExecutionPolicy RemoteSigned -File "' +
                    (Join-Path $PSScriptRoot 'tray.ps1') +
                    '"'
                )

                $shortcut.WorkingDirectory = $PSScriptRoot
                $shortcut.Save()
                $startup.Checked = $true
            }
        } catch {
            [System.Windows.Forms.MessageBox]::Show(
                $_.Exception.Message,
                'Startup setting'
            ) | Out-Null
        }
    })

    $quit = $menu.Items.Add('Quit companion')
    $quit.add_Click({
        [System.Windows.Forms.Application]::ExitThread()
    })

    $script:tray.ContextMenuStrip = $menu
    $script:tray.Visible = $true

    $timer = New-Object System.Windows.Forms.Timer
    $timer.Interval = 2000

    $timer.add_Tick({
        if ($script:serverProcess.HasExited) {
            $status.Text = 'Stopped - check error log'
            $script:tray.Text = 'Pocket Companion - stopped'
        } else {
            $status.Text = 'Companion process running'
            $script:tray.Text = 'Pocket Companion - running'
        }
    })

    $timer.Start()
    [System.Windows.Forms.Application]::Run()
} catch {
    [System.Windows.Forms.MessageBox]::Show(
        $_.Exception.Message,
        'Pocket Companion'
    ) | Out-Null
} finally {
    if ($timer) {
        $timer.Stop()
        $timer.Dispose()
    }

    if ($script:tray) {
        $script:tray.Visible = $false
        $script:tray.Dispose()
    }

    if (
        $script:serverProcess -and
        -not $script:serverProcess.HasExited
    ) {
        $script:serverProcess.Kill()
    }

    $mutex.ReleaseMutex()
    $mutex.Dispose()
}
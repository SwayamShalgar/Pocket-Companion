$ErrorActionPreference = 'Stop'

$configPath = Join-Path $PSScriptRoot 'config.json'

if (-not (Test-Path $configPath)) {
    throw 'Run the Windows companion once to create config.json, then stop it.'
}

$config = Get-Content `
    -LiteralPath $configPath `
    -Raw `
    -Encoding UTF8 | ConvertFrom-Json

if (-not $config.apps) {
    $config | Add-Member `
        -NotePropertyName apps `
        -NotePropertyValue ([PSCustomObject]@{}) `
        -Force
}

$items = @(Get-StartApps | Sort-Object Name)
$sha = [System.Security.Cryptography.SHA256]::Create()

try {
    foreach ($item in $items) {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes(
            $item.AppID
        )

        $hash = (
            [BitConverter]::ToString(
                $sha.ComputeHash($bytes)
            )
        ).Replace('-', '').ToLowerInvariant()

        $id = 'installed_' + $hash.Substring(0, 24)

        $app = [PSCustomObject]@{
            label = $item.Name
            exe = (Join-Path $env:WINDIR 'explorer.exe')
            args = @('shell:AppsFolder\' + $item.AppID)
        }

        $config.apps | Add-Member `
            -NotePropertyName $id `
            -NotePropertyValue $app `
            -Force
    }

    $backup = (
        $configPath +
        '.backup-' +
        [DateTime]::Now.ToString('yyyyMMdd-HHmmss-fff')
    )

    Copy-Item `
        -LiteralPath $configPath `
        -Destination $backup

    $temporary = $configPath + '.scan.tmp'

    [System.IO.File]::WriteAllText(
        $temporary,
        ($config | ConvertTo-Json -Depth 20),
        (New-Object System.Text.UTF8Encoding($false))
    )

    Move-Item `
        -LiteralPath $temporary `
        -Destination $configPath `
        -Force

    Write-Host (
        'Added or updated ' +
        $items.Count +
        ' Start-menu applications.'
    )

    Write-Host ('Backup: ' + $backup)
    Write-Host 'Restart the companion, then refresh the phone app.'
} finally {
    $sha.Dispose()
}
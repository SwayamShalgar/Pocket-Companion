param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('On', 'Off')]
    [string]$Mode
)

$ErrorActionPreference = 'Stop'

[Console]::OutputEncoding =
New-Object System.Text.UTF8Encoding($false)

Add-Type -AssemblyName System.Runtime.WindowsRuntime

$null = [
Windows.Devices.Radios.Radio, Windows.System.Devices,ContentType = WindowsRuntime]

$null = [
Windows.Devices.Radios.RadioAccessStatus, Windows.System.Devices,ContentType = WindowsRuntime]

$null = [
Windows.Devices.Radios.RadioState, Windows.System.Devices,ContentType = WindowsRuntime]

$script:asTask =
[System.WindowsRuntimeSystemExtensions].GetMethods() |
Where-Object {
    $_.Name -eq 'AsTask' -and
    $_.IsGenericMethodDefinition -and
    $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq
    'IAsyncOperation`1'
} |
Select-Object -First 1

if (-not $script:asTask) {
    throw 'Windows Runtime radio support is unavailable.'
}

function Wait-RadioOperation {
    param(
        [object]$Operation,
        [type]$ResultType
    )

    $method = $script:asTask.MakeGenericMethod(
        @($ResultType)
    )

    $task = $method.Invoke(
        $null,
        @($Operation)
    )

    if (-not $task.Wait(15000)) {
        throw 'Windows Bluetooth request timed out.'
    }

    return $task.Result
}

$access = Wait-RadioOperation `
([Windows.Devices.Radios.Radio]::RequestAccessAsync()) `
([Windows.Devices.Radios.RadioAccessStatus])

if ($access.ToString() -ne 'Allowed') {
    throw "Windows denied Bluetooth radio access ($access). Open Bluetooth settings on the laptop and check its permissions or device policy."
}

$radios = Wait-RadioOperation `
([Windows.Devices.Radios.Radio]::GetRadiosAsync()) `
([System.Collections.Generic.IReadOnlyList[Windows.Devices.Radios.Radio]])

$bluetooth = @(
    $radios |
    Where-Object {
        $_.Kind.ToString() -eq 'Bluetooth'
    }
)

if ($bluetooth.Count -eq 0) {
    throw 'No controllable Bluetooth radio was found on this laptop.'
}

$target = [Enum]::Parse(
    [Windows.Devices.Radios.RadioState],
    $Mode,
    $true
)

foreach ($radio in $bluetooth) {
    $result = Wait-RadioOperation `
    ($radio.SetStateAsync($target)) `
    ([Windows.Devices.Radios.RadioAccessStatus])

    if ($result.ToString() -ne 'Allowed') {
        throw "Windows refused the Bluetooth change ($result). Use Bluetooth settings on the laptop."
    }
}

@{
    requestedState = $Mode
    radios         = $bluetooth.Count
} | ConvertTo-Json -Compress
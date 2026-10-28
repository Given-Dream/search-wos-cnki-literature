param([int]$InspectProcessId = 0, [switch]$CheckRuntime)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

if ($InspectProcessId -gt 0 -or $CheckRuntime) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class LiteratureEdgeWindow {
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [DllImport("user32.dll")] static extern IntPtr GetThreadDesktop(uint threadId);
    [DllImport("user32.dll")] static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
    [DllImport("user32.dll")] static extern bool CloseDesktop(IntPtr desktop);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern bool GetUserObjectInformation(IntPtr handle, int index, StringBuilder text, uint length, out uint needed);
    static string Name(IntPtr desktop) {
        if (desktop == IntPtr.Zero) return "";
        var text = new StringBuilder(256); uint needed;
        return GetUserObjectInformation(desktop, 2, text, 512, out needed) ? text.ToString() : "";
    }
    public static string WindowDesktop(IntPtr window) {
        uint processId; uint threadId = GetWindowThreadProcessId(window, out processId);
        return Name(GetThreadDesktop(threadId));
    }
    public static string InputDesktop() {
        IntPtr desktop = OpenInputDesktop(0, false, 1);
        try { return Name(desktop); } finally { if (desktop != IntPtr.Zero) CloseDesktop(desktop); }
    }
}
'@
    if ($CheckRuntime) {
        @{ nativeApiLoaded = $true; inputDesktopAvailable = ([LiteratureEdgeWindow]::InputDesktop().Length -gt 0) } | ConvertTo-Json -Compress
        exit 0
    }
    $edgeProcess = Get-Process -Id $InspectProcessId
    if ($edgeProcess.ProcessName -ne 'msedge') { throw 'The CDP browser PID is not Microsoft Edge.' }
    $deadline = [DateTime]::UtcNow.AddSeconds(5)
    do {
        $edgeProcess.Refresh()
        $handle = $edgeProcess.MainWindowHandle
        $inputDesktop = [LiteratureEdgeWindow]::InputDesktop()
        $windowDesktop = if ($handle -ne [IntPtr]::Zero) { [LiteratureEdgeWindow]::WindowDesktop($handle) } else { '' }
        $visible = ($handle -ne [IntPtr]::Zero -and [LiteratureEdgeWindow]::IsWindowVisible($handle))
        $interactive = ($inputDesktop.Length -gt 0 -and $windowDesktop -eq $inputDesktop)
        if ($visible -and $interactive) { break }
        Start-Sleep -Milliseconds 200
    } while ([DateTime]::UtcNow -lt $deadline -and -not $edgeProcess.HasExited)
    [ordered]@{
        browserProcessId = $InspectProcessId
        windowHandle = $handle.ToInt64()
        visible = $visible
        interactiveDesktop = $interactive
        minimized = ($handle -ne [IntPtr]::Zero -and [LiteratureEdgeWindow]::IsIconic($handle))
        method = 'Windows native window handle, visibility and input-desktop match; no activation'
    } | ConvertTo-Json -Compress
    exit 0
}

$launch = [Console]::In.ReadToEnd() | ConvertFrom-Json
if (-not (Test-Path -LiteralPath $launch.edgePath -PathType Leaf)) { throw 'Microsoft Edge executable not found.' }
function ConvertTo-WindowsArgument([string]$Value) {
    $escaped = [regex]::Replace($Value, '(\\*)"', '$1$1\"')
    $escaped = [regex]::Replace($escaped, '(\\+)$', '$1$1')
    return '"' + $escaped + '"'
}
$arguments = @($launch.edgeArgs | ForEach-Object { ConvertTo-WindowsArgument ([string]$_) })
$started = Start-Process -FilePath $launch.edgePath -ArgumentList ($arguments -join ' ') -WindowStyle Normal -PassThru
@{ childPid = $started.Id; launchMethod = 'Windows-Start-Process-Normal' } | ConvertTo-Json -Compress

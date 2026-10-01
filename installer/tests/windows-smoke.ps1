# The 2.0.x window on a real Windows desktop (GitHub's windows runner, .github/workflows/installer.yml): Setup.bat's
# hand-over, no console window anywhere, the window in front with its own icon, a second start bringing it back, and
# pictures of it all. Windows PowerShell 5.1. Exit code 1 when a check fails. Touches only this (throwaway) PC user.
param([string]$Out = "shots")
$ErrorActionPreference = "Stop"
$inst = Split-Path -Parent (Split-Path -Parent $PSCommandPath)   # installer\
[void][IO.Directory]::CreateDirectory($Out)
$Out = (Resolve-Path $Out).Path
$bad = 0
function Check($name, $ok) { if ($ok) { Write-Host "  [OK] $name" } else { Write-Host "  [FAIL] $name"; $script:bad++ } }
function Soft($name, $ok) { if ($ok) { Write-Host "  [OK] $name" } else { Write-Host "::warning::$name"; Write-Host "  [WARN] $name" } }

Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type -Namespace Smoke -Name W -MemberDefinition @"
public delegate bool EnumProc(System.IntPtr h, System.IntPtr l);
[DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, System.IntPtr l);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(System.IntPtr h);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr h, out uint pid);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(System.IntPtr h, System.Text.StringBuilder s, int n);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(System.IntPtr h, System.Text.StringBuilder s, int n);
[DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();
"@
function Get-Windows {
  $list = New-Object System.Collections.Generic.List[object]
  $cb = [Smoke.W+EnumProc]{ param($h, $l)
    if ([Smoke.W]::IsWindowVisible($h)) {
      $c = New-Object Text.StringBuilder 256; $t = New-Object Text.StringBuilder 512; $pid2 = [uint32]0
      [void][Smoke.W]::GetClassName($h, $c, 256); [void][Smoke.W]::GetWindowText($h, $t, 512); [void][Smoke.W]::GetWindowThreadProcessId($h, [ref]$pid2)
      $list.Add([pscustomobject]@{ handle = $h; class = $c.ToString(); title = $t.ToString(); pid = [int]$pid2 })
    }
    return $true }
  [void][Smoke.W]::EnumWindows($cb, [IntPtr]::Zero)
  return $list
}
function Get-Ours { @(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'DeepslateWorks\.ps1' -and $_.CommandLine -notmatch '-Setup' -and $_.CommandLine -notmatch 'windows-smoke' }) }
function Save-Screen([string]$name) {
  try {
    $b = [Windows.Forms.SystemInformation]::VirtualScreen
    $bmp = New-Object Drawing.Bitmap $b.Width, $b.Height
    $g = [Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.Left, $b.Top, 0, 0, $bmp.Size); $g.Dispose()
    $bmp.Save((Join-Path $Out $name), [Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
    Write-Host "  screen: $name"
  } catch { Write-Host "  (no screen picture: $($_.Exception.Message))" }
}
function Write-WindowList([string]$name) { Get-Windows | Where-Object { $_.title -or $_.class -match 'Console|CASCADIA' } | Format-Table -AutoSize class, title, pid | Out-String -Width 200 | Set-Content -LiteralPath (Join-Path $Out $name) }

# a download, as Alex would have it after Extract All
$dl = Join-Path $env:TEMP "smoke-download"
Remove-Item $dl -Recurse -Force -ErrorAction SilentlyContinue
[void][IO.Directory]::CreateDirectory($dl)
Copy-Item (Join-Path $inst "DeepslateWorks.ps1"), (Join-Path $inst "Setup.bat") $dl
$log = Join-Path $env:TEMP "deepslate-works.log"
Remove-Item $log -Force -ErrorAction SilentlyContinue

Write-Host "Setup.bat (first run, its own console window)"
$t0 = Get-Date
$setup = Start-Process -FilePath "cmd.exe" -ArgumentList @("/c", ('"{0}"' -f (Join-Path $dl "Setup.bat"))) -PassThru
$closed = $setup.WaitForExit(120000)
Check ("Setup.bat closed its console by itself once the window was up ({0:N1} s, exit {1})" -f ((Get-Date) - $t0).TotalSeconds, $(if ($closed) { $setup.ExitCode } else { "-" })) ($closed -and $setup.ExitCode -eq 0)
Start-Sleep -Seconds 3
$home1 = Join-Path $env:LOCALAPPDATA "DeepslateWorks"
Check "the script, its shim and its icon are in %LOCALAPPDATA%\DeepslateWorks" ((Test-Path (Join-Path $home1 "DeepslateWorks.ps1")) -and (Test-Path (Join-Path $home1 "DeepslateWorks.vbs")) -and (Test-Path (Join-Path $home1 "DeepslateWorks.ico")))

$ours = Get-Ours
$app = @($ours | Where-Object { $_.CommandLine -notmatch '-Engine' })
Check ("one window process ({0})" -f (($app | ForEach-Object { $_.ProcessId }) -join ",")) ($app.Count -eq 1)
$ids = @($ours | ForEach-Object { [int]$_.ProcessId })
$kids = @(Get-CimInstance Win32_Process | Where-Object { $ids -contains [int]$_.ParentProcessId } | ForEach-Object { [int]$_.ProcessId })
$wins = Get-Windows
$mine = @($wins | Where-Object { ($ids + $kids) -contains $_.pid })
$consoles = @($wins | Where-Object { $_.class -match '^(ConsoleWindowClass|CASCADIA_HOSTING_WINDOW_CLASS)$' -and (($ids + $kids) -contains $_.pid -or $_.title -match 'Deepslate|powershell') })
Check ("no console window to be seen (" + (($consoles | ForEach-Object { $_.class + " '" + $_.title + "'" }) -join "; ") + ")") ($consoles.Count -eq 0)
$main = @($mine | Where-Object { $_.title -match '^Deepslate Works \d' })
Check ("the app window is up: '" + (($main | ForEach-Object { $_.title }) -join "', '") + "'") ($main.Count -eq 1)
if ($main.Count -eq 1) { Soft "the app window is in front" ([Smoke.W]::GetForegroundWindow() -eq $main[0].handle) }
Save-Screen "1-first-run.png"
Write-WindowList "1-windows.txt"

Write-Host "Started again from the desktop shortcut's command (the shim), while the window is open"
$sh = New-Object -ComObject WScript.Shell
[void]([Windows.Forms.Form]@{ Text = "in the way"; TopMost = $false; Width = 900; Height = 700; StartPosition = "CenterScreen" }).Show()   # something else in front
Start-Sleep -Seconds 1
Start-Process -FilePath (Join-Path $env:SystemRoot "System32\wscript.exe") -ArgumentList @(('"{0}"' -f (Join-Path $home1 "DeepslateWorks.vbs")), "-From", "desktop")
Start-Sleep -Seconds 6
Check "still one window process" (@(Get-Ours | Where-Object { $_.CommandLine -notmatch '-Engine' }).Count -eq 1)
$main2 = @(Get-Windows | Where-Object { $_.title -match '^Deepslate Works \d' })
if ($main2.Count -ge 1) { Soft "brought back to the front" ([Smoke.W]::GetForegroundWindow() -eq $main2[0].handle) }
$consoles = @(Get-Windows | Where-Object { $_.class -match '^(ConsoleWindowClass|CASCADIA_HOSTING_WINDOW_CLASS)$' -and $_.title -match 'Deepslate|powershell|wscript' })
Check "and no console window then either" ($consoles.Count -eq 0)
Save-Screen "2-started-again.png"
Write-WindowList "2-windows.txt"

$text = $(if (Test-Path $log) { Get-Content -Raw $log } else { "" })
Check "the log names the entry points: Setup.bat, setup, desktop" (($text -match 'from Setup\.bat') -and ($text -match 'from setup, by') -and ($text -match 'from desktop, by'))
Check "the log says the window was brought to the front on the second start" ($text -match 'window: started again')
Copy-Item $log (Join-Path $Out "deepslate-works.log") -ErrorAction SilentlyContinue

foreach ($p in @(Get-Ours)) { try { Stop-Process -Id $p.ProcessId -Force } catch {} }

Write-Host "The window's states, drawn (-Screenshots)"
$p = Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ('"{0}"' -f (Join-Path $home1 "DeepslateWorks.ps1")), "-Screenshots", ('"{0}"' -f (Join-Path $Out "window"))) -Wait -PassThru
Check "-Screenshots drew the window" ($p.ExitCode -eq 0 -and @(Get-ChildItem (Join-Path $Out "window") -Filter *.png -ErrorAction SilentlyContinue).Count -gt 0)
Get-Process explorer -ErrorAction SilentlyContinue | Out-Null

if ($bad -gt 0) { Write-Host "$bad check(s) failed"; exit 1 }
Write-Host "All checks passed."

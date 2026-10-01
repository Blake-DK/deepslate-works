# Deepslate Works 3.0 on a real Windows desktop (GitHub's windows runner, .github/workflows/installer.yml, job app):
# the first run from a fresh download (SmartScreen pictured if Windows shows it), the hand-over to the copy in
# %LOCALAPPDATA%, no console window, the window in front, a second start, a 2.x PC moved over to the exe, and the
# uninstall. Pictures in -Out. Never presses Play: that would talk to the real site. Exit 1 when a check fails.
param([Parameter(Mandatory = $true)][string]$Exe, [string]$Out = "shots")
$ErrorActionPreference = "Stop"
[void][IO.Directory]::CreateDirectory($Out)
$Out = (Resolve-Path $Out).Path
$Exe = (Resolve-Path $Exe).Path
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
      $c = New-Object Text.StringBuilder 256; $t = New-Object Text.StringBuilder 512; $p = [uint32]0
      [void][Smoke.W]::GetClassName($h, $c, 256); [void][Smoke.W]::GetWindowText($h, $t, 512); [void][Smoke.W]::GetWindowThreadProcessId($h, [ref]$p)
      $list.Add([pscustomobject]@{ handle = $h; class = $c.ToString(); title = $t.ToString(); pid = [int]$p })
    }
    return $true }
  [void][Smoke.W]::EnumWindows($cb, [IntPtr]::Zero)
  return $list
}
function Save-Screen([string]$name) {
  try {
    $b = [Windows.Forms.SystemInformation]::VirtualScreen
    $bmp = New-Object Drawing.Bitmap $b.Width, $b.Height
    $g = [Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.Left, $b.Top, 0, 0, $bmp.Size); $g.Dispose()
    $bmp.Save((Join-Path $Out $name), [Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
    Write-Host "  screen: $name"
  } catch { Write-Host "  (no screen picture: $($_.Exception.Message))" }
}
function Get-Ours { @(Get-Process DeepslateWorks -ErrorAction SilentlyContinue) }
function Stop-Ours { Get-Ours | ForEach-Object { try { $_.Kill(); $_.WaitForExit(5000) | Out-Null } catch {} } }
function Wait-Up([int]$sec) {
  $up = New-Object Threading.EventWaitHandle($false, [Threading.EventResetMode]::ManualReset, "Local\DeepslateWorks.App.Up")
  $up.Reset() | Out-Null
  return $up
}
function Main-Window { @(Get-Windows | Where-Object { $_.title -match '^Deepslate Works \d' -and (Get-Ours | ForEach-Object { $_.Id }) -contains $_.pid }) }
function Consoles { @(Get-Windows | Where-Object { $_.class -match '^(ConsoleWindowClass|CASCADIA_HOSTING_WINDOW_CLASS)$' -and $_.title -match 'Deepslate|DeepslateWorks' }) }

$homeDir = Join-Path $env:LOCALAPPDATA "DeepslateWorks"
$homeExe = Join-Path $homeDir "DeepslateWorks.exe"
$log = Join-Path $env:TEMP "deepslate-works.log"
Remove-Item $log -Force -ErrorAction SilentlyContinue
$version = ((Get-Item $Exe).VersionInfo.ProductVersion -split '\+')[0]
"{0}: {1:N0} bytes" -f $Exe, (Get-Item $Exe).Length | Write-Host

Write-Host "A fresh download (marked as from the internet, as a browser does)"
$dlDir = Join-Path $env:USERPROFILE "Downloads"
[void][IO.Directory]::CreateDirectory($dlDir)
$dl = Join-Path $dlDir "DeepslateWorks.exe"
Copy-Item $Exe $dl -Force
Set-Content -Path $dl -Stream Zone.Identifier -Value "[ZoneTransfer]`r`nZoneId=3`r`nReferrerUrl=https://deepslate.dsw.test/help`r`nHostUrl=https://deepslate.dsw.test/downloads/DeepslateWorks.exe"
# Explorer opens it the way a double-click does; SmartScreen shows its box then: the picture for the Help page, then
# More info and Run anyway, clicked as a person would (UI Automation)
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type -Namespace Smoke -Name R -MemberDefinition @"
[StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
[DllImport("user32.dll")] public static extern bool GetWindowRect(System.IntPtr h, out RECT r);
"@
function Find-Named($root, [string]$name) { return $root.FindFirst([Windows.Automation.TreeScope]::Descendants, (New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::NameProperty, $name))) }
function Save-Crop([IntPtr]$h, [string]$name) {
  $r = New-Object Smoke.R+RECT; [void][Smoke.R]::GetWindowRect($h, [ref]$r)
  $w = $r.Right - $r.Left; $hh = $r.Bottom - $r.Top
  if ($w -le 0 -or $hh -le 0) { return }
  $bmp = New-Object Drawing.Bitmap $w, $hh
  $g = [Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($r.Left, $r.Top, 0, 0, $bmp.Size); $g.Dispose()
  $bmp.Save((Join-Path $Out $name), [Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
  Write-Host "  picture: $name ($w x $hh)"
}
$up = Wait-Up
Start-Process explorer.exe -ArgumentList ('"{0}"' -f $dl)
$box = $null
for ($i = 0; $i -lt 60 -and -not $box; $i++) {
  Start-Sleep -Milliseconds 500
  if ($up.WaitOne(0)) { break }
  $box = @(Get-Windows | Where-Object { (Get-Process -Id $_.pid -ErrorAction SilentlyContinue).ProcessName -eq 'smartscreen' -or $_.title -match 'Windows protected your PC|SmartScreen' })[0]
}
if ($box) {
  Write-Host "  SmartScreen showed its box"
  Start-Sleep -Seconds 1
  Save-Screen "0-smartscreen.png"
  $ui = [Windows.Automation.AutomationElement]::FromHandle($box.handle)
  $more = Find-Named $ui "More info"
  if ($more) {
    try { $more.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke() } catch { try { $more.GetCurrentPattern([Windows.Automation.TogglePattern]::Pattern).Toggle() } catch { Write-Host "  could not press More info: $($_.Exception.Message)" } }
    Start-Sleep -Seconds 2
    Save-Crop $box.handle "smartscreen.png"
    Save-Screen "0-smartscreen-more-info.png"
    $run = Find-Named $ui "Run anyway"
    if ($run) { $run.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke(); Write-Host "  pressed Run anyway" }
    else { Write-Host "  no Run anyway button found" }
  } else { Write-Host "  no More info link found" }
} elseif (-not $up.WaitOne(0)) { Write-Host "  SmartScreen did not show within 30 s"; Save-Screen "0-after-double-click.png" }
if (-not $up.WaitOne(15000)) {
  # SmartScreen held it, or Explorer did not start it: start it the way Run anyway does
  Write-Host "  starting it as Run anyway would"
  Get-Process smartscreen -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Unblock-File $dl
  Start-Process -FilePath $dl
}
Check "the window said it is up within 60 s" ($up.WaitOne(60000))
Start-Sleep -Seconds 3
Check "it put itself in %LOCALAPPDATA%\DeepslateWorks" (Test-Path $homeExe)
$procs = Get-Ours
Check ("one Deepslate Works process, the copy in AppData (" + (($procs | ForEach-Object { $_.Path }) -join ", ") + ")") ($procs.Count -eq 1 -and $procs[0].Path -eq $homeExe)
$apps = Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\DeepslateWorks" -ErrorAction SilentlyContinue
Check ("Settings -> Apps lists it: " + $apps.UninstallString) ($apps -and $apps.UninstallString -match [regex]::Escape($homeExe) -and $apps.DisplayVersion -eq $version)
$main = @(Main-Window)
Check ("the window ({0} found, want 'Deepslate Works {1}'): '{2}'" -f $main.Count, $version, (($main | ForEach-Object { $_.title + "' pid " + $_.pid }) -join "; '")) ($main.Count -ge 1 -and $main[0].title -eq "Deepslate Works $version")
if ($main.Count -ge 1) { Soft "the window is in front" ([Smoke.W]::GetForegroundWindow() -eq $main[0].handle) }
Check "no console window" ((Consoles).Count -eq 0)
Save-Screen "1-first-run.png"

Write-Host "Started again (the desktop shortcut's command) while it is open, with something else in front"
[void]([Windows.Forms.Form]@{ Text = "in the way"; Width = 900; Height = 700; StartPosition = "CenterScreen" }).Show()
Start-Sleep -Seconds 1
Start-Process -FilePath $homeExe -ArgumentList @("-From", "desktop")
Start-Sleep -Seconds 5
Check "still one window" ((Get-Ours).Count -eq 1)
$main = @(Main-Window)
if ($main.Count -ge 1) { Soft "brought back to the front" ([Smoke.W]::GetForegroundWindow() -eq $main[0].handle) }
Save-Screen "2-started-again.png"
$text = $(if (Test-Path $log) { Get-Content -Raw $log } else { "" })
Check "the log names the entry points (a download, download, desktop)" (($text -match 'from a download') -and ($text -match 'from download, by') -and ($text -match 'from desktop, by'))
Stop-Ours

Write-Host "The window's states, drawn (-Screenshots)"
$p = Start-Process -FilePath $homeExe -ArgumentList @("-Screenshots", ('"{0}"' -f (Join-Path $Out "window"))) -Wait -PassThru
Check "-Screenshots drew the window" ($p.ExitCode -eq 0 -and @(Get-ChildItem (Join-Path $Out "window") -Filter *.png -ErrorAction SilentlyContinue).Count -gt 0)

Write-Host "A 2.x PC: the bridge put the exe in place and started it (-MigratedFrom); the exe takes the PC over"
$vbs = Join-Path $homeDir "DeepslateWorks.vbs"
foreach ($f in @("DeepslateWorks.ps1", "DeepslateWorks.vbs", "DeepslateWorks.ico", "install.ps1.bak")) { Set-Content -Path (Join-Path $homeDir $f) -Value "2.x" }
$key = "HKCU:\Software\Classes\deepslate"
New-Item -Path "$key\shell\open\command" -Force | Out-Null
Set-Item -Path $key -Value "URL:Deepslate Works"
New-ItemProperty -Path $key -Name "URL Protocol" -Value "" -PropertyType String -Force | Out-Null
Set-Item -Path "$key\shell\open\command" -Value ('"{0}\System32\wscript.exe" "{1}" "%1"' -f $env:SystemRoot, $vbs)
$sh = New-Object -ComObject WScript.Shell
$lnk = $sh.CreateShortcut((Join-Path ([Environment]::GetFolderPath("Desktop")) "Deepslate Works.lnk")); $lnk.TargetPath = "$env:SystemRoot\System32\wscript.exe"; $lnk.Arguments = ('"{0}" -From desktop' -f $vbs); $lnk.Save()
# what 2.x answered (the same consent.json): the Play link and the shortcuts allowed. "signin" left unanswered so the
# window stops at that card and never starts a run against the real site.
$steps = [ordered]@{}; foreach ($s in @("launcher", "java", "neoforge", "mods", "profile", "shortcuts", "reports", "extras")) { $steps[$s] = [ordered]@{ answer = "allow"; level = 1; at = "2026-10-01T12:00:00" } }
[IO.File]::WriteAllText((Join-Path $homeDir "consent.json"), (ConvertTo-Json -InputObject ([ordered]@{ version = 1; steps = $steps }) -Depth 4))
$up = Wait-Up
Start-Process -FilePath $homeExe -ArgumentList @("-From", "update", "-MigratedFrom", "2.1.3")
Check "the exe's window opened" ($up.WaitOne(60000))
Start-Sleep -Seconds 10   # the switch-over runs right after the window opens; the run itself goes on to the site and may fail here
$cmd = [string](Get-Item "$key\shell\open\command" -ErrorAction SilentlyContinue).GetValue("")
Check ("the Play link now starts the exe: " + $cmd) ($cmd -eq ('"{0}" "%1"' -f $homeExe))
$lnk = $sh.CreateShortcut((Join-Path ([Environment]::GetFolderPath("Desktop")) "Deepslate Works.lnk"))
Check ("the desktop shortcut starts the exe: " + $lnk.TargetPath + " " + $lnk.Arguments) ($lnk.TargetPath -eq $homeExe -and $lnk.Arguments -eq "-From desktop")
Check "the Start Menu has it and its uninstall" ((Test-Path (Join-Path ([Environment]::GetFolderPath("Programs")) "Deepslate Works.lnk")) -and (Test-Path (Join-Path ([Environment]::GetFolderPath("Programs")) "Uninstall Deepslate Works.lnk")))
$left = @("DeepslateWorks.ps1", "DeepslateWorks.vbs", "DeepslateWorks.ico", "install.ps1.bak" | Where-Object { Test-Path (Join-Path $homeDir $_) })
Check ("the 2.x files are gone (left: " + ($left -join ", ") + ")") ($left.Count -eq 0)
$text = $(if (Test-Path $log) { Get-Content -Raw $log } else { "" })
Check "the log says it came from 2.1.3" ($text -match 'updated from 2\.1\.3')
Save-Screen "3-migrated.png"
Stop-Ours
Copy-Item $log (Join-Path $Out "deepslate-works.log") -ErrorAction SilentlyContinue

Write-Host "Uninstall (Settings -> Apps' command, without the question)"
$p = Start-Process -FilePath $homeExe -ArgumentList @("-Uninstall", "-Yes", "-From", "apps") -Wait -PassThru
Start-Sleep -Seconds 8   # the folder with the running exe goes a few seconds after it exits
Check ("it ended without an error (exit {0})" -f $p.ExitCode) ($p.ExitCode -eq 0)
Check "Settings -> Apps no longer lists it" (-not (Test-Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\DeepslateWorks"))
Check "the Play link is gone" (-not (Test-Path $key))
Check "the shortcuts are gone" (-not (Test-Path (Join-Path ([Environment]::GetFolderPath("Desktop")) "Deepslate Works.lnk")) -and -not (Test-Path (Join-Path ([Environment]::GetFolderPath("Programs")) "Deepslate Works.lnk")))
Check "and its folder in AppData" (-not (Test-Path $homeDir))

if ($bad -gt 0) { Write-Host "$bad check(s) failed"; exit 1 }
Write-Host "All checks passed."

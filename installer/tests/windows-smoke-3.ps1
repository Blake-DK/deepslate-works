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

# 3.1.0 (planner A5): the old launcher 2.2.0 downloads the app itself (HttpWebRequest, no "from the internet" mark) and
# starts it with Start-Process. Does SmartScreen stop that? First, before Windows has seen this exe run from a download.
Write-Host "Started the way the old launcher 2.2.0 starts it (its own download: no Zone.Identifier)"
$hoDir = Join-Path $env:TEMP "handover-check"
[void][IO.Directory]::CreateDirectory($hoDir)
$hoExe = Join-Path $hoDir "DeepslateWorks.exe"
Copy-Item $Exe $hoExe -Force
Check "no 'from the internet' mark on it" (-not (Get-Item $hoExe -Stream Zone.Identifier -ErrorAction SilentlyContinue))
$hoShots = Join-Path $Out "handover-check"
$p = Start-Process -FilePath $hoExe -ArgumentList @("-Screenshots", ('"{0}"' -f $hoShots)) -PassThru
$smart = $null
for ($i = 0; $i -lt 40 -and -not $p.HasExited -and -not $smart; $i++) {
  Start-Sleep -Milliseconds 500
  $smart = @(Get-Windows | Where-Object { (Get-Process -Id $_.pid -ErrorAction SilentlyContinue).ProcessName -eq 'smartscreen' -or $_.title -match 'Windows protected your PC|SmartScreen' })[0]
}
if ($smart) { Save-Screen "0-handover-smartscreen.png"; Get-Process smartscreen -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue }
Check ("SmartScreen does not stop the app the old launcher fetched and started" + $(if ($smart) { " (it showed: the 2.2.0 question must say so; set `$HandOverSmartScreen)" } else { "" })) (-not $smart)
try { $p.WaitForExit(60000) | Out-Null } catch {}
Get-ChildItem $hoShots -Filter *.png -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue   # not this run's pictures

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

Write-Host "A PC on the old launcher: 2.2.0 put the app in place and started it (-HandOver); the guided setup takes the PC over"
$vbs = Join-Path $homeDir "DeepslateWorks.vbs"
foreach ($f in @("DeepslateWorks.ps1", "DeepslateWorks.vbs", "DeepslateWorks.ico", "install.ps1.bak")) { Set-Content -Path (Join-Path $homeDir $f) -Value "2.x" }
$key = "HKCU:\Software\Classes\deepslate"
New-Item -Path "$key\shell\open\command" -Force | Out-Null
Set-Item -Path $key -Value "URL:Deepslate Works"
New-ItemProperty -Path $key -Name "URL Protocol" -Value "" -PropertyType String -Force | Out-Null
Set-Item -Path "$key\shell\open\command" -Value ('"{0}\System32\wscript.exe" "{1}" "%1"' -f $env:SystemRoot, $vbs)
$sh = New-Object -ComObject WScript.Shell
$lnk = $sh.CreateShortcut((Join-Path ([Environment]::GetFolderPath("Desktop")) "Deepslate Works.lnk")); $lnk.TargetPath = "$env:SystemRoot\System32\wscript.exe"; $lnk.Arguments = ('"{0}" -From desktop' -f $vbs); $lnk.Save()
# what 2.x answered (the same consent.json). "signin" left unanswered: the Permissions step then shows that one card
# (only what is new is asked), and Play is never pressed, so nothing talks to the real site.
$steps = [ordered]@{}; foreach ($s in @("launcher", "java", "neoforge", "mods", "profile", "shortcuts", "reports", "extras")) { $steps[$s] = [ordered]@{ answer = "allow"; level = 1; at = "2026-10-01T12:00:00" } }
$steps["reports"].answer = "decline"
$consentText = ConvertTo-Json -InputObject ([ordered]@{ version = 1; steps = $steps }) -Depth 4
[IO.File]::WriteAllText((Join-Path $homeDir "consent.json"), $consentText)
$extrasText = '{"version":1,"choices":{"iris":true},"shader":"light"}'
[IO.File]::WriteAllText((Join-Path $homeDir "extras.json"), $extrasText)
$sum = (Get-FileHash $homeExe -Algorithm SHA256).Hash.ToLower()
[IO.File]::WriteAllText((Join-Path $homeDir "handover.json"), ('{{"version":1,"from":"2.2.0","app":"{0}","sha256":"{1}","state":"downloaded","at":"2026-10-02T06:00:00Z","steps":{{}}}}' -f $version, $sum))
function Hand-State { try { return [string]((Get-Content -Raw (Join-Path $homeDir "handover.json") | ConvertFrom-Json).state) } catch { return "" } }
function Press([string]$name) {
  $w = Main-Window | Select-Object -First 1
  if (-not $w) { return $false }
  $root = [Windows.Automation.AutomationElement]::FromHandle($w.handle)
  $b = Find-Named $root $name
  if (-not $b) { return $false }
  $b.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()
  Start-Sleep -Milliseconds 800
  return $true
}
function Shot-Window([string]$name) { $w = Main-Window | Select-Object -First 1; if ($w) { Save-Crop $w.handle $name } else { Save-Screen $name } }
$up = Wait-Up
Start-Process -FilePath $homeExe -ArgumentList @("-From", "update", "-HandOver", "2.2.0")
Check "the app's window opened" ($up.WaitOne(60000))
Start-Sleep -Seconds 3
Shot-Window "3a-guided-1-welcome.png"
$cmd0 = [string](Get-Item "$key\shell\open\command" -ErrorAction SilentlyContinue).GetValue("")
Check "nothing moved before Next: the old launcher still has the Play link" ($cmd0 -match 'wscript' -and (Test-Path (Join-Path $homeDir "DeepslateWorks.ps1")))
Check "Welcome -> Next" (Press "Next")
for ($i = 0; $i -lt 30 -and (Hand-State) -ne "moved"; $i++) { Start-Sleep -Seconds 1 }
Start-Sleep -Seconds 1
Shot-Window "3b-guided-2-move-over.png"
Check ("Move over finished (handover.json: " + (Hand-State) + ")") ((Hand-State) -eq "moved")
$cmd = [string](Get-Item "$key\shell\open\command" -ErrorAction SilentlyContinue).GetValue("")
Check ("the Play link now starts the app: " + $cmd) ($cmd -eq ('"{0}" "%1"' -f $homeExe))
$lnk = $sh.CreateShortcut((Join-Path ([Environment]::GetFolderPath("Desktop")) "Deepslate Works.lnk"))
Check ("the desktop shortcut starts the app: " + $lnk.TargetPath + " " + $lnk.Arguments) ($lnk.TargetPath -eq $homeExe -and $lnk.Arguments -eq "-From desktop")
Check "the Start Menu has it and its uninstall" ((Test-Path (Join-Path ([Environment]::GetFolderPath("Programs")) "Deepslate Works.lnk")) -and (Test-Path (Join-Path ([Environment]::GetFolderPath("Programs")) "Uninstall Deepslate Works.lnk")))
$left = @("DeepslateWorks.ps1", "DeepslateWorks.vbs", "DeepslateWorks.ico", "install.ps1.bak" | Where-Object { Test-Path (Join-Path $homeDir $_) })
Check ("the old launcher's files are gone (left: " + ($left -join ", ") + ")") ($left.Count -eq 0)
Check "consent.json and extras.json carried over untouched" (([IO.File]::ReadAllText((Join-Path $homeDir "consent.json")) -eq $consentText) -and ([IO.File]::ReadAllText((Join-Path $homeDir "extras.json")) -eq $extrasText))
Check "Move over -> Next" (Press "Next")
Shot-Window "3c-guided-3-permissions.png"
Check "Permissions: only the new card, answered with Allow all" (Press "Allow all")
Start-Sleep -Seconds 2
Shot-Window "3d-guided-4-extras.png"
Check "Extras -> Continue" (Press "Continue")
Start-Sleep -Seconds 2
Shot-Window "3e-guided-done.png"
Check ("the move is done (handover.json: " + (Hand-State) + ")") ((Hand-State) -eq "done")
$c = Get-Content -Raw (Join-Path $homeDir "consent.json") | ConvertFrom-Json
Check "what was answered before stayed answered (reports: Not now), the new card was added" (($c.steps.reports.answer -eq "decline") -and ($c.steps.signin.answer -eq "allow"))
$text = $(if (Test-Path $log) { Get-Content -Raw $log } else { "" })
Check "the log says it came from 2.2.0" ($text -match 'updated from 2\.2\.0')
$sinceHandOver = $(if ($text.LastIndexOf('updated from 2.2.0') -ge 0) { $text.Substring($text.LastIndexOf('updated from 2.2.0')) } else { "" })
Check "nothing started the game: no run after the guided setup" ($sinceHandOver -and -not ($sinceHandOver -match 'window: starting the install steps'))
Stop-Ours
Write-Host "Started again after it was cut off: a move that is not done opens the guided setup again"
$st = Get-Content -Raw (Join-Path $homeDir "handover.json") | ConvertFrom-Json; $st.state = "moved"; [IO.File]::WriteAllText((Join-Path $homeDir "handover.json"), ($st | ConvertTo-Json))
$up = Wait-Up
Start-Process -FilePath $homeExe -ArgumentList @("-From", "desktop")
Check "the window opened" ($up.WaitOne(60000))
Start-Sleep -Seconds 3
Shot-Window "3f-resumed.png"
$text = $(if (Test-Path $log) { Get-Content -Raw $log } else { "" })
Check "it carried on at Permissions (handover.json said moved)" ($text -match 'the guided setup \(handover\.json: moved\)')
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

# Deepslate Works. One script does everything: the first install, every update, and every Play.
# PowerShell 5.1, no modules, no admin rights. See docs/07-installer.md.
#
#   Setup.bat (from the download, once)   DeepslateWorks.ps1 -Setup: puts this script in %LOCALAPPDATA%\DeepslateWorks,
#                                         registers deepslate:// and the "Deepslate Works" shortcuts, then runs that copy
#   the Play button on the site           deepslate://play  -> the copy in %LOCALAPPDATA%\DeepslateWorks
#   the desktop / Start Menu shortcut     the same copy, the same steps
#
# Every run, in this order, skipping whatever is already current: take the lock, update this script if the site has a
# newer one, sign in if needed, launcher / Java 21 / NeoForge / mods / settings / profile / server list, report, and
# open the Minecraft Launcher on the profile.
[CmdletBinding(PositionalBinding = $false)]
param(
  [Parameter(Position = 0)]
  [string]$Link = "",       # the deepslate:// link, when Windows starts this from the Play button on the site
  [switch]$Setup,           # from Setup.bat: put this script in place, register the Play link and the shortcuts, run it
  [switch]$DryRun,          # no downloads, no writes outside -Root, no browser
  [string]$Root = "",       # override %APPDATA% (tests)
  [switch]$SelfTest,        # check the script's own code against scratch files, touch nothing else, exit
  [string[]]$PretendRunning = @(),  # tests: process names to treat as running
  [switch]$Uninstall,       # remove Deepslate Works from this PC (Settings -> Apps, or "Uninstall Deepslate Works" in the Start Menu)
  [Alias("Quiet")]
  [switch]$Yes,             # -Uninstall without the question (tests)
  # What a 1.4.x copy passes when its update step starts this script in its place (install.ps1 -Play "deepslate://play",
  # or -Play -Root / -NoPrompt). Taken so that start does not fail, written to the log, and otherwise ignored (1.5.3).
  [switch]$Play,
  [switch]$NoPrompt,
  # 2.0.0, the app (planner 2026-10-01). With none of these, a run on Windows opens the Deepslate Works window.
  [switch]$Engine,          # the install steps, started hidden by the window; progress as JSON lines in -StatusFile
  [string]$StatusFile = "",
  [switch]$Console,         # the steps in this console, every permission taken as given (tests; a PC where WPF fails)
  [switch]$AllowAll,        # tests: every permission taken as given
  [string]$Screenshots = "", # draw the window's main states into PNG files in this folder, then exit
  [switch]$NoLaunch         # the engine: do not open the Minecraft Launcher at the end (the Extras tab's download)
)

# ---- started from a link on a web page ------------------------------------------------------------------
# ANY web page can put a deepslate:// link in front of someone, so: exactly one link is accepted, and when the
# script was started by a link nothing else on the command line counts. It installs where it always installs,
# from the site it was built for, and does nothing a normal run would not do.
function Test-PlayLink([string]$l) { return ($l -match '^deepslate://play/?$') }

$FromOldUpdater = ($Play -or $NoPrompt)   # logged once the log is there
$FromLink = ($Link -ne "")
if ($FromLink) {
  if (-not (Test-PlayLink $Link)) {
    Write-Host "That is not a link Deepslate Works knows. Use the Play button on the site." -ForegroundColor Red
    Start-Sleep -Seconds 6
    exit 1
  }
  $Setup = $false; $DryRun = $false; $SelfTest = $false; $Root = ""; $PretendRunning = @(); $Uninstall = $false; $Yes = $false; $Play = $false; $NoPrompt = $false
  $Engine = $false; $StatusFile = ""; $Console = $false; $AllowAll = $false; $Screenshots = ""; $NoLaunch = $false
}
# ---- config block (stamped by `modpack build installer`) ----
$PortalUrl = "https://deepslate.dsw.test"
$PackName = "Deepslate Works"
$PackVersion = "dev"
# -------------------------------------------------------------
$InstallerVersion = "2.0.0"   # 2.0.0: the Deepslate Works app: a window, permission per step, the Extras tab. History in docs/07
$ManifestUrl = "$PortalUrl/api/modpack/manifest"
$ScriptName = "DeepslateWorks.ps1"
$LockName = "Global\DeepslateWorks"
$ExitAlreadyRunning = 3

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Temp = if ($env:TEMP) { $env:TEMP } else { [IO.Path]::GetTempPath() }   # $env:TEMP is unset when testing under pwsh on Linux
$LogFile = Join-Path $Temp "deepslate-works.log"
$script:Step = 0
$script:StepName = ""          # the step in hand: what a report calls "the step that failed"
$script:Started = Get-Date
$script:RunLog = New-Object System.Collections.Generic.List[string]   # this run's lines of the log file
$script:Token = $null
$script:Reported = $false
$script:PackSeen = $PackVersion
$script:Lock = $null
# What kind of run this is (docs/07): first_install (nothing installed yet), update (the pack changed since the last
# run), play (everything was current), already_running (another copy holds the lock). Worked out as the run goes.
$Mode = "play"
$Quiet = $true
# Set when an older copy of this script fetched this one and started it in its place. It comes through the
# environment, which a link cannot reach, and it is also what stops a second update in the same run.
$script:UpdatedFrom = $null
if ($env:DEEPSLATE_UPDATED_FROM -match '^\d{1,4}(\.\d{1,4}){1,3}$') { $script:UpdatedFrom = [string]$env:DEEPSLATE_UPDATED_FROM }
$script:UpdateProblem = $null  # why an update that was due was not applied
# What could not be set up: the home copy, the Play link, the shortcuts, the Settings -> Apps entry (1.5.6). Filled by
# Repair-Home; a run started by Setup.bat starts from what Setup found (DEEPSLATE_SETUP_PROBLEMS, which a link cannot set).
$script:SetupProblems = New-Object System.Collections.Generic.List[object]
$script:SetupChecked = $false
# Started by Setup.bat (the window stays open by itself), or by the Play link or a shortcut (it has to wait so a
# message can be read). Set by the -Setup run for the copy it starts; a link cannot set it.
$FromSetup = ($env:DEEPSLATE_FROM_SETUP -eq "1")
$script:Facts = @{ java = $null; neoforge = $null; launcher = $null }
# Words that would identify the person or the PC. They are blanked in everything that is sent.
$script:Personal = @(@($env:USERNAME, [Environment]::UserName, $env:COMPUTERNAME, [Environment]::MachineName) | Where-Object { $_ -and ([string]$_).Length -ge 3 } | Select-Object -Unique)

function Log($msg) {
  $line = "[{0}] {1}" -f (Get-Date -Format s), $msg
  $script:RunLog.Add($line)
  try { Add-Content -LiteralPath $LogFile -Value $line } catch {}
}
function Step($msg) {
  $script:Step++; $script:StepName = [string]$msg
  if ($Quiet) { Write-Host ("  {0} ..." -f $msg) -ForegroundColor DarkGray } else { Write-Host ("`n{0}. {1}" -f $script:Step, $msg) -ForegroundColor Cyan }
  Log "STEP $msg"
  Emit ([ordered]@{ t = "step"; text = [string]$msg })
}
function Tick($msg) { if (-not $Quiet) { Write-Host ("   [OK] {0}" -f $msg) -ForegroundColor Green }; Log "OK $msg"; Emit ([ordered]@{ t = "tick"; text = [string]$msg }) }
# Every file operation takes its path literally (-LiteralPath): with -Path PowerShell reads [ ] in a path as a pattern
# and can fail to resolve a user folder at all (Pabulum's PC, 2026-09-29, installer 1.4.1).
function Remove-Temp($path) {
  # A leftover temporary file is never a reason to stop.
  try { if ($path -and [IO.File]::Exists($path)) { [IO.File]::Delete($path) } } catch { Log ("could not remove " + $path + ": " + $_.Exception.Message) }
}
function Note($msg) { if (-not $Quiet) { Write-Host ("   {0}" -f $msg) -ForegroundColor Gray }; Log $msg; Emit ([ordered]@{ t = "note"; text = [string]$msg }) }
function Hold-Window {
  # Started from the Play button or a shortcut there is no .bat to keep the window open: wait, so the message can be read.
  if (-not $FromSetup -and -not $SelfTest -and -not $DryRun -and -not $Engine -and -not $script:Held) { $script:Held = $true; try { [void](Read-Host "Press Enter to close this window") } catch {} }
}
# What the site answered when it said no: the response body (Windows PowerShell), ErrorDetails (pwsh), or the message
# itself when it is the JSON (the self test's stand-ins throw that).
function Read-ErrorBody($err) {
  $body = ""
  try { $body = (New-Object IO.StreamReader($err.Exception.Response.GetResponseStream())).ReadToEnd() } catch {}
  if (-not $body) { try { $body = [string]$err.ErrorDetails.Message } catch {} }
  if (-not $body) { try { $m = [string]$err.Exception.Message; if ($m.TrimStart().StartsWith("{")) { $body = $m } } catch {} }
  return [string]$body
}
function Gate-Message($err) {
  $body = Read-ErrorBody $err
  if ($body -match "not_live") { return "The server hasn't launched yet. Watch Discord for the date." }
  if ($body -match "server_offline") {
    if ($script:WakeRefused) { return $WakeRefusedText[$script:WakeRefused] }
    return "The server isn't up right now (it is starting, stopping or out of reach), so updates are paused. Try again in a minute."
  }
  return "The site said no (" + $body.Substring(0, [Math]::Min(120, $body.Length)) + ")"
}

# ---- wake on Play (docs/13 §12 B) ---------------------------------------------------------------------------
# Play on a sleeping server starts it through the site before the updates are fetched, so it boots while the game
# loads. The site decides (only from Asleep, one start however often Play is pressed); nothing here can start a
# server that is switched off or crashed. A wake that cannot be asked for is never a reason to stop.
$WakeUrl = "$PortalUrl/api/play/wake"
$WakeText = @{ waking = "Waking the server, ready in about 30 s"; ready = "Server ready"; failed = "The server didn't wake up. Try again in a minute or tell Alex" }
$WakeRefusedText = @{ off = "The server is switched off. Ask Alex in Discord."; crashed = "The server has crashed. Ask Alex in Discord."; unreachable = "The site can't reach the server right now. Try again in a minute." }
$script:WakeRefused = $null
$script:Waking = $false
# $call: { param($method) ... } returns the site's answer; the self test hands in stand-ins.
function Request-Wake($call) {
  try { $r = & $call "POST" }
  catch {
    $body = Read-ErrorBody $_
    $code = ""; try { $code = [string](($body | ConvertFrom-Json).error.code) } catch {}
    if ($code -and $WakeRefusedText.ContainsKey($code)) { $script:WakeRefused = $code }
    Log ("wake: not started ({0})" -f $(if ($code) { $code } else { $_.Exception.Message }))
    return "no"
  }
  if ($r.result -eq "started" -or $r.result -eq "already" -or [string]$r.wake.phase -eq "waking") {
    Write-Host ("   {0}" -f $WakeText.waking) -ForegroundColor Yellow
    Log "wake: the server is waking"
    return "waking"
  }
  Log ("wake: " + [string]$r.result)
  return [string]$r.result
}
# After the launcher opens: asks every 5 s until the server is up or the wake has failed, and says which.
function Watch-Wake($call, $sleep, $limitSec = 200) {
  $t0 = Get-Date
  while (((Get-Date) - $t0).TotalSeconds -lt $limitSec) {
    $phase = ""
    try { $phase = [string](& $call "GET").wake.phase } catch {}
    if ($phase -eq "ready") { Write-Host ("   {0}" -f $WakeText.ready) -ForegroundColor Green; Log "wake: server ready"; return "ready" }
    if ($phase -eq "failed") { Write-Host ("   {0}" -f $WakeText.failed) -ForegroundColor Red; Log "wake: failed"; return "failed" }
    if ($phase -eq "idle") { return "idle" }
    & $sleep 5
  }
  Log "wake: stopped watching"
  return "gave up"
}

# ---- one copy at a time (docs/07 "The lock") -------------------------------------------------------------
# 2026-09-29: m1owl pressed Play while Setup.bat was still downloading; both wrote the same file in mods/ and the
# second run failed. A named mutex is held for the whole run; a second copy says so and leaves without touching
# anything. A copy that was killed leaves the mutex "abandoned", which the next run simply takes over.
function Enter-Lock {
  $m = New-Object System.Threading.Mutex($false, $LockName)
  $got = $false
  try { $got = $m.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $got = $true; Log "the last run did not end properly; carrying on" }
  if (-not $got) { $m.Dispose(); return $null }
  return $m
}
function Exit-Lock {
  if ($script:Lock) { try { $script:Lock.ReleaseMutex() } catch {}; try { $script:Lock.Dispose() } catch {}; $script:Lock = $null }
}

function Fail($msg) {
  Write-Host ""
  Write-Host ("   {0}" -f $msg) -ForegroundColor Red
  Write-Host ("   Details are in {0}" -f $LogFile) -ForegroundColor DarkGray
  Log "FAIL $msg"
  Emit ([ordered]@{ t = "fail"; text = [string]$msg })
  Send-Report "failed"
  Exit-Lock
  Hold-Window
  exit 1
}

# ---- the install report (docs/07 "Install reports") ----------------------------------------------------
# At the end of every run the log of that run and a description of the PC go to the portal, so Alex can
# see what went wrong without asking for screenshots, and so the PC tier is measured instead of guessed.
# Before anything is sent: the name in C:\Users\<name>\ becomes ~, the Windows user name and the PC's
# name are blanked wherever they appear, and tokens, e-mail addresses and network addresses are removed.
# Nothing about the Microsoft account is read at all. The portal does the same again before it stores it.

function Redact([string]$t, [switch]$Addresses) {
  if (-not $t) { return "" }
  $t = [regex]::Replace($t, '(?i)\b([A-Z]):(\\{1,4}|/)(Users|Documents and Settings)(\\{1,4}|/)[^\\/:*?"<>|\r\n]+', '$1:$2$3$4~')
  $t = [regex]::Replace($t, '(^|[\s"''=(])/(home|Users)/[^/\s"'']+', '$1/$2/~')
  foreach ($n in $script:Personal) { $t = [regex]::Replace($t, '(?i)(?<![A-Za-z0-9])' + [regex]::Escape([string]$n) + '(?![A-Za-z0-9])', '~') }
  if ($script:Token) { $t = $t.Replace([string]$script:Token, '~') }
  $t = [regex]::Replace($t, '(?i)\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{4,}', '$1 ~')
  $t = [regex]::Replace($t, '(?i)((?:launcherToken|pollToken|token|password)"?\s*[:=]\s*"?)(?!(?:Bearer|Basic)\s)[^"\s,;}]{4,}', '$1~')
  $t = [regex]::Replace($t, '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '~@~')
  if ($Addresses) {
    $t = [regex]::Replace($t, '(?i)(?<![\w:])(?:(?:[0-9a-f]{1,4}:){3,7}[0-9a-f]{1,4}|(?:[0-9a-f]{1,4}:){1,6}:(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){0,5})?)(?![\w:])', '~ip~')
    $t = [regex]::Replace($t, '(?<![\w.])(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?![\w.]|\.\d)', '~ip~')
  }
  return $t
}

function Shorten([string]$t, [int]$maxBytes) {
  if ([Text.Encoding]::UTF8.GetByteCount($t) -le $maxBytes) { return $t }
  $note = "`n`n[... the middle of the log was cut to fit ...]`n`n"
  $half = [int](($maxBytes - 80) / 2 / 2)   # characters; two bytes each at the very worst for what a log holds
  return $t.Substring(0, $half) + $note + $t.Substring($t.Length - $half)
}

function Get-SystemInfo {
  $s = [ordered]@{ os = $null; cpu = $null; ramGb = $null; gpus = @(); disk = $null; launcher = $script:Facts.launcher; java = $script:Facts.java; neoforge = $script:Facts.neoforge; powershell = [string]$PSVersionTable.PSVersion }
  try {
    $os = Get-CimInstance Win32_OperatingSystem -ErrorAction Stop
    $display = $null
    try { $display = [string](Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion" -ErrorAction Stop).DisplayVersion } catch {}
    $s.os = [ordered]@{ caption = [string]$os.Caption; version = [string]$os.Version; build = [string]$os.BuildNumber; display = $display; arch = [string]$os.OSArchitecture }
  } catch {}
  try {
    $c = @(Get-CimInstance Win32_Processor -ErrorAction Stop)[0]
    $s.cpu = [ordered]@{ name = ([string]$c.Name).Trim(); cores = [int]$c.NumberOfCores; threads = [int]$c.NumberOfLogicalProcessors }
  } catch {}
  try { $s.ramGb = [math]::Round((Get-CimInstance Win32_ComputerSystem -ErrorAction Stop).TotalPhysicalMemory / 1GB, 1) } catch {}
  try {
    $list = @()
    foreach ($g in @(Get-CimInstance Win32_VideoController -ErrorAction Stop)) {
      $vram = $null
      try { if ($g.AdapterRAM) { $vram = [int]([double]$g.AdapterRAM / 1MB) } } catch {}   # Windows reports at most 4 GB here
      $list += [ordered]@{ name = [string]$g.Name; driver = [string]$g.DriverVersion; vramMb = $vram }
    }
    $s.gpus = @($list | Select-Object -First 8)
  } catch {}
  try {
    $drive = Split-Path -Qualifier $Root
    $d = Get-CimInstance Win32_LogicalDisk -Filter ("DeviceID='{0}'" -f $drive) -ErrorAction Stop
    $s.disk = [ordered]@{ drive = [string]$drive; freeGb = [math]::Round($d.FreeSpace / 1GB, 1); totalGb = [math]::Round($d.Size / 1GB, 1) }
  } catch {}
  return $s
}

function Redact-Tree($v) {
  if ($null -eq $v) { return $null }
  if ($v -is [string]) { return (Redact $v) }
  if ($v -is [System.Collections.IDictionary]) { $o = [ordered]@{}; foreach ($k in @($v.Keys)) { $o[$k] = Redact-Tree $v[$k] }; return $o }
  if ($v -is [array]) { return ,@($v | ForEach-Object { Redact-Tree $_ }) }
  return $v
}

function New-Report([string]$outcome) {
  $failed = $null
  if ($outcome -ne "ok" -and $script:StepName) { $failed = $script:StepName }
  $problem = $null
  if ($script:UpdateProblem) { $problem = Redact ([string]$script:UpdateProblem) -Addresses }
  return [ordered]@{
    packVersion      = [string]$script:PackSeen
    installerVersion = $InstallerVersion
    updatedFrom      = $script:UpdatedFrom
    updateProblem    = $problem
    setupProblems    = $(if ($script:SetupChecked) { ,@($script:SetupProblems.ToArray()) } else { $null })
    mode             = $Mode
    outcome          = $outcome
    failedStep       = $failed
    durationSec      = [int]((Get-Date) - $script:Started).TotalSeconds
    log              = Shorten (Redact (($script:RunLog.ToArray()) -join "`n") -Addresses) (512 * 1024)
    system           = $(if ($Mode -eq "uninstall") { $null } else { Redact-Tree (Get-SystemInfo) })   # no PC details when leaving
  }
}

# 1.4.3: the site answers a report with a notice when this installer is older than the one it hands out now
# (the run still counts). Shown as plain text, never run; a Play window started from the site waits so it is read.
function Show-Notice($answer) {
  $text = ""
  try { if ($answer -and $answer.PSObject.Properties["notice"] -and $answer.notice) { $text = [string]$answer.notice } } catch {}
  $text = ($text -replace '[\x00-\x1F\x7F]', ' ').Trim()
  if (-not $text) { return $false }
  if ($text.Length -gt 300) { $text = $text.Substring(0, 300) }
  Write-Host ""
  Write-Host ("   {0}" -f $text) -ForegroundColor Yellow
  Log ("the site says: " + $text)
  Hold-Window
  return $true
}

function Send-Report([string]$outcome) {
  if ($script:Reported) { return }
  $script:Reported = $true
  if ($DryRun -or $SelfTest) { return }
  if (-not $script:Token) { Log "not signed in, so no install report was sent"; return }
  $site = $PortalUrl
  try { $site = ([uri]$PortalUrl).Host } catch {}
  Write-Host ""
  if ($Mode -eq "uninstall") { Write-Host ("Telling {0} that Deepslate Works is being taken off this PC." -f $site) -ForegroundColor Gray }
  else { Write-Host ("Sending the install log to {0} so Alex can help if something went wrong." -f $site) -ForegroundColor Gray }
  try {
    $rep = New-Report $outcome
    # Reports declined in the app (2.0.0): only "pressed Play, pack version" goes, for Play first. No log, no PC details.
    if ($script:ReportsOff) { $rep = [ordered]@{ packVersion = $rep.packVersion; installerVersion = $rep.installerVersion; mode = $rep.mode; outcome = $rep.outcome; durationSec = $rep.durationSec; log = ""; system = $null; minimal = $true } }
    $json = $rep | ConvertTo-Json -Depth 8 -Compress
    $answer = Invoke-RestMethod -Uri "$PortalUrl/api/installer/report" -Method Post -Headers @{ Authorization = "Bearer $($script:Token)" } -ContentType "application/json; charset=utf-8" -Body ([Text.Encoding]::UTF8.GetBytes($json)) -UseBasicParsing -TimeoutSec 20
    Write-Host "   Sent." -ForegroundColor Gray
    Log "install report sent"
    $null = Show-Notice $answer
  } catch {
    Write-Host ("   That didn't go through. No harm done: the log is still on this PC, at {0}" -f $LogFile) -ForegroundColor Yellow
    Log ("install report not sent: " + $_.Exception.Message)
  }
}

# ---- the launcher and its profile file -----------------------------------------------------------------
# The Minecraft Launcher keeps launcher_profiles.json in memory while it is open and writes it back
# later, which throws away whatever was written underneath it. On the first real install (2026-09-29)
# that wiped the NeoForge profile and ours: the file was back to the two defaults. So nothing is
# installed or written while the launcher runs, and what was written is read back and checked.

function Find-Launcher {
  $found = @()
  foreach ($n in $PretendRunning) { if ($n) { $found += [string]$n } }
  foreach ($p in @(Get-Process -ErrorAction SilentlyContinue)) {
    $n = [string]$p.ProcessName
    if ($n -eq "MinecraftLauncher" -or $n -eq "Minecraft Launcher") { $found += $n; continue }
    if ($n -eq "Minecraft") {
      # The Store / Xbox launcher runs as Minecraft.exe. (Bedrock is Minecraft.Windows; the game itself is javaw.)
      $path = ""
      try { $path = [string]$p.Path } catch {}
      if ($path -eq "" -or $path -match "Launcher") { $found += $n }
      continue
    }
    $title = ""
    try { $title = [string]$p.MainWindowTitle } catch {}
    if ($title -eq "Minecraft Launcher") { $found += $n }
  }
  return @($found | Select-Object -Unique)
}

function Require-LauncherClosed($before) {
  $running = @(Find-Launcher)
  if ($running.Count -gt 0) {
    Log ("launcher is running ({0}), stopping before: {1}" -f ($running -join ", "), $before)
    Fail "Close the Minecraft Launcher (including the tray icon) and run this again"
  }
}

function Read-Json($path) {
  return ([IO.File]::ReadAllText($path) | ConvertFrom-Json)   # reads with or without a byte-order mark
}

function Write-Json($path, $obj) {
  # No byte-order mark: Windows PowerShell's "Set-Content -Encoding UTF8" adds one, and a launcher that
  # does not expect it treats the file as broken and starts again from its defaults.
  # Written next to the file and moved into place, so a half-written file is never what the launcher finds.
  $text = $obj | ConvertTo-Json -Depth 20
  $tmp = "$path.deepslate-tmp"
  [IO.File]::WriteAllText($tmp, $text, (New-Object Text.UTF8Encoding($false)))
  Move-Item -Force -LiteralPath $tmp -Destination $path
}

function Set-LauncherProfile($path, $id, $entry) {
  $json = Read-Json $path
  if (-not $json.PSObject.Properties["profiles"]) { $json | Add-Member -NotePropertyName profiles -NotePropertyValue (New-Object PSObject) }
  if ($json.profiles.PSObject.Properties[$id]) {
    $was = $json.profiles.PSObject.Properties[$id].Value
    if ($was.PSObject.Properties["created"]) { $entry.created = $was.created }
    $json.profiles.PSObject.Properties.Remove($id)
  }
  $json.profiles | Add-Member -NotePropertyName $id -NotePropertyValue ([pscustomobject]$entry)
  if ($json.PSObject.Properties["selectedProfile"]) { $json.selectedProfile = $id } else { $json | Add-Member -NotePropertyName selectedProfile -NotePropertyValue $id }
  Copy-Item -LiteralPath $path -Destination "$path.bak" -Force
  Write-Json $path $json
}

# "" when the profile is there and points at the right version; otherwise what is wrong, in words.
function Test-LauncherProfile($path, $id, $versionId) {
  if (-not (Test-Path -LiteralPath $path)) { return "launcher_profiles.json is gone" }
  $json = $null
  try { $json = Read-Json $path } catch { return ("launcher_profiles.json can't be read ({0})" -f $_.Exception.Message) }
  if (-not $json -or -not $json.PSObject.Properties["profiles"] -or -not $json.profiles.PSObject.Properties[$id]) { return ("the profile '{0}' is not in launcher_profiles.json" -f $id) }
  $got = [string]$json.profiles.PSObject.Properties[$id].Value.lastVersionId
  if ($got -ne $versionId) { return ("the profile '{0}' points at '{1}', not at '{2}'" -f $id, $got, $versionId) }
  return ""
}

function Get-LauncherFacts {
  $f = [ordered]@{ kind = "unknown"; version = $null; profilesFormat = $null }
  try {
    $j = Read-Json $Profiles
    if ($j.PSObject.Properties["version"]) { $f.profilesFormat = [int]$j.version }
    if ($j.PSObject.Properties["launcherVersion"] -and $j.launcherVersion.PSObject.Properties["name"]) { $f.version = [string]$j.launcherVersion.name }
  } catch {}
  foreach ($exe in @("${env:ProgramFiles(x86)}\Minecraft Launcher\MinecraftLauncher.exe", "$env:ProgramFiles\Minecraft Launcher\MinecraftLauncher.exe", "$env:LOCALAPPDATA\Programs\Minecraft Launcher\MinecraftLauncher.exe")) {
    try { if (Test-Path -LiteralPath $exe) { $f.kind = "classic"; if (-not $f.version) { $f.version = [string](Get-Item -LiteralPath $exe).VersionInfo.ProductVersion }; return $f } } catch {}
  }
  try { $pkg = Get-AppxPackage -Name "Microsoft.4297127D64EC6" -ErrorAction Stop; if ($pkg) { $f.kind = "store"; if (-not $f.version) { $f.version = [string]$pkg.Version } } } catch {}
  return $f
}

# ---- versions ------------------------------------------------------------------------------------------
function Test-Newer([string]$theirs, [string]$ours) {
  if ($theirs -notmatch '^\d{1,4}(\.\d{1,4}){1,3}$' -or $ours -notmatch '^\d{1,4}(\.\d{1,4}){1,3}$') { return $false }
  try { return ([version]$theirs -gt [version]$ours) } catch { return $false }
}

function Get-ScriptVersion([string]$path) {
  try {
    $m = [regex]::Match([IO.File]::ReadAllText($path), '(?m)^\$InstallerVersion = "([0-9.]+)"')
    if ($m.Success) { return $m.Groups[1].Value }
  } catch {}
  return ""
}

# ---- the script updates itself (docs/07 "Updates") ----------------------------------------------------
# The mod list names the version of this script the site hands out and the SHA-256 of that script. An older
# copy fetches it from this site's /downloads (never from an address in the mod list), checks the checksum, the
# version written inside it and that it reads as PowerShell, keeps itself as .bak and moves the new one over
# itself, then starts it with the same arguments. On any problem nothing is replaced and the run carries on.

# What the site says about the script: @{ version; sha256 } or $null.
function Get-OfferedScript($manifest) {
  try {
    if (-not $manifest -or -not $manifest.PSObject.Properties["installer"] -or -not $manifest.installer) { return $null }
    $i = $manifest.installer
    if (-not $i.PSObject.Properties["script"] -or -not $i.script) { return $null }
    return @{ version = [string]$i.version; sha256 = [string]$i.script.sha256 }
  } catch { return $null }
}

# @{ status = "current" | "updated" | "failed"; version; problem }. $fetch: { param($url, $outFile) } downloads a file.
function Update-Script($offer, [string]$scriptPath, [scriptblock]$fetch) {
  if (-not $offer -or -not (Test-Newer $offer.version $InstallerVersion)) { return @{ status = "current"; version = $InstallerVersion; problem = $null } }
  $new = [string]$offer.version
  $fail = { param($why) return @{ status = "failed"; version = $new; problem = $why } }
  if ($offer.sha256 -notmatch '^[0-9a-fA-F]{64}$') { return (& $fail "the site gave no checksum for it") }
  $tmp = "$scriptPath.new"
  Remove-Temp $tmp
  try { & $fetch "$PortalUrl/downloads/$ScriptName" $tmp } catch { Remove-Temp $tmp; return (& $fail ("it could not be downloaded: {0}" -f $_.Exception.Message)) }
  try {
    if (-not [IO.File]::Exists($tmp)) { return (& $fail "the download is empty") }
    $got = (Get-FileHash -LiteralPath $tmp -Algorithm SHA256).Hash.ToLower()
    if ($got -ne $offer.sha256.ToLower()) { Remove-Temp $tmp; return (& $fail ("the checksum of the download ({0}...) is not the one the site gave ({1}...)" -f $got.Substring(0, 12), $offer.sha256.Substring(0, 12).ToLower())) }
    $text = [IO.File]::ReadAllText($tmp)
    if ($text -notmatch ('(?m)^\$InstallerVersion = "' + [regex]::Escape($new) + '"')) { Remove-Temp $tmp; return (& $fail ("the script in the download is not version {0}" -f $new)) }
    $errs = $null; $tokens = $null
    [void][System.Management.Automation.Language.Parser]::ParseInput($text, [ref]$tokens, [ref]$errs)
    if ($errs -and @($errs).Count -gt 0) { Remove-Temp $tmp; return (& $fail "the script in the download does not read as PowerShell") }
    if ([IO.File]::Exists($scriptPath)) { Copy-Item -LiteralPath $scriptPath -Destination ($scriptPath + ".bak") -Force }
    Move-Item -Force -LiteralPath $tmp -Destination $scriptPath
  } catch { Remove-Temp $tmp; return (& $fail ("it could not be written: {0}" -f $_.Exception.Message)) }
  return @{ status = "updated"; version = $new; problem = $null }
}

# ---- downloads land in a folder of their own first (docs/07 "Downloads") -------------------------------
# A mod is downloaded into .downloading\ next to mods\, checked, and only then moved into mods\ in one step. A run
# that is killed half-way leaves a part file in .downloading\ (emptied at the start of the next run), never a
# half-written jar in mods\.
function Save-ModFile([string]$url, [string]$dest, [string]$sha512, [string]$staging, [scriptblock]$fetch) {
  [void][IO.Directory]::CreateDirectory($staging)
  $part = Join-Path $staging ([IO.Path]::GetFileName($dest) + ".part")
  Remove-Temp $part
  & $fetch $url $part
  $sha = [System.Security.Cryptography.SHA512]::Create()
  $hash = [BitConverter]::ToString($sha.ComputeHash([IO.File]::ReadAllBytes($part))).Replace("-", "").ToLower()
  if ($hash -ne $sha512) { Remove-Temp $part; return "wrong" }
  try { Move-Item -Force -LiteralPath $part -Destination $dest } catch { Log ("could not put " + $dest + " in place: " + $_.Exception.Message); Remove-Temp $part; return "in use" }
  return ""
}

# Leftovers of a run that was stopped: part files in .downloading\ and, from installers before 1.5.0, in mods\.
function Clear-Leftovers([string]$gameDir) {
  $staging = Join-Path $gameDir ".downloading"
  if (Test-Path -LiteralPath $staging) { Get-ChildItem -LiteralPath $staging -File -Force | ForEach-Object { Remove-Temp $_.FullName } }
  $mods = Join-Path $gameDir "mods"
  if (Test-Path -LiteralPath $mods) { Get-ChildItem -LiteralPath $mods -File -Force | Where-Object { $_.Name -like "*.part" } | ForEach-Object { Log ("removing a part file left by an earlier run: " + $_.Name); Remove-Temp $_.FullName } }
}

# ---- where it lives, the Play link and the shortcuts (docs/07 "Setup") --------------------------------
# One copy in %LOCALAPPDATA%\DeepslateWorks. Windows is told, for this user only (HKCU, no admin rights), to run it
# for deepslate:// links, and a "Deepslate Works" shortcut on the desktop and in the Start Menu runs it too.

function Get-HomeDir { if ($env:LOCALAPPDATA) { return (Join-Path $env:LOCALAPPDATA "DeepslateWorks") } return $null }
function Get-PowerShellExe { return (([string]$env:SystemRoot).TrimEnd("\") + "\System32\WindowsPowerShell\v1.0\powershell.exe") }   # the full path: never whatever "powershell" is found first

function Get-HandlerCommand([string]$scriptPath) {
  return ('"{0}" -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "{1}" "%1"' -f (Get-PowerShellExe), $scriptPath)
}

function Get-ShortcutSpec([string]$scriptPath) {
  return [ordered]@{
    target = Get-PowerShellExe
    arguments = ('-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}"' -f $scriptPath)
    workingDirectory = (Split-Path -Parent $scriptPath)
    description = "Opens Deepslate Works: updates the game and starts the Minecraft Launcher on it"
  }
}

function Register-PlayLink([string]$scriptPath) {
  $base = "HKCU:\Software\Classes\deepslate"
  New-Item -Path "$base\shell\open\command" -Force | Out-Null
  Set-Item -Path $base -Value ("URL:{0}" -f $PackName)
  New-ItemProperty -Path $base -Name "URL Protocol" -Value "" -PropertyType String -Force | Out-Null
  Set-Item -Path "$base\shell\open\command" -Value (Get-HandlerCommand $scriptPath)
  return ([string](Get-Item "HKCU:\Software\Classes\deepslate\shell\open\command").GetValue("") -eq (Get-HandlerCommand $scriptPath))
}

# @{ made = <how many>; failed = @(@{ where = "desktop" | "menu" | "uninstall"; message }) } (1.5.6: which one failed)
function Set-Shortcuts([string]$scriptPath) {
  $spec = Get-ShortcutSpec $scriptPath
  $shell = New-Object -ComObject WScript.Shell
  $made = 0
  $failed = New-Object System.Collections.Generic.List[object]
  foreach ($f in @(@{ where = "desktop"; folder = [Environment]::GetFolderPath("Desktop") }, @{ where = "menu"; folder = [Environment]::GetFolderPath("Programs") })) {
    $folder = $f.folder
    if (-not $folder) { continue }
    try {
      $s = $shell.CreateShortcut((Join-Path $folder ("{0}.lnk" -f $PackName)))
      $s.TargetPath = $spec.target; $s.Arguments = $spec.arguments; $s.WorkingDirectory = $spec.workingDirectory; $s.Description = $spec.description
      $s.IconLocation = ("{0},0" -f $spec.target)
      $s.Save(); $made++
    } catch { $failed.Add(@{ where = $f.where; message = $_.Exception.Message }); Log ("could not make the shortcut in " + $folder + ": " + $_.Exception.Message) }
  }
  # "Uninstall Deepslate Works" next to it in the Start Menu (1.5.2)
  $programs = [Environment]::GetFolderPath("Programs")
  if ($programs) {
    try {
      $u = Get-UninstallShortcutSpec $scriptPath
      $s = $shell.CreateShortcut((Join-Path $programs ("Uninstall {0}.lnk" -f $PackName)))
      $s.TargetPath = $u.target; $s.Arguments = $u.arguments; $s.WorkingDirectory = $u.workingDirectory; $s.Description = $u.description
      $s.IconLocation = ("{0},0" -f $u.target)
      $s.Save(); $made++
    } catch { $failed.Add(@{ where = "uninstall"; message = $_.Exception.Message }); Log ("could not make the uninstall shortcut: " + $_.Exception.Message) }
  }
  return @{ made = $made; failed = @($failed.ToArray()) }
}

# ---- uninstall (docs/07 "Uninstall", planner 2026-09-30) ----------------------------------------------------
# Removes what Deepslate Works put on the PC and nothing else. Every path is a parameter, so the self test runs the
# whole thing against scratch folders; on Windows the registry keys are "HKCU:\..." paths, which Test-Path and
# Remove-Item treat the same way.
$UninstallKeyName = "DeepslateWorks"
$ProfileId = "deepslate-works"   # the mod list's profile.id; it has always been this

function Get-UninstallShortcutSpec([string]$scriptPath) {
  $s = Get-ShortcutSpec $scriptPath
  $s.arguments = $s.arguments + " -Uninstall"
  $s.description = "Removes Deepslate Works from this PC"
  return $s
}

# What Settings -> Apps shows, and what its Uninstall button runs.
function Get-UninstallEntry([string]$scriptPath, [string]$gameDir, [int]$sizeKb) {
  return [ordered]@{
    DisplayName     = $PackName
    DisplayVersion  = $InstallerVersion
    Publisher       = "Deepslate Works"
    DisplayIcon     = ("{0},0" -f (Get-PowerShellExe))
    UninstallString = ('"{0}" -NoProfile -ExecutionPolicy Bypass -File "{1}" -Uninstall' -f (Get-PowerShellExe), $scriptPath)
    InstallLocation = $gameDir
    EstimatedSize   = $sizeKb
    NoModify        = 1
    NoRepair        = 1
  }
}

function Get-FolderSizeKb([string]$path) {
  if (-not $path -or -not (Test-Path -LiteralPath $path)) { return 0 }
  $sum = [long]0
  try { Get-ChildItem -LiteralPath $path -Recurse -Force -File -ErrorAction SilentlyContinue | ForEach-Object { $sum += $_.Length } } catch {}
  return [int][Math]::Min([long][int]::MaxValue, [Math]::Ceiling($sum / 1024))
}

function Register-Uninstall([string]$scriptPath, [string]$gameDir) {
  $key = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$UninstallKeyName"
  $e = Get-UninstallEntry $scriptPath $gameDir (Get-FolderSizeKb $gameDir)
  New-Item -Path $key -Force | Out-Null
  foreach ($k in $e.Keys) {
    $type = if ($e[$k] -is [int]) { "DWord" } else { "String" }
    New-ItemProperty -Path $key -Name $k -Value $e[$k] -PropertyType $type -Force | Out-Null
  }
}

# Where everything is. $hkcu is "HKCU:" on a PC, a scratch folder in the self test.
function Get-UninstallTargets([string]$root, [string]$homeDir, [string]$desktop, [string]$programs, [string]$pictures, [string]$hkcu) {
  $links = @()
  if ($desktop) { $links += (Join-Path $desktop ("{0}.lnk" -f $PackName)) }
  if ($programs) { $links += (Join-Path $programs ("{0}.lnk" -f $PackName)); $links += (Join-Path $programs ("Uninstall {0}.lnk" -f $PackName)) }
  return [ordered]@{
    gameDir      = (Join-Path $root ".minecraft-deepslate-works")
    profiles     = (Join-Path (Join-Path $root ".minecraft") "launcher_profiles.json")
    homeDir      = $homeDir
    shortcuts    = $links
    handlerKey   = ($hkcu + "\Software\Classes\deepslate")
    uninstallKey = ($hkcu + "\Software\Microsoft\Windows\CurrentVersion\Uninstall\" + $UninstallKeyName)
    pictures     = $(if ($pictures) { Join-Path $pictures ("{0} screenshots" -f $PackName) } else { $null })
  }
}

function Test-OurProfile([string]$path) {
  if (-not (Test-Path -LiteralPath $path)) { return $false }
  try { $j = Read-Json $path; return [bool]($j.PSObject.Properties["profiles"] -and $j.profiles.PSObject.Properties[$ProfileId]) } catch { return $false }
}

# Is anything of ours on this PC?
function Test-UninstallFootprint($t) {
  if (Test-OurProfile $t.profiles) { return $true }
  foreach ($p in @($t.gameDir, $t.homeDir, $t.handlerKey, $t.uninstallKey) + @($t.shortcuts)) { if ($p -and (Test-Path -LiteralPath $p)) { return $true } }
  return $false
}

# Takes our profile out of launcher_profiles.json and nothing else. Backed up first; read back; the other profiles
# must come back exactly as they were, or the backup is put back and the error goes up.
function Remove-LauncherProfile([string]$path, [string]$id) {
  if (-not (Test-Path -LiteralPath $path)) { return "none" }
  $json = Read-Json $path
  if (-not $json.PSObject.Properties["profiles"] -or -not $json.profiles.PSObject.Properties[$id]) { return "none" }
  $others = @($json.profiles.PSObject.Properties | Where-Object { $_.Name -ne $id } | ForEach-Object { $_.Name + "=" + ($_.Value | ConvertTo-Json -Depth 20 -Compress) })
  $backup = "$path.deepslate-backup"
  Copy-Item -LiteralPath $path -Destination $backup -Force
  try {
    $json.profiles.PSObject.Properties.Remove($id)
    if ($json.PSObject.Properties["selectedProfile"] -and [string]$json.selectedProfile -eq $id) { $json.PSObject.Properties.Remove("selectedProfile") }
    Write-Json $path $json
    $after = Read-Json $path
    $now = @($after.profiles.PSObject.Properties | ForEach-Object { $_.Name + "=" + ($_.Value | ConvertTo-Json -Depth 20 -Compress) })
    if ($after.profiles.PSObject.Properties[$id] -or (($now -join "`n") -ne ($others -join "`n"))) { throw "the other profiles did not read back the same" }
  } catch {
    Copy-Item -LiteralPath $backup -Destination $path -Force
    Remove-Temp $backup
    throw
  }
  Remove-Temp $backup
  return "removed"
}

# Screenshots taken in the game go to Pictures\Deepslate Works screenshots before the game folder goes.
function Move-Screenshots([string]$from, [string]$to) {
  if (-not $to -or -not (Test-Path -LiteralPath $from)) { return 0 }
  $files = @(Get-ChildItem -LiteralPath $from -File -Force)
  if ($files.Count -eq 0) { return 0 }
  [void][IO.Directory]::CreateDirectory($to)
  foreach ($f in $files) {
    $dest = Join-Path $to $f.Name
    $n = 1
    while (Test-Path -LiteralPath $dest) { $dest = Join-Path $to ("{0} ({1}){2}" -f $f.BaseName, $n, $f.Extension); $n++ }
    Move-Item -LiteralPath $f.FullName -Destination $dest
  }
  return $files.Count
}

# The launcher open means no (it would write our profile back). Null when it may go ahead.
function Get-UninstallRefusal {
  if (Find-Launcher) { return "Close the Minecraft Launcher (including the tray icon) and run this again. While it is open it would put the Deepslate Works profile back." }
  return $null
}

# Does it. $portal: @{ report = { param($token) }; revoke = { param($token) } }; either may throw (no internet).
function Invoke-Uninstall($t, [string]$token, $portal) {
  $removed = New-Object System.Collections.Generic.List[string]
  $kept = New-Object System.Collections.Generic.List[string]
  $problems = New-Object System.Collections.Generic.List[string]
  try {
    if ((Remove-LauncherProfile $t.profiles $ProfileId) -eq "removed") { $removed.Add("the Deepslate Works profile in the Minecraft Launcher (your other profiles are as they were)") }
  } catch { $problems.Add("the launcher profile could not be taken out, so the file was left as it was (" + $_.Exception.Message + ")") }
  try {
    $moved = Move-Screenshots (Join-Path $t.gameDir "screenshots") $t.pictures
    if ($moved -gt 0) { $kept.Add(("{0} screenshot(s), moved to {1}" -f $moved, $t.pictures)) }
  } catch { $problems.Add("the screenshots could not be moved, so the game folder was kept (" + $_.Exception.Message + ")"); return @{ removed = $removed; kept = $kept; problems = $problems } }
  if ($token) {
    try { $null = & $portal.report $token } catch { Log ("uninstall report not sent: " + $_.Exception.Message) }
    $out = $false
    try { $null = & $portal.revoke $token; $out = $true } catch { Log ("sign-in not revoked on the site: " + $_.Exception.Message) }
    if ($out) { $removed.Add("this PC's sign-in, also signed out on the site") } else { $removed.Add("this PC's sign-in (the site could not be reached; it expires by itself within 7 days)") }
  }
  $folders = @(
    @($t.gameDir, "the game folder (mods, the extras downloaded for the Extras tab, settings, the Java it downloaded, logs, the server list)"),
    @($t.homeDir, "Deepslate Works itself, in your AppData, with your answers to its questions and your extras choices")
  )
  foreach ($f in $folders) {
    if (-not $f[0] -or -not (Test-Path -LiteralPath $f[0])) { continue }
    try { Remove-Item -LiteralPath $f[0] -Recurse -Force -ErrorAction Stop; $removed.Add($f[1]) }
    catch { $problems.Add(("{0} could not be removed completely: is Minecraft still running? ({1})" -f $f[1], $_.Exception.Message)) }
  }
  if (Test-Path -LiteralPath $t.handlerKey) {
    try { Remove-Item -LiteralPath $t.handlerKey -Recurse -Force -ErrorAction Stop; $removed.Add("the Play button's link to this PC (deepslate://)") } catch { $problems.Add("the deepslate:// link: " + $_.Exception.Message) }
  }
  $links = 0
  foreach ($l in @($t.shortcuts)) { if ($l -and (Test-Path -LiteralPath $l)) { try { Remove-Item -LiteralPath $l -Force -ErrorAction Stop; $links++ } catch { $problems.Add("a shortcut: " + $_.Exception.Message) } } }
  if ($links -gt 0) { $removed.Add(("the shortcuts on the desktop and in the Start Menu ({0})" -f $links)) }
  # last: the entry in Settings -> Apps
  if (Test-Path -LiteralPath $t.uninstallKey) {
    try { Remove-Item -LiteralPath $t.uninstallKey -Recurse -Force -ErrorAction Stop; $removed.Add("its entry in Settings -> Apps") } catch { $problems.Add("the Settings -> Apps entry: " + $_.Exception.Message) }
  }
  $kept.Add("Java (the Minecraft Launcher's own, or one you installed yourself)")
  $kept.Add("the Minecraft Launcher, your other profiles and worlds, and NeoForge's shared files in .minecraft")
  $kept.Add("your account on the site and your link to Minecraft: your things on the server are safe")
  return @{ removed = $removed; kept = $kept; problems = $problems }
}

# The files a copy of 1.3.x / 1.4.x left in the same folder. There is one script now.
$OldFiles = @("install.ps1", "install.ps1.bak", "install.ps1.new", "Setup.bat", "Setup.bat.new", "play.ps1", "Update and Play.bat")

# Puts this script in place (never an older one over a newer one). Returns the path of the copy to run.
function Install-Home([string]$me, [string]$dir, $copier = $null) {
  [void][IO.Directory]::CreateDirectory($dir)
  $target = Join-Path $dir $ScriptName
  if ($me -ne $target) {
    $same = (Test-Path -LiteralPath $target) -and ((Get-FileHash -LiteralPath $me -Algorithm SHA256).Hash -eq (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash)
    if (-not $same -and (Test-Path -LiteralPath $target) -and (Test-Newer (Get-ScriptVersion $target) $InstallerVersion)) { $same = $true; Log ("the copy in " + $dir + " is newer than this one; left as it is") }
    if (-not $same) {
      if ($copier) { & $copier $me $target } else { Copy-Item -LiteralPath $me -Destination $target -Force }
      Log ("put " + $ScriptName + " in " + $dir)
    }
  }
  return $target
}

# What 1.3.x/1.4.x left in the home folder. Removed only once the Play link points at DeepslateWorks.ps1: until then
# the link may still name install.ps1, and removing it would leave the Play button starting nothing.
function Remove-OldLayout([string]$dir) {
  foreach ($old in $OldFiles) { $p = Join-Path $dir $old; if (Test-Path -LiteralPath $p) { Remove-Temp $p; Log ("removed the old " + $old) } }
}

# ---- setting up each part on its own (1.5.6, planner) ----------------------------------------------------------
# Setup on Rowan's PC (2026-09-30) said "Could not set up the Play button and the shortcuts (Access to the path
# '...\DeepslateWorks\DeepslateWorks.ps1' is denied.)": the home copy failed, and because the copy, the link, the
# shortcuts and the Apps entry were in one try, nothing after it was done either. Each part now has its own try, its
# own line, and a reason code in the report: in_zip, copy_denied, link_failed, shortcut_blocked, other.

function Add-SetupProblem($list, [string]$part, [string]$code, [string]$message) {
  $list.Add([ordered]@{ part = $part; code = $code; message = ([string]$message).Substring(0, [Math]::Min(500, ([string]$message).Length)) })
  Log ("setup: {0} {1}: {2}" -f $part, $code, $message)
}

# Under %TEMP%: never the place the Play link or the shortcuts point at, it is emptied.
function Test-UnderTemp([string]$path, [string]$temp) {
  if (-not $path -or -not $temp) { return $false }
  $t = $temp.TrimEnd("\", "/") + [IO.Path]::DirectorySeparatorChar
  return $path.StartsWith($t, [StringComparison]::OrdinalIgnoreCase)
}

# Started from inside the zip: Explorer runs it from %TEMP%\Temp1_installer.zip\ and throws that folder away later.
function Test-InsideZip([string]$path, [string]$temp) {
  if (-not (Test-UnderTemp $path $temp)) { return $false }
  $rel = (Split-Path -Parent $path).Substring($temp.TrimEnd("\", "/").Length)
  return @($rel -split '[\\/]' | Where-Object { $_ -match '\.zip$' }).Count -gt 0
}

# Access denied, or the file in use: what antivirus scanning a new .ps1 looks like.
function Test-Denied($ex) {
  for ($e = $ex; $e; $e = $e.InnerException) {
    if ($e -is [UnauthorizedAccessException]) { return $true }
    if ($e -is [IO.IOException] -and (($e.HResult -band 0xFFFF) -in @(32, 33))) { return $true }
    if ([string]$e.Message -match 'is denied|being used by another process') { return $true }
  }
  return $false
}

# The home copy, tried again once after 2 s when it was refused. @{ ok; script } or @{ ok = $false; code; message }.
function Copy-Home([string]$me, [string]$dir, $copier = $null, $sleep = $null) {
  for ($try = 1; $try -le 2; $try++) {
    try { return @{ ok = $true; script = (Install-Home $me $dir $copier) } }
    catch {
      $why = $_.Exception.Message
      if ((Test-Denied $_.Exception) -and $try -eq 1) {
        Log ("copying the installer to " + $dir + " was refused (" + $why + "); trying again in 2 s")
        if ($sleep) { & $sleep 2 } else { Start-Sleep -Seconds 2 }
        continue
      }
      if (Test-Denied $_.Exception) {
        $attrs = ""; try { $attrs = [string](Get-Item -LiteralPath (Join-Path $dir $ScriptName) -Force -ErrorAction Stop).Attributes } catch {}
        Log ("refused again: " + $why + $(if ($attrs) { " (the file there: " + $attrs + ")" } else { "" }))
        return @{ ok = $false; code = "copy_denied"; message = ("Your antivirus or Windows stopped the installer copying itself to {0}. The game is installed and works from the Deepslate Works launcher profile; the Play button on the site won't work on this PC until this is fixed." -f $dir) }
      }
      return @{ ok = $false; code = "other"; message = ("Could not copy the installer to {0}: {1}" -f $dir, $why) }
    }
  }
}

# The home folder, the Play link, the shortcuts and the Settings -> Apps entry, each on its own: after Setup.bat
# (-Force: the shortcuts are made again), at the end of every run, and at once on a run under a 1.4.x name. $io says
# how each is read and written (the registry and the shortcuts on Windows, files in a scratch folder in the self test);
# its blocks run inside this function, so they read $io. Returns the script to run, whether the Play link points at
# it, what could not be done (`problems`, reason codes), the lines to show (`said`), and `fixed` when the link was not
# right before and is now.
function Repair-Home([string]$me, [string]$dir, $io, [switch]$Force, [switch]$NoLinks) {
  $problems = New-Object System.Collections.Generic.List[object]
  $said = New-Object System.Collections.Generic.List[object]

  # 1. the copy in the home folder
  $copy = Copy-Home $me $dir $io.copier $io.sleep
  $target = $me
  if ($copy.ok) { $target = $copy.script; $said.Add(@{ tone = "ok"; text = ("Installed in {0}" -f $dir) }) }
  else { Add-SetupProblem $problems "copy" $copy.code $copy.message; $said.Add(@{ tone = "problem"; text = $copy.message }) }

  # 2. the Play link: to the home copy, or to the script where it ran, never to a temporary folder
  $linked = $false; $wasLinked = $false
  if ($NoLinks) { $said.Add(@{ tone = "note"; text = "No Play button link or shortcuts: you said Not now (Review permissions changes that)" }) }
  elseif (-not $copy.ok -and (Test-UnderTemp $me $io.temp)) {
    $why = "Could not set up the Play button: the installer ran from a temporary folder and could not copy itself anywhere lasting"
    Add-SetupProblem $problems "link" "link_failed" $why; $said.Add(@{ tone = "problem"; text = $why })
  } else {
    $want = Get-HandlerCommand $target
    try {
      $wasLinked = ((& $io.handler) -eq $want)
      if (-not $wasLinked) { if (& $io.setHandler $target) { Log "the Play link was set up again" } }
      $linked = ((& $io.handler) -eq $want)
      if ($linked) { $said.Add(@{ tone = "ok"; text = "The Play button on the site now starts Deepslate Works on this PC" }) }
      else { $why = "Could not set up the Play button: Windows did not keep it"; Add-SetupProblem $problems "link" "link_failed" $why; $said.Add(@{ tone = "problem"; text = $why }) }
    } catch { $why = "Could not set up the Play button: " + $_.Exception.Message; Add-SetupProblem $problems "link" "link_failed" $why; $said.Add(@{ tone = "problem"; text = $why }) }
  }

  # 3. the shortcuts: not to a temporary folder either
  if ($NoLinks -or (-not $copy.ok -and (Test-UnderTemp $me $io.temp))) { }
  else {
    try {
      if ($Force -or -not (& $io.shortcutsThere)) {
        $sc = & $io.makeShortcuts $target
        $failed = @($sc.failed)
        if ($failed.Count -eq 0) { $said.Add(@{ tone = "ok"; text = "Shortcuts made" }); if (-not $Force) { Log "the shortcuts were made again" } }
        elseif (@($failed | Where-Object { $_.where -ne "desktop" }).Count -eq 0 -and (& $io.cfa)) {
          $why = "Windows' ransomware protection blocked the desktop shortcut. The Start Menu entry and the Play button still work."
          Add-SetupProblem $problems "shortcuts" "shortcut_blocked" $why; $said.Add(@{ tone = "note"; text = $why })
        } else {
          $why = "Could not make the shortcuts: " + [string]$failed[0].message
          Add-SetupProblem $problems "shortcuts" "other" $why; $said.Add(@{ tone = "problem"; text = $why })
        }
      }
    } catch { $why = "Could not make the shortcuts: " + $_.Exception.Message; Add-SetupProblem $problems "shortcuts" "other" $why; $said.Add(@{ tone = "problem"; text = $why }) }
  }

  # 4. Settings -> Apps
  try { if (-not (& $io.listed $target)) { & $io.list $target; Log "listed in Settings -> Apps" } }
  catch { Add-SetupProblem $problems "apps" "other" ("Could not list it in Settings -> Apps: " + $_.Exception.Message) }

  # the old layout goes once the link points at the new script in its home
  if ($linked -and $copy.ok) { Remove-OldLayout $dir } else { Log "the old files are kept: the Play link does not point at the installed copy" }
  $fixed = $linked -and -not $wasLinked
  if ($fixed -and -not $Force) { Log "Play button set up on this run" }
  return @{ script = $target; linked = $linked; problems = @($problems.ToArray()); said = @($said.ToArray()); fixed = $fixed }
}

# The setup problems a run reports: the ones found now (Repair-Home), replacing what Setup found.
function Set-SetupState($r) {
  $script:SetupChecked = $true
  $script:SetupProblems.Clear()
  foreach ($p in @($r.problems)) { $script:SetupProblems.Add($p) }
}

# The real ones: this Windows user's registry and shortcuts.
function Get-WindowsHomeIo([string]$gameDir) {
  return @{
    gameDir = $gameDir
    handler = { try { return [string](Get-Item "HKCU:\Software\Classes\deepslate\shell\open\command" -ErrorAction Stop).GetValue("") } catch { return "" } }
    setHandler = { param($t) Register-PlayLink $t }
    shortcutsThere = {
      $programs = [Environment]::GetFolderPath("Programs")
      return ((Test-Path -LiteralPath (Join-Path ([Environment]::GetFolderPath("Desktop")) ("{0}.lnk" -f $PackName))) -and (Test-Path -LiteralPath (Join-Path $programs ("{0}.lnk" -f $PackName))) -and (Test-Path -LiteralPath (Join-Path $programs ("Uninstall {0}.lnk" -f $PackName))))
    }
    makeShortcuts = { param($t) Set-Shortcuts $t }
    cfa = { try { return ([int](Get-MpPreference -ErrorAction Stop).EnableControlledFolderAccess -eq 1) } catch { return $false } }
    temp = $Temp
    listed = {
      param($t)
      $l = $null
      try { $l = Get-ItemProperty -LiteralPath ("HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\" + $UninstallKeyName) -ErrorAction Stop } catch {}
      return [bool]($l -and [string]$l.UninstallString -eq (Get-UninstallEntry $t $io.gameDir 0).UninstallString -and [string]$l.DisplayVersion -eq $InstallerVersion)
    }
    list = { param($t) Register-Uninstall $t $io.gameDir }
  }
}

# The self test's: the same four things as files in one folder.
function Get-FileHomeIo([string]$at) {
  return @{
    at = $at
    handler = { $f = Join-Path $io.at "handler.txt"; if ([IO.File]::Exists($f)) { return [IO.File]::ReadAllText($f) }; return "" }
    setHandler = { param($t) [IO.File]::WriteAllText((Join-Path $io.at "handler.txt"), (Get-HandlerCommand $t)); return $true }
    shortcutsThere = { return (@(@("Desktop.lnk", "Programs.lnk", "Uninstall.lnk") | Where-Object { -not [IO.File]::Exists((Join-Path $io.at $_)) }).Count -eq 0) }
    makeShortcuts = { param($t) foreach ($n in @("Desktop.lnk", "Programs.lnk", "Uninstall.lnk")) { [IO.File]::WriteAllText((Join-Path $io.at $n), $t) }; return @{ made = 3; failed = @() } }
    cfa = { return $false }
    temp = (Join-Path $at "temp")
    listed = { param($t) $f = Join-Path $io.at "apps.txt"; return ([IO.File]::Exists($f) -and [IO.File]::ReadAllText($f) -eq ($t + "|" + $InstallerVersion)) }
    list = { param($t) [IO.File]::WriteAllText((Join-Path $io.at "apps.txt"), ($t + "|" + $InstallerVersion)) }
  }
}

# ---- render distance (docs/07 "Render distance", 1.5.4) ----------------------------------------------------
# options.txt is the game's own file. The first install writes it with the distances for the member's PC tier. Later
# runs change renderDistance and simulationDistance only while renderDistance is still the value this script wrote
# last time ($ours, kept in installed.json; installs from before 1.5.4 wrote 8), so a value the player chose is never
# touched. Only those two lines change; every other line and the line endings are kept as they are.
# Returns @{ status = "written" | "changed" | "left" | "same"; ours = <the value to remember>; text = <what to say> }.
function Set-RenderDistance([string]$path, $ours, [int]$render, [int]$sim) {
  if (-not [IO.File]::Exists($path)) {
    [IO.File]::WriteAllText($path, ("renderDistance:{0}`r`nsimulationDistance:{1}`r`nfullscreen:false`r`nchatLinks:true`r`nchatLinksPrompt:true`r`n" -f $render, $sim), (New-Object Text.UTF8Encoding($false)))
    return @{ status = "written"; ours = $render; text = ("Render distance set to {0}" -f $render) }
  }
  if ($null -eq $ours -or "$ours" -notmatch '^\d{1,2}$') { $ours = 8 }
  $ours = [int]$ours
  $text = [IO.File]::ReadAllText($path)
  $m = [regex]::Match($text, '(?m)^renderDistance:(\d+)\r?$')
  if (-not $m.Success) { return @{ status = "left"; ours = $ours; text = "Render distance left as it is (not in options.txt)" } }
  $now = [int]$m.Groups[1].Value
  # already the tier's value: ours from now on (also after a run that changed it but failed before installed.json)
  if ($now -eq $render) { return @{ status = "same"; ours = $render; text = ("Render distance {0}" -f $render) } }
  if ($now -ne $ours) { return @{ status = "left"; ours = $ours; text = ("Render distance left at {0} (set by you)" -f $now) } }
  $new = [regex]::Replace($text, '(?m)^renderDistance:\d+(?=\r?$)', ("renderDistance:{0}" -f $render))
  if ([regex]::IsMatch($new, '(?m)^simulationDistance:\d+\r?$')) { $new = [regex]::Replace($new, '(?m)^simulationDistance:\d+(?=\r?$)', ("simulationDistance:{0}" -f $sim)) }
  else { $nl = if ($text -match "`r`n") { "`r`n" } else { "`n" }; if ($new.Length -gt 0 -and -not $new.EndsWith("`n")) { $new += $nl }; $new += ("simulationDistance:{0}{1}" -f $sim, $nl) }
  $tmp = $path + ".new"
  [IO.File]::WriteAllText($tmp, $new, (New-Object Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $tmp -Destination $path -Force
  return @{ status = "changed"; ours = $render; text = ("Render distance {0} {1} {2}" -f $now, [char]0x2192, $render) }
}

# ---- visual extras (1.6.0, planner 2026-10-01) -------------------------------------------------------------
# The member chooses on the Me page; the mod list says what that means for this PC (`visuals`). The optional mods come
# in `files` like any other; resource packs and shader packs come apart and live in resourcepacks\ and shaderpacks\.
# Only files the pack itself put there are ever taken out; a player's own packs are never touched.

# options.txt "resourcePacks": ours that are wanted are added at the end (on top), ours that are not are taken out.
# Everything else in the list, and its order, stays. $want and $ours are file names. Returns @{ status; text }.
function Set-ResourcePackList([string]$path, [string[]]$want, [string[]]$ours) {
  $want = @($want | Where-Object { $_ })
  $wantIds = @($want | ForEach-Object { "file/" + $_ })
  $oursIds = @(@($ours) + @($want) | Where-Object { $_ } | ForEach-Object { "file/" + $_ })
  $text = ""
  if ([IO.File]::Exists($path)) { $text = [IO.File]::ReadAllText($path) }
  $nl = "`r`n"
  if ($text -and -not $text.Contains("`r`n") -and $text.Contains("`n")) { $nl = "`n" }
  $m = [regex]::Match($text, '(?m)^resourcePacks:(.*?)(?=\r?$)')
  $list = @("vanilla")
  if ($m.Success) {
    try { $list = @((ConvertFrom-Json $m.Groups[1].Value) | ForEach-Object { [string]$_ }) }
    catch { return @{ status = "left"; text = "Resource packs left as they are (options.txt has a list this cannot read)" } }
  } elseif ($wantIds.Count -eq 0) { return @{ status = "same"; text = "No resource packs to switch on" } }
  $new = New-Object Collections.Generic.List[string]
  foreach ($x in $list) { if (($oursIds -notcontains $x) -or ($wantIds -contains $x)) { if (-not $new.Contains($x)) { $new.Add($x) } } }
  foreach ($x in $wantIds) { if (-not $new.Contains($x)) { $new.Add($x) } }
  if ($m.Success -and ((@($new) -join "`n") -eq ($list -join "`n"))) { return @{ status = "same"; text = "Resource packs already as chosen" } }
  $line = "resourcePacks:[" + ((@($new) | ForEach-Object { '"' + $_.Replace('\', '\\').Replace('"', '\"') + '"' }) -join ",") + "]"
  if ($m.Success) { $out = $text.Substring(0, $m.Index) + $line + $text.Substring($m.Index + $m.Length) }
  else { $out = $text; if ($out -and -not $out.EndsWith("`n")) { $out += $nl }; $out += $line + $nl }
  $tmp = $path + ".new"
  [IO.File]::WriteAllText($tmp, $out, (New-Object Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $tmp -Destination $path -Force
  if ($wantIds.Count) { return @{ status = "changed"; text = ("Resource pack switched on: " + ($want -join ", ")) } }
  return @{ status = "changed"; text = "Visual extras' resource pack switched off" }
}

# config\iris.properties: the shader pack chosen on the Me page, or shaders off ("" = None). Other settings stay.
function Set-IrisShader([string]$path, [string]$pack) {
  $text = ""
  if ([IO.File]::Exists($path)) { $text = [IO.File]::ReadAllText($path) }
  $nl = "`r`n"
  if ($text -and -not $text.Contains("`r`n") -and $text.Contains("`n")) { $nl = "`n" }
  $set = [ordered]@{ enableShaders = $(if ($pack) { "true" } else { "false" }) }
  if ($pack) { $set.shaderPack = $pack }
  foreach ($k in @($set.Keys)) {
    $v = $set[$k]
    $re = '(?m)^' + [regex]::Escape($k) + '\s*[=:].*?(?=\r?$)'
    if ([regex]::IsMatch($text, $re)) { $text = [regex]::Replace($text, $re, ($k + "=" + $v).Replace('$', '$$')) }
    else { if ($text -and -not $text.EndsWith("`n")) { $text += $nl }; $text += $k + "=" + $v + $nl }
  }
  [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($path))
  $tmp = $path + ".new"
  [IO.File]::WriteAllText($tmp, $text, (New-Object Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $tmp -Destination $path -Force
}

# Chat links (1.5.5, planner): with chatLinks off, the sign-in link in the white room's chat line cannot be clicked. It
# cannot mend a Microsoft account that has chat switched off (the book in the room is for that), but it rules out the
# other reason. Only a "chatLinks:false" line is changed, and only that line. $null when nothing was changed.
function Set-ChatLinks([string]$path) {
  if (-not [IO.File]::Exists($path)) { return $null }
  $text = [IO.File]::ReadAllText($path)
  if (-not [regex]::IsMatch($text, '(?m)^chatLinks:false\r?$')) { return $null }
  $new = [regex]::Replace($text, '(?m)^chatLinks:false(?=\r?$)', 'chatLinks:true')
  $tmp = $path + ".new"
  [IO.File]::WriteAllText($tmp, $new, (New-Object Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $tmp -Destination $path -Force
  return "Chat links switched on (they were off in the game's settings)"
}

# What kind of run this is, for the report: nothing installed yet, the pack changed, or everything was current.
function Get-RunMode($prev, [string]$packHash) {
  if (-not $prev) { return "first_install" }
  if ($packHash -and [string]$prev.hash -ne $packHash) { return "update" }
  return "play"
}

# Java says its version on stderr. It is asked through a process of its own and both streams are read as text:
# in Windows PowerShell 5.1 a native command's stderr sent through 2>&1 becomes an error, and with
# $ErrorActionPreference = "Stop" that error ended the script (1.4.0 and before, whatever the Java was).
# Returns the line with the version in it, or $null: no answer, no such file, or nothing that reads as a version.
function Get-JavaVersionText([string]$exe) {
  if (-not $exe) { return $null }
  try {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $exe
    $psi.Arguments = "-version"
    $psi.UseShellExecute = $false
    $psi.RedirectStandardError = $true
    $psi.RedirectStandardOutput = $true
    $psi.CreateNoWindow = $true
    $p = [System.Diagnostics.Process]::Start($psi)
    $err = $p.StandardError.ReadToEndAsync()
    $out = $p.StandardOutput.ReadToEndAsync()
    if (-not $p.WaitForExit(15000)) { try { $p.Kill() } catch {}; return $null }
    # "Picked up JAVA_TOOL_OPTIONS: ..." may come first: the line is found, not assumed to be the first
    foreach ($line in (([string]$err.Result + "`n" + [string]$out.Result) -split "`r?`n")) {
      if ($line -match 'version "[^"]+"') { return $line.Trim() }
    }
    return $null
  } catch { return $null }
}

# 21 from 'java version "21.0.12" 2026-07-21 LTS', 8 from 'java version "1.8.0_503"', 0 from anything else.
function Get-JavaMajor([string]$line) {
  if ($line -match 'version "(\d+)(?:\.(\d+))?') {
    $first = [int]$Matches[1]
    if ($first -eq 1 -and $Matches[2]) { return [int]$Matches[2] }
    return $first
  }
  return 0
}

# Which Java the profile is pointed at: the launcher's own, one on PATH that is 21 or newer, or the one
# downloaded on an earlier run. With none of them `path` is $null and Java 21 is downloaded. A Java on PATH
# that is older, or that does not answer, is passed over and left alone: it never stops the install, and the
# profile never points at it.
function Select-Java([string]$bundled, [string]$onPath, [string]$runtimeDir) {
  if ($bundled -and (Test-Path -LiteralPath $bundled)) { return [ordered]@{ path = $bundled; source = "the launcher's own"; say = "Using the launcher's own Java"; passedOver = $null } }
  $passedOver = $null
  if ($onPath) {
    $line = Get-JavaVersionText $onPath
    $major = Get-JavaMajor $line
    if ($major -ge 21) { return [ordered]@{ path = $onPath; source = "on PATH"; say = ("Using Java {0} from PATH" -f $major); passedOver = $null } }
    $passedOver = if ($line) { $line } else { "a java that did not say its version" }
  }
  $found = $null
  if ($runtimeDir -and (Test-Path -LiteralPath $runtimeDir)) { $found = Get-ChildItem -LiteralPath $runtimeDir -Filter java.exe -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1 }
  if ($found) { return [ordered]@{ path = $found.FullName; source = "downloaded on an earlier run"; say = "Using the Java we downloaded last time"; passedOver = $passedOver } }
  return [ordered]@{ path = $null; source = $null; say = $null; passedOver = $passedOver }
}

function Open-Launcher {
  Log "launching"
  foreach ($exe in @("${env:ProgramFiles(x86)}\Minecraft Launcher\MinecraftLauncher.exe", "$env:ProgramFiles\Minecraft Launcher\MinecraftLauncher.exe", "$env:LOCALAPPDATA\Programs\Minecraft Launcher\MinecraftLauncher.exe")) {
    if (Test-Path -LiteralPath $exe) { Start-Process $exe; return $true }
  }
  try { Start-Process "shell:AppsFolder\Microsoft.4297127D64EC6_8wekyb3d8bbwe!Minecraft"; return $true } catch {}   # Microsoft Store launcher
  try { Start-Process "minecraft://"; return $true } catch {}
  return $false
}

# ==== the app (2.0.0, planner 2026-10-01): permission per step, and personal extras =========================
# Nothing in this part draws anything: the window (Show-App, further down) and the install steps (the engine) both
# use it, and the self test checks it on Linux. Files, in %LOCALAPPDATA%\DeepslateWorks: consent.json (the answers),
# extras.json (the extras switched on, and which files are where), extras-manifest.json (the site's list of extras,
# kept so the Extras tab works offline). The extras' files live in <game folder>\extras\ until they are switched on.

$ConsentFileName = "consent.json"
$ExtrasStateName = "extras.json"
$ExtrasManifestName = "extras-manifest.json"
$ExitAsk = 20        # the engine needs an answer the window has to ask for (status line {t:"ask"})
$ExitDeclined = 21   # a step needed to play was answered "Not now"

function Get-ConsentSteps {
  $site = $PortalUrl
  try { $site = ([uri]$PortalUrl).Host } catch {}
  return @(
    [ordered]@{ id = "signin"; title = "Sign in with Discord"; text = ("Links this PC to your account on {0} so the server knows it's you." -f $site); required = $true; top = 1 },
    [ordered]@{ id = "launcher"; title = "Check the Minecraft Launcher is closed"; text = "The launcher overwrites settings if it's open."; required = $true; top = 1 },
    [ordered]@{ id = "java"; title = "Java 21"; text = "Minecraft 1.21 needs Java 21. Uses the launcher's own copy if you have it, otherwise downloads one into the Deepslate folder only."; required = $true; top = 2
      bigger = "This PC needs its own Java 21 now: about 45 MB, downloaded into the Deepslate folder only. Nothing else on the PC changes." },
    [ordered]@{ id = "neoforge"; title = "NeoForge"; text = "The mod loader. Installed into its own profile; your normal Minecraft isn't touched."; required = $true; top = 1 },
    [ordered]@{ id = "mods"; title = "Mods and settings"; text = "Downloads the mods the server uses, from Modrinth. Updates after this happen by themselves."; required = $true; top = 1 },
    [ordered]@{ id = "profile"; title = "Launcher profile and server list"; text = "Adds a 'Deepslate Works' profile and the server address."; required = $true; top = 1 },
    [ordered]@{ id = "shortcuts"; title = "Shortcuts and Play button"; text = "Adds a desktop icon and lets the website's Play button open this app."; required = $false; top = 1 },
    [ordered]@{ id = "reports"; title = "Send install reports"; text = "Sends a log of what happened to the site so Alex can fix problems. Your username and file paths are removed. If you say Not now, only 'pressed Play' and the pack version are sent: the server needs that to let you in."; required = $false; top = 1 },
    [ordered]@{ id = "extras"; title = "Optional visual extras"; text = "Download the optional visual extras? About {0} MB, nothing is switched on. You choose them in the Extras tab."; required = $false; top = 1 }
  )
}
function Get-ConsentStep([string]$id) { return @(Get-ConsentSteps | Where-Object { $_.id -eq $id })[0] }

function Read-JsonFile([string]$path) {
  if (-not $path -or -not [IO.File]::Exists($path)) { return $null }
  try { return ([IO.File]::ReadAllText($path) | ConvertFrom-Json) } catch { Log ("could not read " + $path + ": " + $_.Exception.Message); return $null }
}
function Write-JsonFile([string]$path, $obj) {
  [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($path))
  $tmp = $path + ".new"
  [IO.File]::WriteAllText($tmp, (ConvertTo-Json -InputObject $obj -Depth 8), (New-Object Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $tmp -Destination $path -Force
}

# The answers: @{ <step id> = @{ answer = "allow" | "decline"; level = <what was allowed, or done>; at = <when> } }
function Read-Consent([string]$path) {
  $c = @{}
  $j = Read-JsonFile $path
  if ($j -and $j.PSObject.Properties["steps"]) {
    foreach ($p in $j.steps.PSObject.Properties) {
      $a = [string]$p.Value.answer
      if ($a -ne "allow" -and $a -ne "decline") { continue }
      $lv = 1; try { $lv = [int]$p.Value.level } catch {}
      $c[$p.Name] = @{ answer = $a; level = $lv; at = [string]$p.Value.at }
    }
  }
  return $c
}
function Save-Consent([string]$path, $c) {
  $steps = [ordered]@{}
  foreach ($k in @($c.Keys | Sort-Object)) { $steps[$k] = [ordered]@{ answer = $c[$k].answer; level = $c[$k].level; at = $c[$k].at } }
  Write-JsonFile $path ([ordered]@{ version = 1; steps = $steps })
}
function Set-ConsentAnswer($c, [string]$id, [string]$answer, [int]$level) {
  $c[$id] = @{ answer = $answer; level = $level; at = (Get-Date).ToUniversalTime().ToString("s") }
}
# "allow", "decline", or "ask": asked when the step is new, or when it is about to do something bigger than the
# answer covers (a Java download after a run that used the launcher's own Java).
function Get-ConsentDecision($c, [string]$id, [int]$level = 1) {
  if (-not $c.ContainsKey($id)) { return "ask" }
  if ($c[$id].answer -eq "decline") { return "decline" }
  if ([int]$c[$id].level -lt $level) { return "ask" }
  return "allow"
}
# The steps with no answer yet: all of them on the first run, a new step after an update.
function Get-UnansweredSteps($c) { return @(Get-ConsentSteps | Where-Object { -not $c.ContainsKey($_.id) }) }
# After a run: what was really done becomes the level the answer covers ("bigger than before" is measured against it).
function Set-ConsentUsed($c, [string]$id, [int]$level) {
  if ($c.ContainsKey($id) -and $c[$id].answer -eq "allow") { $c[$id].level = $level }
}

# ---- the engine's side: progress lines for the window, and the questions it cannot answer itself -------------
function Emit($o) {
  if (-not $StatusFile) { return }
  try { [IO.File]::AppendAllText($StatusFile, (ConvertTo-Json -InputObject $o -Compress -Depth 5) + "`n", (New-Object Text.UTF8Encoding($false))) } catch {}
}
# $true: go ahead. $false: an optional step that was declined. A step that needs asking, or a needed step that was
# declined, ends the run here: the window asks (or says why it stopped) and starts it again.
function Request-Consent([string]$id, [int]$level = 1) {
  if ($AllowAll -or $Console) { return $true }
  $d = Get-ConsentDecision $script:Consent $id $level
  $s = Get-ConsentStep $id
  if ($d -eq "allow") { return $true }
  if ($d -eq "decline" -and -not $s.required) { Log ("permission: '{0}' declined, skipped" -f $s.title); return $false }
  if ($d -eq "ask") {
    Log ("permission: '{0}' needs an answer (level {1})" -f $s.title, $level)
    Emit ([ordered]@{ t = "ask"; step = $id; level = $level })
    $script:Reported = $true
    Exit-Lock
    exit $ExitAsk
  }
  Log ("permission: '{0}' is needed to play and was declined: stopped" -f $s.title)
  Emit ([ordered]@{ t = "declined"; step = $id })
  $script:Reported = $true
  Exit-Lock
  exit $ExitDeclined
}

# ---- extras -------------------------------------------------------------------------------------------------
function Get-ExtrasPaths([string]$gameDir) {
  return @{
    extras = (Join-Path $gameDir "extras"); pictures = (Join-Path (Join-Path $gameDir "extras") "pictures")
    mods = (Join-Path $gameDir "mods"); resourcepacks = (Join-Path $gameDir "resourcepacks"); shaderpacks = (Join-Path $gameDir "shaderpacks")
    options = (Join-Path $gameDir "options.txt"); iris = (Join-Path (Join-Path $gameDir "config") "iris.properties")
    staging = (Join-Path $gameDir ".downloading")
  }
}
$ExtraFolders = @{ mod = "mods"; resourcepack = "resourcepacks"; shader = "shaderpacks" }
function Get-ExtraFolder([string]$kind) { $f = $ExtraFolders[$kind]; if (-not $f) { $f = "mods" }; return $f }

function New-ExtrasState { return @{ choices = @{}; shader = "none"; applied = @{ mods = @(); resourcepacks = @(); shaderpacks = @() }; seen = @(); downloaded = $false } }
function Read-ExtrasState([string]$path) {
  $s = New-ExtrasState
  $j = Read-JsonFile $path
  if (-not $j) { return $s }
  if ($j.PSObject.Properties["choices"] -and $j.choices) { foreach ($p in $j.choices.PSObject.Properties) { $s.choices[$p.Name] = [bool]$p.Value } }
  if ($j.PSObject.Properties["shader"] -and @("none", "light", "full") -contains [string]$j.shader) { $s.shader = [string]$j.shader }
  if ($j.PSObject.Properties["applied"] -and $j.applied) { foreach ($k in @("mods", "resourcepacks", "shaderpacks")) { if ($j.applied.PSObject.Properties[$k]) { $s.applied[$k] = @($j.applied.$k | Where-Object { $_ } | ForEach-Object { [string]$_ }) } } }
  if ($j.PSObject.Properties["seen"]) { $s.seen = @($j.seen | ForEach-Object { [string]$_ }) }
  if ($j.PSObject.Properties["downloaded"]) { $s.downloaded = [bool]$j.downloaded }
  return $s
}
function Save-ExtrasState([string]$path, $s) {
  Write-JsonFile $path ([ordered]@{ version = 1; choices = $s.choices; shader = $s.shader; applied = $s.applied; seen = @($s.seen); downloaded = [bool]$s.downloaded })
}

# Which extras are on: a switch that is on, the shader pack for the Shaders choice (only with Iris on), and whatever
# an extra that is on requires. Returns the ids.
function Get-ExtrasOn($manifest, $state) {
  $on = @{}
  foreach ($x in @($manifest.extras)) {
    if ($x.shader) { if ($state.choices["iris"] -and $state.shader -eq [string]$x.shader) { $on[[string]$x.id] = $true } }
    elseif ($state.choices[[string]$x.id]) { $on[[string]$x.id] = $true }
  }
  foreach ($x in @($manifest.extras)) { if ($on[[string]$x.id]) { foreach ($r in @($x.requires)) { if ($r) { $on[[string]$r] = $true } } } }
  return @($on.Keys | Sort-Object)
}
# The files that should be in mods\, resourcepacks\, shaderpacks\ for what is on, and the shader pack's file.
function Get-ExtrasWanted($manifest, $state) {
  $w = @{ mods = @(); resourcepacks = @(); shaderpacks = @(); shaderFile = ""; known = @{ mods = @(); resourcepacks = @(); shaderpacks = @() }; sha = @{} }
  $on = Get-ExtrasOn $manifest $state
  foreach ($x in @($manifest.extras)) {
    foreach ($f in @($x.files)) {
      $folder = Get-ExtraFolder ([string]$f.kind)
      $w.known[$folder] += [string]$f.filename
      $w.sha[[string]$f.filename] = [string]$f.sha512
      if ($on -contains [string]$x.id) {
        $w[$folder] += [string]$f.filename
        if ([string]$f.kind -eq "shader") { $w.shaderFile = [string]$f.filename }
      }
    }
  }
  return $w
}
function Get-Sha512([string]$file) {
  $sha = [System.Security.Cryptography.SHA512]::Create()
  return [BitConverter]::ToString($sha.ComputeHash([IO.File]::ReadAllBytes($file))).Replace("-", "").ToLower()
}
function Move-ExtraFile([string]$from, [string]$to) {
  if ([IO.File]::Exists($to)) { [IO.File]::Delete($to) }
  [IO.File]::Move($from, $to)
}

# Apply: moves the chosen extras' files from extras\ into the game's folders and the others back, sets options.txt
# (Fresh Animations) and Iris's shader, then checks every file. Any error, or a check that fails: everything is put
# back as it was, files and settings, and the answer says why. $io.move can be replaced (the self test makes it fail).
function Invoke-ExtrasApply($paths, $manifest, $state, $io = $null) {
  $move = { param($a, $b) Move-ExtraFile $a $b }
  if ($io -and $io.move) { $move = $io.move }
  $want = Get-ExtrasWanted $manifest $state
  $journal = New-Object System.Collections.Generic.List[object]
  $before = @{}
  foreach ($k in @("options", "iris")) { $before[$k] = $(if ([IO.File]::Exists($paths[$k])) { [IO.File]::ReadAllText($paths[$k]) } else { $null }) }
  try {
    [void][IO.Directory]::CreateDirectory($paths.extras)
    foreach ($folder in @("mods", "resourcepacks", "shaderpacks")) {
      $dir = $paths[$folder]
      [void][IO.Directory]::CreateDirectory($dir)
      # what was put there before (or what the manifest knows about and is lying there) and is no longer wanted: back
      $was = @(@($state.applied[$folder]) + @($want.known[$folder] | Where-Object { [IO.File]::Exists((Join-Path $dir $_)) }) | Where-Object { $_ } | Select-Object -Unique)
      foreach ($f in $was) {
        if ($want[$folder] -contains $f -or ([string]$f) -match '[\\/]') { continue }
        $at = Join-Path $dir $f
        if (-not [IO.File]::Exists($at)) { continue }
        $back = Join-Path $paths.extras $f
        & $move $at $back
        $journal.Add(@($at, $back))
      }
      foreach ($f in @($want[$folder])) {
        $at = Join-Path $dir $f
        $from = Join-Path $paths.extras $f
        if ([IO.File]::Exists($at) -and -not [IO.File]::Exists($from)) { continue }   # already in place
        if (-not [IO.File]::Exists($from)) { throw ("{0} is not downloaded yet. Press Play once to fetch the extras." -f $f) }
        & $move $from $at
        $journal.Add(@($from, $at))
      }
    }
    $r = Set-ResourcePackList $paths.options @($want.resourcepacks) @($want.known.resourcepacks)
    Log ("extras: " + $r.text)
    if ($state.choices["iris"]) { Set-IrisShader $paths.iris $want.shaderFile }
    # the check: what should be there is there and whole; what should not be is not
    foreach ($folder in @("mods", "resourcepacks", "shaderpacks")) {
      foreach ($f in @($want[$folder])) {
        $at = Join-Path $paths[$folder] $f
        if (-not [IO.File]::Exists($at)) { throw ("{0} did not arrive in {1}" -f $f, $folder) }
        if ($want.sha[$f] -and (Get-Sha512 $at) -ne $want.sha[$f]) { throw ("{0} is damaged" -f $f) }
      }
      foreach ($f in @($want.known[$folder])) { if ($want[$folder] -notcontains $f -and [IO.File]::Exists((Join-Path $paths[$folder] $f))) { throw ("{0} is still in {1}" -f $f, $folder) } }
    }
    $state.applied = @{ mods = @($want.mods); resourcepacks = @($want.resourcepacks); shaderpacks = @($want.shaderpacks) }
    Log ("extras applied: " + ((Get-ExtrasOn $manifest $state) -join ", "))
    return @{ ok = $true; moved = $journal.Count; error = $null }
  } catch {
    $why = $_.Exception.Message
    Log ("extras: apply failed, putting everything back: " + $why)
    for ($i = $journal.Count - 1; $i -ge 0; $i--) {
      $m = $journal[$i]
      try { if ([IO.File]::Exists($m[1])) { Move-ExtraFile $m[1] $m[0] } } catch { Log ("extras: could not put back " + $m[1] + ": " + $_.Exception.Message) }
    }
    foreach ($k in @("options", "iris")) {
      try {
        if ($null -eq $before[$k]) { if ([IO.File]::Exists($paths[$k])) { [IO.File]::Delete($paths[$k]) } }
        else { [IO.File]::WriteAllText($paths[$k], $before[$k], (New-Object Text.UTF8Encoding($false))) }
      } catch { Log ("extras: could not put back " + $paths[$k] + ": " + $_.Exception.Message) }
    }
    return @{ ok = $false; moved = 0; error = $why }
  }
}

# The engine, on every Play once extras are allowed: every extra's files in extras\ (or already in place), checked;
# files of extras that are on and changed version are swapped by applying again; leftovers of old versions removed.
function Sync-ExtrasFiles($paths, $manifest, $state, [scriptblock]$fetch) {
  [void][IO.Directory]::CreateDirectory($paths.extras)
  [void][IO.Directory]::CreateDirectory($paths.pictures)
  $got = 0
  $names = @{}
  $placedChanged = $false
  foreach ($x in @($manifest.extras)) {
    if ($x.picture) { try { [IO.File]::WriteAllBytes((Join-Path $paths.pictures ("{0}.png" -f $x.id)), [Convert]::FromBase64String([string]$x.picture)) } catch {} }
    foreach ($f in @($x.files)) {
      $name = [string]$f.filename
      if ($name -match '[\\/]|^\.\.?$') { continue }
      $names[$name] = $true
      $folder = Get-ExtraFolder ([string]$f.kind)
      $placed = Join-Path $paths[$folder] $name
      if ($state.applied[$folder] -contains $name -and [IO.File]::Exists($placed) -and (Get-Sha512 $placed) -eq [string]$f.sha512) { continue }
      $at = Join-Path $paths.extras $name
      if ([IO.File]::Exists($at) -and (Get-Sha512 $at) -eq [string]$f.sha512) { continue }
      $r = Save-ModFile ([string]$f.url) $at ([string]$f.sha512) $paths.staging $fetch
      if ($r -eq "wrong") { throw ("{0} downloaded wrong" -f $name) }
      if ($r -eq "in use") { throw ("{0} is in use" -f $name) }
      $got++
    }
  }
  # an extra that is on, whose file is a new version now: apply again (the old file goes back to extras\, then away)
  foreach ($folder in @("mods", "resourcepacks", "shaderpacks")) { foreach ($f in @($state.applied[$folder])) { if (-not $names[$f]) { $placedChanged = $true } } }
  $want = Get-ExtrasWanted $manifest $state
  foreach ($folder in @("mods", "resourcepacks", "shaderpacks")) { foreach ($f in @($want[$folder])) { if ($state.applied[$folder] -notcontains $f) { $placedChanged = $true } } }
  $applied = $null
  if ($placedChanged) { $applied = Invoke-ExtrasApply $paths $manifest $state }
  # old versions in extras\ and in the game's folders (only names the extras once had)
  $removed = 0
  foreach ($f in @(Get-ChildItem -LiteralPath $paths.extras -File -Force)) {
    if (-not $names[$f.Name] -and $f.Name -notlike "*.json") { try { [IO.File]::Delete($f.FullName); $removed++ } catch {} }
  }
  return @{ downloaded = $got; removed = $removed; applied = $applied }
}

# The jars of the extras that are on: the engine's mod sync leaves them in mods\.
function Get-AppliedExtraJars($state) { return @($state.applied.mods | Where-Object { $_ }) }

# ---- the game: running? closing it nicely, and starting it again ----------------------------------------------
# $procs: objects with Id, Name and CommandLine (Win32_Process on Windows; made up in the self test).
function Find-GameProcess([string]$gameDir, $procs) {
  $needle = $gameDir.TrimEnd('\', '/').ToLower()
  return @($procs | Where-Object { ([string]$_.Name) -match '^javaw?(\.exe)?$' -and ([string]$_.CommandLine).ToLower().Contains($needle) })
}
function Get-JavaProcesses {
  try { return @(Get-CimInstance Win32_Process -Filter "Name='javaw.exe' or Name='java.exe'" -ErrorAction Stop | Select-Object @{ n = "Id"; e = { $_.ProcessId } }, Name, CommandLine) } catch { return @() }
}
# Closes the game the way its window's X would (WM_CLOSE), gives it 30 seconds to save and stop, then ends it.
function Stop-Game($ids, [int]$waitSec = 30) {
  foreach ($id in @($ids)) { try { $null = (Get-Process -Id $id -ErrorAction Stop).CloseMainWindow() } catch {} }
  $deadline = (Get-Date).AddSeconds($waitSec)
  while ((Get-Date) -lt $deadline) {
    if (@($ids | Where-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue }).Count -eq 0) { return "closed" }
    Start-Sleep -Milliseconds 500
  }
  foreach ($id in @($ids)) { try { Stop-Process -Id $id -Force -ErrorAction Stop } catch {} }
  return "forced"
}
# What the Extras tab does with Apply. A running game holds its jars open (Windows will not move them), so with the
# game running it asks "Restart the game to apply?" first: Restart now closes it, applies, opens the launcher again;
# Later keeps the choice and the next Play applies it.
function Get-ApplyRoute([bool]$gameRunning, [bool]$changed) {
  if (-not $changed) { return "nothing" }
  if ($gameRunning) { return "ask_restart" }
  return "apply"
}
# Has anything been switched since the last Apply?
function Test-ExtrasChanged($manifest, $state) {
  $w = Get-ExtrasWanted $manifest $state
  foreach ($k in @("mods", "resourcepacks", "shaderpacks")) {
    if ((@($w[$k] | Sort-Object) -join "|") -ne (@($state.applied[$k] | Sort-Object) -join "|")) { return $true }
  }
  return $false
}

# A weak PC, the way the site measures one (lib/install-report.ts suggestTier: LOW): under 8 GB of memory, or no
# graphics card of its own. Only a warning next to the heavier extras; nothing is blocked.
function Test-WeakPc($ramGb, $gpuNames) {
  $real = @($gpuNames | Where-Object { $_ -and $_ -notmatch 'microsoft basic|parsec|virtual|remote|hyper-v|citrix|displaylink' })
  if ($null -ne $ramGb -and [double]$ramGb -lt 7.5) { return $true }
  if ($real.Count -eq 0) { return $true }   # memory known, no graphics card seen: built-in graphics
  $strong = 'rtx\s*\d{4}|gtx\s*(10[678]0|1660|9[78]0)|rx\s*(5[5-9]00|[6-9]\d00)|arc\s*\(?(tm)?\)?\s*[ab]\d{3}'
  $dedicated = 'geforce|rtx|gtx|quadro|radeon\s+(rx|pro|hd)|\brx\s*\d{3,4}|arc\s*\(?(tm)?\)?\s*[ab]\d{3}'
  $integrated = 'intel\b.*\b(u?hd|iris|graphics)\b|radeon(\(tm\))?\s+(r[2-7]\s)?graphics|vega\s*\d|microsoft basic'
  $card = @($real | Where-Object { ($_ -match $dedicated) -and (($_ -notmatch $integrated) -or ($_ -match $strong)) })
  return ($card.Count -eq 0)
}
function Get-LocalWeakPc {
  $ram = $null; $gpus = @()
  try { $ram = [math]::Round((Get-CimInstance Win32_ComputerSystem -ErrorAction Stop).TotalPhysicalMemory / 1GB, 1) } catch {}
  try { $gpus = @(Get-CimInstance Win32_VideoController -ErrorAction Stop | ForEach-Object { [string]$_.Name }) } catch {}
  if ($null -eq $ram -and $gpus.Count -eq 0) { return $false }
  return (Test-WeakPc $ram $gpus)
}

# ==== the window (2.0.0) ===================================================================================
# WPF, from this one script. The install steps do not run in here: the window starts this script again, hidden, as
# -Engine, reads its progress from a status file every quarter of a second, and asks the questions the engine stops
# for (exit 20). One window per PC user: a second start (the Play button on the site, the shortcut) only brings it
# to the front and presses Play. It stays open until it is closed; the game closing does not close it.

$AppXaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="Deepslate Works" Width="580" Height="700" MinWidth="480" MinHeight="520" WindowStartupLocation="CenterScreen"
        FontFamily="Segoe UI" FontSize="13" Background="#F6F7F8">
  <Window.Resources>
    <Style TargetType="Button" x:Key="Primary">
      <Setter Property="Background" Value="#2E7D5B"/><Setter Property="Foreground" Value="White"/><Setter Property="BorderThickness" Value="0"/>
      <Setter Property="Padding" Value="18,8"/><Setter Property="FontWeight" Value="SemiBold"/><Setter Property="Cursor" Value="Hand"/>
    </Style>
  </Window.Resources>
  <TabControl x:Name="Tabs" Margin="8" Background="White">
    <TabItem Header="  Play  " x:Name="PlayTab">
      <DockPanel Margin="14">
        <StackPanel DockPanel.Dock="Top" Margin="0,0,0,10">
          <TextBlock x:Name="PlayTitle" FontSize="20" FontWeight="SemiBold" Text="Deepslate Works"/>
          <TextBlock x:Name="PlayStatus" TextWrapping="Wrap" Margin="0,4,0,0" Foreground="#444"/>
          <TextBlock x:Name="PlayChanged" TextWrapping="Wrap" Margin="0,4,0,0" Foreground="#2E7D5B" FontWeight="SemiBold" Visibility="Collapsed"/>
        </StackPanel>
        <DockPanel DockPanel.Dock="Bottom" Margin="0,10,0,0">
          <TextBlock DockPanel.Dock="Left" VerticalAlignment="Center"><Hyperlink x:Name="ReviewLink">Review permissions</Hyperlink></TextBlock>
          <Button x:Name="PlayButton" DockPanel.Dock="Right" HorizontalAlignment="Right" Style="{StaticResource Primary}" Content="Play" MinWidth="150"/>
        </DockPanel>
        <ScrollViewer VerticalScrollBarVisibility="Auto"><StackPanel x:Name="PlayBody"/></ScrollViewer>
      </DockPanel>
    </TabItem>
    <TabItem Header="  Extras  " x:Name="ExtrasTab">
      <DockPanel Margin="14">
        <StackPanel DockPanel.Dock="Top" Margin="0,0,0,10">
          <TextBlock FontSize="20" FontWeight="SemiBold" Text="Extras"/>
          <TextBlock TextWrapping="Wrap" Margin="0,4,0,0" Foreground="#444" Text="Only on this PC, never voted on. Other players don't need them: you can play together either way."/>
        </StackPanel>
        <DockPanel DockPanel.Dock="Bottom" Margin="0,10,0,0">
          <Button x:Name="ApplyButton" DockPanel.Dock="Right" Style="{StaticResource Primary}" Content="Apply" MinWidth="120"/>
          <TextBlock x:Name="ExtrasStatus" TextWrapping="Wrap" VerticalAlignment="Center" Margin="0,0,12,0" Foreground="#444"/>
        </DockPanel>
        <ScrollViewer VerticalScrollBarVisibility="Auto"><StackPanel x:Name="ExtrasBody"/></ScrollViewer>
      </DockPanel>
    </TabItem>
    <TabItem Header="  Log  " x:Name="LogTab">
      <TextBox x:Name="LogBox" Margin="10" IsReadOnly="True" TextWrapping="NoWrap" FontFamily="Consolas" FontSize="12"
               VerticalScrollBarVisibility="Auto" HorizontalScrollBarVisibility="Auto"/>
    </TabItem>
  </TabControl>
</Window>
'@

$RestartXaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="Deepslate Works" Width="420" SizeToContent="Height" ResizeMode="NoResize" WindowStartupLocation="CenterOwner"
        FontFamily="Segoe UI" FontSize="13" Background="White">
  <StackPanel Margin="18">
    <TextBlock FontSize="16" FontWeight="SemiBold" Text="Restart the game to apply?"/>
    <TextBlock x:Name="Why" TextWrapping="Wrap" Margin="0,8,0,16" Foreground="#444"
               Text="Minecraft is running and has the mods open. Restart now closes it (like its own X button, so the world is saved), switches your extras, and opens the launcher on Deepslate Works again. Later keeps your choice for the next time you press Play."/>
    <StackPanel Orientation="Horizontal" HorizontalAlignment="Right">
      <Button x:Name="Later" Content="Later" Padding="16,6" Margin="0,0,8,0"/>
      <Button x:Name="Now" Content="Restart now" Padding="16,6" Background="#2E7D5B" Foreground="White" BorderThickness="0" FontWeight="SemiBold"/>
    </StackPanel>
  </StackPanel>
</Window>
'@

function New-Brush([string]$hex) { return (New-Object Windows.Media.BrushConverter).ConvertFromString($hex) }
function New-Text([string]$text, [double]$size = 13, [string]$weight = "Normal", [string]$color = "#222") {
  $t = New-Object Windows.Controls.TextBlock
  $t.Text = $text; $t.FontSize = $size; $t.TextWrapping = "Wrap"; $t.Foreground = New-Brush $color
  $t.FontWeight = [Windows.FontWeights]::$weight
  return $t
}
function New-Badge([string]$text, [string]$bg, [string]$fg) {
  $b = New-Object Windows.Controls.Border
  $b.Background = New-Brush $bg; $b.CornerRadius = 8; $b.Padding = "6,1"; $b.Margin = "6,0,0,0"; $b.VerticalAlignment = "Center"
  $t = New-Text $text 11 "SemiBold" $fg
  $b.Child = $t
  return $b
}
function New-Card {
  $b = New-Object Windows.Controls.Border
  $b.BorderBrush = New-Brush "#D9DDE1"; $b.BorderThickness = 1; $b.CornerRadius = 6; $b.Padding = 12; $b.Margin = "0,0,0,8"; $b.Background = New-Brush "White"
  return $b
}

# One permission card: title, "Needed to play" when it is, the plain-English text, Allow / Not now.
function New-ConsentCard($step, $answers, [int]$level = 1, [string]$size = "") {   # $answers: $script:App.Answers
  $card = New-Card
  $sp = New-Object Windows.Controls.StackPanel
  $head = New-Object Windows.Controls.StackPanel; $head.Orientation = "Horizontal"
  $head.Children.Add((New-Text $step.title 14 "SemiBold")) | Out-Null
  if ($step.required) { $head.Children.Add((New-Badge "Needed to play" "#E8F3EE" "#2E7D5B")) | Out-Null } else { $head.Children.Add((New-Badge "Optional" "#EEF0F2" "#555")) | Out-Null }
  $sp.Children.Add($head) | Out-Null
  $text = [string]$step.text
  if ($level -gt 1 -and $step.bigger) { $text = [string]$step.bigger }
  if ($text.Contains("{0}")) { $text = $text -f $(if ($size) { $size } else { "10" }) }
  $body = New-Text $text 13 "Normal" "#444"; $body.Margin = "0,4,0,8"
  $sp.Children.Add($body) | Out-Null
  $row = New-Object Windows.Controls.StackPanel; $row.Orientation = "Horizontal"
  $group = "consent-" + $step.id
  $allow = New-Object Windows.Controls.RadioButton; $allow.Content = "Allow"; $allow.GroupName = $group; $allow.Margin = "0,0,18,0"
  $no = New-Object Windows.Controls.RadioButton; $no.Content = "Not now"; $no.GroupName = $group
  $warn = New-Text "" 12 "Normal" "#B3261E"; $warn.Margin = "0,6,0,0"; $warn.Visibility = "Collapsed"
  # handlers get what they need from Tag (closures made with GetNewClosure cannot see this script's functions)
  $allow.Tag = @{ id = [string]$step.id; warn = $warn }
  $no.Tag = @{ id = [string]$step.id; warn = $warn; required = [bool]$step.required }
  $allow.Add_Checked({ param($sender, $e) $script:App.Answers[$sender.Tag.id] = "allow"; $sender.Tag.warn.Visibility = "Collapsed"; Update-ContinueButton })
  $no.Add_Checked({ param($sender, $e)
    $script:App.Answers[$sender.Tag.id] = "decline"
    if ($sender.Tag.required) { $sender.Tag.warn.Text = "Deepslate Works can't set up the game without this. You can play only once it's allowed."; $sender.Tag.warn.Visibility = "Visible" }
    Update-ContinueButton
  })
  $id = [string]$step.id
  if ($answers.ContainsKey($id)) { if ($answers[$id] -eq "allow") { $allow.IsChecked = $true } else { $no.IsChecked = $true } }
  $row.Children.Add($allow) | Out-Null; $row.Children.Add($no) | Out-Null
  $sp.Children.Add($row) | Out-Null
  $sp.Children.Add($warn) | Out-Null
  $card.Child = $sp
  return $card
}

function Show-App([string]$shotsDir = "") {
  Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase
  $script:App = @{}
  $A = $script:App
  $A.ConsentPath = Join-Path $AppHome $ConsentFileName
  $A.ExtrasStatePath = Join-Path $AppHome $ExtrasStateName
  $A.ExtrasManifestPath = Join-Path $AppHome $ExtrasManifestName
  $A.Consent = Read-Consent $A.ConsentPath
  $A.Answers = @{}
  $A.Mode = "idle"      # idle | asking | running
  $A.Proc = $null
  $A.StatusPath = $null
  $A.StatusPos = 0
  $A.Ask = $null
  $A.Used = @{}
  $A.Weak = $false
  try { $A.Weak = Get-LocalWeakPc } catch {}
  $A.ShowSignal = $script:PendingSignal

  $w = [Windows.Markup.XamlReader]::Parse($AppXaml)
  $A.Window = $w
  foreach ($n in @("Tabs", "PlayTab", "ExtrasTab", "LogTab", "PlayTitle", "PlayStatus", "PlayChanged", "ReviewLink", "PlayButton", "PlayBody", "ApplyButton", "ExtrasStatus", "ExtrasBody", "LogBox")) { $A[$n] = $w.FindName($n) }
  try { $w.Title = "{0} {1}" -f $PackName, $InstallerVersion } catch {}

  $A.PlayButton.Add_Click({ On-PlayButton })
  $A.ReviewLink.Add_Click({ Show-Review })
  $A.ApplyButton.Add_Click({ On-Apply })
  $A.Tabs.Add_SelectionChanged({ param($sender, $e) if ($e.OriginalSource -eq $script:App.Tabs) { if ($script:App.Tabs.SelectedItem -eq $script:App.ExtrasTab) { Show-Extras } elseif ($script:App.Tabs.SelectedItem -eq $script:App.LogTab) { Update-LogBox } } })

  $timer = New-Object Windows.Threading.DispatcherTimer
  $timer.Interval = [TimeSpan]::FromMilliseconds(250)
  $timer.Add_Tick({ On-Tick })
  $A.Timer = $timer

  if ($shotsDir) { Save-Screenshots $shotsDir; return }

  $timer.Start()
  $w.Add_ContentRendered({
    if (@(Get-UnansweredSteps $script:App.Consent).Count -gt 0) { Show-FirstRun } else { Start-Run }
  })
  $w.Add_Closing({ param($s, $e)
    if ($script:App.Mode -eq "running") {
      $r = [Windows.MessageBox]::Show("Deepslate Works is still setting up the game. Close anyway? It carries on next time you press Play.", "Deepslate Works", "YesNo", "Question")
      if ($r -ne "Yes") { $e.Cancel = $true; return }
      try { $script:App.Proc.Kill() } catch {}
    }
  })
  [void]$w.ShowDialog()
}

function Update-ContinueButton {
  $A = $script:App
  if ($A.Mode -ne "asking") { return }
  $all = $true
  foreach ($s in @($A.Asking)) { if (-not $A.Answers.ContainsKey($s.id)) { $all = $false } }
  $A.PlayButton.IsEnabled = $all
}

function Clear-PlayBody { $script:App.PlayBody.Children.Clear(); $script:App.PlayChanged.Visibility = "Collapsed" }
function Add-PlayLine([string]$text, [string]$color = "#222", [string]$weight = "Normal") {
  $t = New-Text $text 13 $weight $color; $t.Margin = "0,2,0,2"
  $script:App.PlayBody.Children.Add($t) | Out-Null
  return $t
}

# First run (or new steps after an update): every unanswered step as a card, then Continue.
function Show-FirstRun([object[]]$only = $null, [int]$level = 1) {
  $A = $script:App
  $A.Mode = "asking"
  Clear-PlayBody
  $steps = $(if ($only) { $only } else { @(Get-UnansweredSteps $A.Consent) })
  $A.Asking = $steps
  $first = (@($A.Consent.Keys).Count -eq 0)
  $A.PlayTitle.Text = $(if ($first) { "Before we start" } else { "One question" })
  $A.PlayStatus.Text = $(if ($first) { "Deepslate Works asks once for each thing it does on this PC. Your answers are remembered; Review permissions changes them." } else { "Deepslate Works is about to do something it hasn't asked about yet." })
  $size = ""
  $m = Read-JsonFile $A.ExtrasManifestPath
  if ($m -and $m.size) { $size = "{0:0}" -f ([double]$m.size / 1MB) }
  foreach ($s in $steps) { $A.PlayBody.Children.Add((New-ConsentCard $s $A.Answers $level $size)) | Out-Null }
  $A.PlayButton.Content = "Continue"
  $A.AskLevel = $level
  Update-ContinueButton
}

function Save-Answers {
  $A = $script:App
  foreach ($s in @($A.Asking)) {
    if (-not $A.Answers.ContainsKey($s.id)) { continue }
    $lv = $(if ($A.Answers[$s.id] -eq "allow") { [Math]::Max([int]$A.AskLevel, [int]$s.top) } else { 1 })
    Set-ConsentAnswer $A.Consent $s.id $A.Answers[$s.id] $lv
  }
  Save-Consent $A.ConsentPath $A.Consent
}

function On-PlayButton {
  $A = $script:App
  if ($A.Mode -eq "asking") {
    Save-Answers
    $no = @($A.Asking | Where-Object { $_.required -and $A.Answers[$_.id] -eq "decline" })
    if ($no.Count -gt 0) { Show-Stopped $no[0]; return }
    Start-Run
    return
  }
  if ($A.Mode -eq "idle") { Start-Run }
}

function Show-Stopped($step) {
  $A = $script:App
  $A.Mode = "idle"
  Clear-PlayBody
  $A.PlayTitle.Text = "Stopped"
  $A.PlayStatus.Text = ("You said Not now to '{0}', which is needed to play. Nothing more was done. To carry on, open Review permissions and choose Allow." -f $step.title)
  $A.PlayButton.Content = "Play"
  $A.PlayButton.IsEnabled = $true
}

# Review permissions: every step with its current answer, changeable.
function Show-Review {
  $A = $script:App
  if ($A.Mode -eq "running") { return }
  $A.Answers = @{}
  foreach ($k in $A.Consent.Keys) { $A.Answers[$k] = $A.Consent[$k].answer }
  Show-FirstRun @(Get-ConsentSteps)
  $A.PlayTitle.Text = "Permissions"
  $A.PlayStatus.Text = "What Deepslate Works may do on this PC. Changes count from the next Play."
  $A.PlayButton.Content = "Save and play"
}

function Start-Run([switch]$NoLaunch) {
  $A = $script:App
  $A.Mode = "running"
  Clear-PlayBody
  $A.PlayTitle.Text = "Getting the game ready"
  $A.PlayStatus.Text = "Checking for updates, then the Minecraft Launcher opens on Deepslate Works."
  $A.PlayButton.Content = "Working..."
  $A.PlayButton.IsEnabled = $false
  $A.Used = @{}
  $A.StatusPath = Join-Path $Temp ("deepslate-status-{0}.jsonl" -f ([guid]::NewGuid().ToString("N").Substring(0, 8)))
  [IO.File]::WriteAllText($A.StatusPath, "")
  $A.StatusPos = 0
  $A.LastAsk = $null; $A.LastDeclined = $null; $A.LastFail = $null; $A.Changed = $null
  $args2 = @("-NoProfile", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-File", ('"{0}"' -f $script:MePath), "-Engine", "-StatusFile", ('"{0}"' -f $A.StatusPath))
  if ($NoLaunch) { $args2 += "-NoLaunch" }
  if (-not [IO.File]::Exists($script:MePath)) { $script:MePath = Join-Path (Get-HomeDir) $ScriptName }   # moved by the 1.5.3 step
  $A.Proc = Start-Process -FilePath (Get-PowerShellExe) -ArgumentList $args2 -WindowStyle Hidden -PassThru
  $null = $A.Proc.Handle   # Windows PowerShell only keeps the exit code of a process whose handle was read
  if ($env:DEEPSLATE_UPDATED_FROM) { [Environment]::SetEnvironmentVariable("DEEPSLATE_UPDATED_FROM", $null) }   # said once, by the first run
}

function On-Tick {
  $A = $script:App
  # a second start of the app (the Play button on the site, a shortcut): to the front, and Play when idle
  if ($A.ShowSignal -and $A.ShowSignal.WaitOne(0)) {
    try { if ($A.Window.WindowState -eq "Minimized") { $A.Window.WindowState = "Normal" }; $A.Window.Activate() | Out-Null; $A.Window.Topmost = $true; $A.Window.Topmost = $false } catch {}
    $A.Tabs.SelectedItem = $A.PlayTab
    if ($A.Mode -eq "idle") { Start-Run }
  }
  if ($A.Mode -ne "running" -or -not $A.StatusPath) { return }
  Read-StatusLines
  if ($A.Proc -and $A.Proc.HasExited) { Read-StatusLines; On-RunEnded ([int]$A.Proc.ExitCode) }
}

function Read-StatusLines {
  $A = $script:App
  # whole lines only: a line the engine is still writing is read on the next tick
  try {
    $fs = [IO.File]::Open($A.StatusPath, "Open", "Read", "ReadWrite")
    try {
      $null = $fs.Seek($A.StatusPos, "Begin")
      $buf = New-Object byte[] ([int]($fs.Length - $A.StatusPos))
      $n = $fs.Read($buf, 0, $buf.Length)
    } finally { $fs.Dispose() }
    $end = [Array]::LastIndexOf($buf, [byte]10, [Math]::Max(0, $n - 1))
    if ($n -le 0 -or $end -lt 0) { return }
    $text = [Text.Encoding]::UTF8.GetString($buf, 0, $end + 1)
    $A.StatusPos += $end + 1
  } catch { return }
  foreach ($line in ($text -split "`n")) {
    if (-not $line.Trim()) { continue }
    try { $o = $line | ConvertFrom-Json } catch { continue }
    switch ([string]$o.t) {
      "step" { Add-PlayLine ([string]$o.text) "#555" | Out-Null }
      "tick" { Add-PlayLine ([string]([char]0x2713) + "  " + [string]$o.text) "#2E7D5B" | Out-Null }
      "note" { Add-PlayLine ("   " + [string]$o.text) "#666" | Out-Null }
      "fail" { $A.LastFail = [string]$o.text; Add-PlayLine ([string]$o.text) "#B3261E" "SemiBold" | Out-Null }
      "ask" { $A.LastAsk = $o }
      "declined" { $A.LastDeclined = $o }
      "used" { $A.Used[[string]$o.step] = [int]$o.level }
      "changed" { $A.Changed = [string]$o.text }
    }
  }
}

function On-RunEnded([int]$code) {
  $A = $script:App
  $A.Mode = "idle"
  $A.PlayButton.Content = "Play"
  $A.PlayButton.IsEnabled = $true
  foreach ($k in $A.Used.Keys) { Set-ConsentUsed $A.Consent $k $A.Used[$k] }
  if ($A.Used.Count) { Save-Consent $A.ConsentPath $A.Consent }
  try { Remove-Item -LiteralPath $A.StatusPath -Force -ErrorAction SilentlyContinue } catch {}
  if ($code -eq $ExitAsk -and $A.LastAsk) {
    $s = Get-ConsentStep ([string]$A.LastAsk.step)
    $A.Answers = @{}
    Show-FirstRun @($s) ([int]$A.LastAsk.level)
    return
  }
  if ($code -eq $ExitDeclined -and $A.LastDeclined) { Show-Stopped (Get-ConsentStep ([string]$A.LastDeclined.step)); return }
  if ($code -eq $ExitAlreadyRunning) { $A.PlayTitle.Text = "Already running"; $A.PlayStatus.Text = "Deepslate Works is busy in another window. Let it finish, then press Play."; return }
  if ($code -ne 0) {
    $A.PlayTitle.Text = "That didn't work"
    $A.PlayStatus.Text = $(if ($A.LastFail) { $A.LastFail } else { "Something went wrong. The Log tab has the details; Alex has them too if reports are on." })
    return
  }
  $A.PlayTitle.Text = "Ready"
  $A.PlayStatus.Text = "The Minecraft Launcher is opening on Deepslate Works: press Play there. This window can stay open, or be closed."
  if ($A.Changed) { $A.PlayChanged.Text = $A.Changed; $A.PlayChanged.Visibility = "Visible" }
  # updated itself on this run: the window starts the new copy and closes
  $now = Get-ScriptVersion $script:MePath
  if ($now -and (Test-Newer $now $InstallerVersion)) {
    Start-Process -FilePath (Get-PowerShellExe) -ArgumentList @("-NoProfile", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-File", ('"{0}"' -f $script:MePath)) -WindowStyle Hidden
    $A.Window.Close()
  }
}

function Update-LogBox {
  $A = $script:App
  try {
    $lines = @()
    if ([IO.File]::Exists($LogFile)) { $lines = @([IO.File]::ReadAllLines($LogFile) | Select-Object -Last 500) }
    $A.LogBox.Text = ($lines -join "`r`n")
    $A.LogBox.ScrollToEnd()
  } catch {}
}

# ---- the Extras tab ---------------------------------------------------------------------------------------
function Show-Extras {
  $A = $script:App
  $A.ExtrasBody.Children.Clear()
  $A.ExtrasStatus.Text = ""
  $m = Read-JsonFile $A.ExtrasManifestPath
  $st = Read-ExtrasState $A.ExtrasStatePath
  $A.XManifest = $m; $A.XState = $st
  $allowed = (Get-ConsentDecision $A.Consent "extras") -eq "allow"
  if (-not $m -or -not $allowed -or -not $st.downloaded) {
    $card = New-Card
    $sp = New-Object Windows.Controls.StackPanel
    $size = $(if ($m -and $m.size) { "{0:0}" -f ([double]$m.size / 1MB) } else { "10" })
    $sp.Children.Add((New-Text "Download the optional visual extras?" 14 "SemiBold")) | Out-Null
    $t = New-Text ("About {0} MB, nothing is switched on. Once they're on this PC, switching one on or off is instant and works offline." -f $size) 13 "Normal" "#444"; $t.Margin = "0,4,0,10"
    $sp.Children.Add($t) | Out-Null
    $b = New-Object Windows.Controls.Button; $b.Content = "Download"; $b.Style = $A.Window.FindResource("Primary"); $b.HorizontalAlignment = "Left"
    $b.Add_Click({
      Set-ConsentAnswer $script:App.Consent "extras" "allow" 1
      Save-Consent $script:App.ConsentPath $script:App.Consent
      $script:App.Tabs.SelectedItem = $script:App.PlayTab
      Start-Run -NoLaunch
    })
    $sp.Children.Add($b) | Out-Null
    $card.Child = $sp
    $A.ExtrasBody.Children.Add($card) | Out-Null
    $A.ApplyButton.IsEnabled = $false
    return
  }
  $A.ApplyButton.IsEnabled = $true
  $A.XBoxes = @{}
  $A.XShader = @{}
  $pictures = (Get-ExtrasPaths $DataDir).pictures
  foreach ($x in @($m.extras | Where-Object { -not $_.shader })) {
    $card = New-Card
    $g = New-Object Windows.Controls.Grid
    foreach ($wd in @((New-Object Windows.GridLength(52)), (New-Object Windows.GridLength(1, [Windows.GridUnitType]::Star)), [Windows.GridLength]::Auto)) { $c = New-Object Windows.Controls.ColumnDefinition; $c.Width = $wd; $g.ColumnDefinitions.Add($c) }
    $img = New-Object Windows.Controls.Image; $img.Width = 40; $img.Height = 40; $img.VerticalAlignment = "Top"
    $pic = Join-Path $pictures ("{0}.png" -f $x.id)
    if ([IO.File]::Exists($pic)) { try { $bmp = New-Object Windows.Media.Imaging.BitmapImage; $bmp.BeginInit(); $bmp.CacheOption = "OnLoad"; $bmp.UriSource = New-Object Uri($pic); $bmp.EndInit(); $img.Source = $bmp } catch {} }
    [Windows.Controls.Grid]::SetColumn($img, 0); $g.Children.Add($img) | Out-Null
    $sp = New-Object Windows.Controls.StackPanel; [Windows.Controls.Grid]::SetColumn($sp, 1)
    $head = New-Object Windows.Controls.WrapPanel
    $head.Children.Add((New-Text ([string]$x.name) 14 "SemiBold")) | Out-Null
    $tone = @{ Low = @("#E8F3EE", "#2E7D5B"); Medium = @("#FFF4E0", "#8A5A00"); High = @("#FDECEA", "#B3261E") }[[string]$x.fps]
    $head.Children.Add((New-Badge ("FPS cost: {0}" -f $x.fps) $tone[0] $tone[1])) | Out-Null
    if ($st.seen -notcontains [string]$x.id) { $head.Children.Add((New-Badge "New" "#E3F0FF" "#1A5FB4")) | Out-Null }
    $sp.Children.Add($head) | Out-Null
    $d = New-Text ([string]$x.description) 12.5 "Normal" "#555"; $d.Margin = "0,2,0,0"; $sp.Children.Add($d) | Out-Null
    if ($A.Weak -and ([string]$x.fps -ne "Low")) { $wn = New-Text "This PC looks like an older laptop or one without a graphics card: this one may make the game stutter." 12 "Normal" "#8A5A00"; $wn.Margin = "0,4,0,0"; $sp.Children.Add($wn) | Out-Null }
    $g.Children.Add($sp) | Out-Null
    $cb = New-Object Windows.Controls.CheckBox; $cb.Content = "On"; $cb.VerticalAlignment = "Center"; $cb.Margin = "12,0,0,0"
    $cb.IsChecked = [bool]$st.choices[[string]$x.id]
    [Windows.Controls.Grid]::SetColumn($cb, 2); $g.Children.Add($cb) | Out-Null
    $A.XBoxes[[string]$x.id] = $cb
    $outer = New-Object Windows.Controls.StackPanel
    $outer.Children.Add($g) | Out-Null
    if ([string]$x.id -eq "iris") {
      # Shaders: None / Light / Full, only with Iris on
      $row = New-Object Windows.Controls.WrapPanel; $row.Margin = "52,8,0,0"
      $row.Children.Add((New-Text "Shaders:  " 13 "SemiBold")) | Out-Null
      foreach ($opt in @(@("none", "None"), @("light", "Light (MakeUp Ultra Fast)"), @("full", "Full (Complementary Reimagined)"))) {
        $rb = New-Object Windows.Controls.RadioButton; $rb.Content = $opt[1]; $rb.GroupName = "shaders"; $rb.Margin = "0,0,14,0"
        $rb.IsChecked = ($st.shader -eq $opt[0])
        $sx = @($m.extras | Where-Object { $_.shader -eq $opt[0] })[0]
        if ($sx -and $A.Weak -and [string]$sx.fps -ne "Low") { $rb.ToolTip = "This PC may stutter with these." }
        $row.Children.Add($rb) | Out-Null
        $A.XShader[$opt[0]] = $rb
      }
      $row.IsEnabled = [bool]$cb.IsChecked
      $cb.Tag = $row
      $cb.Add_Checked({ param($sender, $e) $sender.Tag.IsEnabled = $true })
      $cb.Add_Unchecked({ param($sender, $e) $sender.Tag.IsEnabled = $false })
      $outer.Children.Add($row) | Out-Null
    }
    $card.Child = $outer
    $A.ExtrasBody.Children.Add($card) | Out-Null
  }
  # what has been shown counts as seen: "New" once
  $st.seen = @($m.extras | ForEach-Object { [string]$_.id })
  Save-ExtrasState $A.ExtrasStatePath $st
  $A.XState = $st
}

function Read-ExtrasChoices {
  $A = $script:App
  $st = Read-ExtrasState $A.ExtrasStatePath
  foreach ($k in $A.XBoxes.Keys) { $st.choices[$k] = [bool]$A.XBoxes[$k].IsChecked }
  foreach ($k in $A.XShader.Keys) { if ($A.XShader[$k].IsChecked) { $st.shader = $k } }
  return $st
}

function On-Apply {
  $A = $script:App
  if ($A.Mode -eq "running") { $A.ExtrasStatus.Text = "Wait until the Play tab is done."; return }
  $m = $A.XManifest
  $st = Read-ExtrasChoices
  $running = @(Find-GameProcess $DataDir (Get-JavaProcesses))
  $route = Get-ApplyRoute ($running.Count -gt 0) (Test-ExtrasChanged $m $st)
  if ($route -eq "nothing") { Save-ExtrasState $A.ExtrasStatePath $st; $A.ExtrasStatus.Text = "Nothing to change."; return }
  if ($route -eq "ask_restart") {
    $answer = Show-RestartPrompt
    if ($answer -ne "now") {
      Save-ExtrasState $A.ExtrasStatePath $st
      $A.ExtrasStatus.Text = "Saved. Your extras switch the next time you press Play."
      return
    }
    $A.ExtrasStatus.Text = "Closing Minecraft..."
    $A.Window.Dispatcher.Invoke([Action]{}, [Windows.Threading.DispatcherPriority]::Background)
    $how = Stop-Game @($running | ForEach-Object { $_.Id })
    Log ("extras: the game was " + $how + " to apply")
  }
  $r = Invoke-ExtrasApply (Get-ExtrasPaths $DataDir) $m $st
  if ($r.ok) {
    Save-ExtrasState $A.ExtrasStatePath $st
    $A.ExtrasStatus.Text = $(if ($route -eq "ask_restart") { "Done. The Minecraft Launcher is opening again: press Play there." } else { "Done. They're on the next time the game starts." })
    if ($route -eq "ask_restart") { $null = Open-Launcher }
  } else {
    $A.ExtrasStatus.Text = ("Nothing changed: {0}. Everything is as it was." -f $r.error)
  }
}

function Show-RestartPrompt([switch]$NoWait) {
  $d = [Windows.Markup.XamlReader]::Parse($RestartXaml)
  $d.Owner = $script:App.Window
  $script:App.RestartAnswer = "later"
  ($d.FindName("Now")).Add_Click({ param($sender, $e) $script:App.RestartAnswer = "now"; [Windows.Window]::GetWindow($sender).Close() })
  ($d.FindName("Later")).Add_Click({ param($sender, $e) $script:App.RestartAnswer = "later"; [Windows.Window]::GetWindow($sender).Close() })
  if ($NoWait) { return $d }
  [void]$d.ShowDialog()
  return $script:App.RestartAnswer
}

# -Screenshots <folder>: the first-run Play tab, the Extras tab and the restart prompt, as PNG files. Drawn off screen.
function Save-Png($visual, [string]$file) {
  $visual.UpdateLayout()
  $w = [int][Math]::Ceiling($visual.ActualWidth); $h = [int][Math]::Ceiling($visual.ActualHeight)
  $bmp = New-Object Windows.Media.Imaging.RenderTargetBitmap($w, $h, 96, 96, [Windows.Media.PixelFormats]::Pbgra32)
  $bmp.Render($visual)
  $enc = New-Object Windows.Media.Imaging.PngBitmapEncoder
  $enc.Frames.Add([Windows.Media.Imaging.BitmapFrame]::Create($bmp))
  $fs = [IO.File]::Create($file); try { $enc.Save($fs) } finally { $fs.Dispose() }
}
function Save-Screenshots([string]$dir) {
  $A = $script:App
  [void][IO.Directory]::CreateDirectory($dir)
  $pump = { $A.Window.Dispatcher.Invoke([Action]{}, [Windows.Threading.DispatcherPriority]::Background) }
  $A.Window.WindowStartupLocation = "Manual"; $A.Window.Left = -20000; $A.Window.Top = 0; $A.Window.ShowInTaskbar = $false
  $A.Window.Show(); & $pump
  # 1. first run: every step unanswered
  $A.Consent = @{}
  Show-FirstRun
  & $pump; Save-Png $A.Window.Content (Join-Path $dir "1-play-first-run.png")
  # 2. Extras: what this PC has (it needs one Play with extras downloaded)
  $A.Consent = Read-Consent $A.ConsentPath
  $A.Tabs.SelectedItem = $A.ExtrasTab
  Show-Extras
  & $pump; Save-Png $A.Window.Content (Join-Path $dir "2-extras.png")
  # 3. the restart prompt
  $d = Show-RestartPrompt -NoWait
  $d.WindowStartupLocation = "Manual"; $d.Left = -20000; $d.Top = 0; $d.ShowInTaskbar = $false
  $d.Show(); $d.Dispatcher.Invoke([Action]{}, [Windows.Threading.DispatcherPriority]::Background)
  Save-Png $d.Content (Join-Path $dir "3-restart-prompt.png")
  $d.Close()
  $A.Window.Close()
  Write-Host ("Screenshots in {0}" -f $dir)
  try { Start-Process $dir } catch {}
}

# Starts the window, once per PC user. A second start signals the first (to the front, Play) and ends.
function Start-AppWindow {
  $created = $false
  $mutex = New-Object Threading.Mutex($true, "Local\DeepslateWorks.App", [ref]$created)
  $signal = New-Object Threading.EventWaitHandle($false, [Threading.EventResetMode]::AutoReset, "Local\DeepslateWorks.App.Show")
  if (-not $created) {
    [void]$signal.Set()
    Log "the window is already open: brought to the front"
    return
  }
  try {
    try {
      Add-Type -Namespace DW -Name Win -MemberDefinition '[DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow(); [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);'
      $null = [DW.Win]::ShowWindow([DW.Win]::GetConsoleWindow(), 0)   # the console window PowerShell came with: hidden
    } catch {}
    $script:PendingSignal = $signal
    Show-App
  } finally {
    try { $mutex.ReleaseMutex() } catch {}
    $mutex.Dispose(); $signal.Dispose()
  }
}

if ($SelfTest) {
  # Runs the code against scratch copies of what it works on (a launcher profile file, a mods folder, a home folder).
  # Works under Windows PowerShell 5.1 and under pwsh on Linux. Touches nothing outside its own folder.
  $dir = Join-Path $Temp ("deepslate-selftest-" + [Guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $f = Join-Path $dir "launcher_profiles.json"
  $defaults = '{"profiles":{"a1b2":{"created":"1970-01-01T00:00:00.000Z","icon":"Grass","lastUsed":"1970-01-01T00:00:00.000Z","lastVersionId":"latest-release","name":"","type":"latest-release"},"c3d4":{"created":"1970-01-01T00:00:00.000Z","icon":"Dirt","lastUsed":"1970-01-01T00:00:00.000Z","lastVersionId":"latest-snapshot","name":"","type":"latest-snapshot"}},"settings":{"crashAssistance":true,"enableAdvanced":false,"keepLauncherOpen":false,"profileSorting":"ByLastPlayed","showGameLog":false},"version":3}'
  $utf8 = New-Object Text.UTF8Encoding($false)
  $bad = 0
  function Check($name, $ok) { if ($ok) { Write-Host ("   [OK] {0}" -f $name) -ForegroundColor Green } else { Write-Host ("   [FAIL] {0}" -f $name) -ForegroundColor Red; $script:SelfTestBad++ } }
  $script:SelfTestBad = 0
  Write-Host "Self test: launcher profile" -ForegroundColor White
  $entry = [ordered]@{ name = "Deepslate Works"; type = "custom"; lastVersionId = "neoforge-21.1.252"; gameDir = "C:\Users\x\AppData\Roaming\.minecraft-deepslate-works"; javaArgs = "-Xmx6G"; javaDir = "C:\java.exe"; icon = "Furnace"; created = "2026-09-29T10:00:00.000Z"; lastUsed = "2026-09-29T10:00:00.000Z" }

  [IO.File]::WriteAllText($f, $defaults, $utf8)
  Check "a fresh file has no profile of ours" ((Test-LauncherProfile $f "deepslate-works" "neoforge-21.1.252") -ne "")
  Set-LauncherProfile $f "deepslate-works" $entry
  Check "after writing, the profile is there" ((Test-LauncherProfile $f "deepslate-works" "neoforge-21.1.252") -eq "")
  $bytes = [IO.File]::ReadAllBytes($f)
  Check "written without a byte-order mark" (-not ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF))
  $j = Read-Json $f
  Check "the launcher's own two profiles are still there" ($j.profiles.PSObject.Properties["a1b2"] -and $j.profiles.PSObject.Properties["c3d4"])
  Check "the launcher's settings are still there" ($j.settings.profileSorting -eq "ByLastPlayed" -and $j.version -eq 3)
  Check "our profile is the selected one" ($j.selectedProfile -eq "deepslate-works")
  Check "paths with backslashes survive" ($j.profiles.PSObject.Properties["deepslate-works"].Value.gameDir -eq $entry.gameDir)
  Check "the file as it was is kept as .bak" ((Test-Path "$f.bak") -and ([IO.File]::ReadAllText("$f.bak") -eq $defaults))
  Check "no temporary file is left behind" (-not (Test-Path "$f.deepslate-tmp"))

  $again = [ordered]@{ name = "Deepslate Works"; type = "custom"; lastVersionId = "neoforge-21.1.253"; gameDir = $entry.gameDir; javaArgs = "-Xmx4G"; javaDir = "C:\java.exe"; icon = "Furnace"; created = "2026-10-05T10:00:00.000Z"; lastUsed = "2026-10-05T10:00:00.000Z" }
  Set-LauncherProfile $f "deepslate-works" $again
  $j = Read-Json $f
  $ours = $j.profiles.PSObject.Properties["deepslate-works"].Value
  Check "a second run updates the profile in place" ($ours.lastVersionId -eq "neoforge-21.1.253" -and $ours.javaArgs -eq "-Xmx4G" -and @($j.profiles.PSObject.Properties).Count -eq 3)
  Check "and keeps the date it was first created" ($ours.created -eq "2026-09-29T10:00:00.000Z")
  Check "a profile pointing at the old version is noticed" ((Test-LauncherProfile $f "deepslate-works" "neoforge-21.1.252") -match "points at")

  [IO.File]::WriteAllText($f, $defaults, $utf8)   # what the launcher did on 2026-09-29: back to its two defaults
  $msg = Test-LauncherProfile $f "deepslate-works" "neoforge-21.1.253"
  Check ("a launcher that rewrote the file is noticed: " + $msg) ($msg -match "is not in launcher_profiles.json")

  [IO.File]::WriteAllText($f, $defaults, (New-Object Text.UTF8Encoding($true)))
  Set-LauncherProfile $f "deepslate-works" $entry
  $bytes = [IO.File]::ReadAllBytes($f)
  Check "a file that came with a byte-order mark is read, and written back without" (((Test-LauncherProfile $f "deepslate-works" "neoforge-21.1.252") -eq "") -and $bytes[0] -ne 0xEF)

  [IO.File]::WriteAllText($f, '{"profiles": {', $utf8)
  Check "a broken file is reported, not crashed on" ((Test-LauncherProfile $f "deepslate-works" "x") -match "can't be read")
  Remove-Item $f -Force
  Check "a missing file is reported" ((Test-LauncherProfile $f "deepslate-works" "x") -match "is gone")

  $PretendRunning = @()
  $real = @(Find-Launcher)
  Check ("no launcher is found when none runs (found: " + ($real -join ", ") + ")") ($real.Count -eq 0)
  $PretendRunning = @("MinecraftLauncher")
  Check "a running launcher is found" (@(Find-Launcher) -contains "MinecraftLauncher")

  Write-Host "Self test: what an install report leaves out" -ForegroundColor White
  $script:Personal = @("player", "ALEX-PC")
  $script:Token = "Q2hhbmdlTWVQbGVhc2VUaGlzSXNBVG9rZW5fMTIzNDU2Nzg5MA"
  $r = Redact "[t] looked in C:\Users\player\AppData\Roaming\.minecraft on ALEX-PC for player, token Q2hhbmdlTWVQbGVhc2VUaGlzSXNBVG9rZW5fMTIzNDU2Nzg5MA, mail a@b.co, from 203.0.113.10 and 2a01:4b00::1 at 07:26:01" -Addresses
  Check ("the name in the path, the user, the PC, the token, the mail and the addresses are gone: " + $r) (($r -notmatch "(?i)player|alex-pc|Q2hhbmdl|a@b\.co|88\.202|2a01") -and ($r -match "C:\\Users\\~\\AppData") -and ($r -match "07:26:01"))
  Check "versions are left readable" ((Redact "NeoForge 21.1.252 on Windows 10.0.26100, driver 32.0.15.6094" -Addresses) -eq "NeoForge 21.1.252 on Windows 10.0.26100, driver 32.0.15.6094")
  Check "a path outside Users is left alone" ((Redact "C:\Program Files\Java\bin\java.exe") -eq "C:\Program Files\Java\bin\java.exe")
  $tree = Redact-Tree ([ordered]@{ java = [ordered]@{ path = "C:\Users\player\scoop\java.exe"; version = "21.0.4" }; gpus = @([ordered]@{ name = "NVIDIA GeForce RTX 3070"; driver = "32.0.15.6094" }); ramGb = 31.9 })
  $tj = $tree | ConvertTo-Json -Depth 8 -Compress
  Check ("the description of the PC is cleaned the same way: " + $tj) (($tj -notmatch "player") -and ($tj -match "RTX 3070") -and ($tj -match "31.9") -and ($tj -match '"gpus":\['))
  $long = ("START " + ("x" * 700000) + " END")
  $cut = Shorten $long (512 * 1024)
  Check "a long log is cut in the middle and keeps both ends" (([Text.Encoding]::UTF8.GetByteCount($cut) -le 512 * 1024) -and $cut.StartsWith("START") -and $cut.EndsWith("END") -and ($cut -match "was cut to fit"))
  $script:RunLog.Clear(); $script:StepName = "Checking the Minecraft Launcher"
  Log "STEP Checking the Minecraft Launcher"; Log "FAIL Install the Minecraft Launcher, player"
  $rep = New-Report "failed"
  $rj = $rep | ConvertTo-Json -Depth 8 -Compress
  Check "a failed run names the step it failed at" ($rep.failedStep -eq "Checking the Minecraft Launcher" -and $rep.outcome -eq "failed")
  Check "a run that went well names no step" ((New-Report "ok").failedStep -eq $null)
  Check "the report holds no user name, PC name or token" ($rj -notmatch "(?i)player|alex-pc|Q2hhbmdl")
  Check "the report says what ran" ($rep.installerVersion -eq $InstallerVersion -and $rep.durationSec -ge 0 -and $rep.system.powershell)
  Write-Host "Self test: what the site says about an old installer" -ForegroundColor White
  Check "an answer without a notice shows nothing" ((Show-Notice ([pscustomobject]@{ ok = $true; notice = $null })) -eq $false -and (Show-Notice $null) -eq $false)
  Check "an answer with a notice is shown" ((Show-Notice ([pscustomobject]@{ ok = $true; notice = "This PC has installer 1.4.2; the current one is 1.4.3." })) -eq $true)
  $null = Show-Notice ([pscustomobject]@{ notice = "a`e[2J`nb" })
  Check ("a notice is shown as plain text on one line: " + $script:RunLog[-1]) ($script:RunLog[-1].EndsWith("] the site says: a [2J b"))
  $script:Token = $null

  Write-Host "Self test: the Play link, the handler and the shortcuts" -ForegroundColor White
  Check "deepslate://play is accepted, with or without the slash a browser adds" ((Test-PlayLink "deepslate://play") -and (Test-PlayLink "deepslate://play/") -and (Test-PlayLink "DEEPSLATE://PLAY"))
  $no = @("deepslate://play/../x", "deepslate://play?root=\\evil\share", "deepslate://play -Root C:\x", 'deepslate://play" -SelfTest "', "deepslate://update", "deepslate://", "deepslate:play", "http://deepslate.dsw.test/play", "deepslate://play/ ", " deepslate://play", "deepslate://play`n-DryRun", "deepslate://play -Setup", "deepslate://uninstall", "deepslate://play -Uninstall", "")
  $let = @($no | Where-Object { Test-PlayLink $_ })
  Check ("every other link is refused (let through: " + $let.Count + ")") ($let.Count -eq 0)
  $keepRoot = $env:SystemRoot; $env:SystemRoot = "C:\Windows"
  $home2 = "C:\Users\x\AppData\Local\DeepslateWorks\DeepslateWorks.ps1"
  $cmd = Get-HandlerCommand $home2
  Check ("Windows is told to run the one script for the link, without a console window: " + $cmd) ($cmd -eq '"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "C:\Users\x\AppData\Local\DeepslateWorks\DeepslateWorks.ps1" "%1"')
  $sc = Get-ShortcutSpec $home2
  Check ("the shortcuts run the same script, with nothing else: " + $sc.arguments) (($sc.target -eq "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe") -and ($sc.arguments -eq '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "C:\Users\x\AppData\Local\DeepslateWorks\DeepslateWorks.ps1"'))
  $env:SystemRoot = $keepRoot

  Write-Host "Self test: the home folder" -ForegroundColor White
  $hd = Join-Path $dir "LocalAppData [x]\DeepslateWorks"
  [void][IO.Directory]::CreateDirectory($hd)
  foreach ($old in @("install.ps1", "install.ps1.bak", "Setup.bat")) { [IO.File]::WriteAllText((Join-Path $hd $old), "old") }
  $src = Join-Path $dir "zip folder\DeepslateWorks.ps1"
  [void][IO.Directory]::CreateDirectory((Split-Path -Parent $src))
  [IO.File]::WriteAllText($src, ('$InstallerVersion = "' + $InstallerVersion + '"' + "`nWrite-Host this"))
  $t = Install-Home $src $hd
  $names = @(Get-ChildItem -LiteralPath $hd -Force | ForEach-Object { $_.Name } | Sort-Object) -join ","
  Check ("the script is put in place and the old layout is left until the link points at it: " + $names) (($t -eq (Join-Path $hd "DeepslateWorks.ps1")) -and ($names -eq "DeepslateWorks.ps1,install.ps1,install.ps1.bak,Setup.bat"))
  Remove-OldLayout $hd
  $names = @(Get-ChildItem -LiteralPath $hd -Force | ForEach-Object { $_.Name }) -join ","
  Check ("then Setup leaves one script and nothing of the old layout: " + $names) ($names -eq "DeepslateWorks.ps1")
  [IO.File]::WriteAllText($t, '$InstallerVersion = "9.0.0"' + "`nWrite-Host newer")
  $null = Install-Home $src $hd
  Check "an older script never goes over a newer one that is already there" ((Get-ScriptVersion $t) -eq "9.0.0")

  Write-Host "Self test: a 1.4.x copy updated into this one" -ForegroundColor White
  # 1.4.x's update step takes install.ps1 and Setup.bat out of the zip, puts them over its own in the home folder and
  # starts install.ps1 -Play "deepslate://play" with DEEPSLATE_UPDATED_FROM set. Here: that home, with the Play link
  # (a file standing in for the registry) still naming install.ps1, and this very script started the way 1.4.x starts it.
  $lad = Join-Path $dir "whole path [1.4.x]\LocalAppData"
  $wh = Join-Path $lad "DeepslateWorks"
  $wio = Join-Path $dir "whole path [1.4.x]\registry and shortcuts"
  [void][IO.Directory]::CreateDirectory($wh); [void][IO.Directory]::CreateDirectory($wio)
  Copy-Item -LiteralPath $PSCommandPath -Destination (Join-Path $wh "install.ps1")
  [IO.File]::WriteAllText((Join-Path $wh "install.ps1.bak"), '$InstallerVersion = "1.4.3"')
  [IO.File]::WriteAllText((Join-Path $wh "Setup.bat"), "from the zip")
  $oldHandler = ('"{0}" -NoProfile -ExecutionPolicy Bypass -File "{1}" -Play "%1"' -f (Get-PowerShellExe), (Join-Path $wh "install.ps1"))
  [IO.File]::WriteAllText((Join-Path $wio "handler.txt"), $oldHandler)
  $wad = Join-Path $dir "whole path [1.4.x]\Roaming"
  [void][IO.Directory]::CreateDirectory($wad)
  $keepEnv = @{ l = $env:LOCALAPPDATA; a = $env:APPDATA; u = $env:DEEPSLATE_UPDATED_FROM; h = $env:DEEPSLATE_SELFTEST_HOME }
  $env:LOCALAPPDATA = $lad; $env:APPDATA = $wad; $env:DEEPSLATE_UPDATED_FROM = "1.4.3"; $env:DEEPSLATE_SELFTEST_HOME = $wio
  $o = Join-Path $dir "whole path.out"
  try {
    $p = Start-Process -FilePath ((Get-Process -Id $PID).Path) -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ('"{0}"' -f (Join-Path $wh "install.ps1")), "-Play", "deepslate://play") -Wait -PassThru -NoNewWindow -RedirectStandardOutput $o
    $code = $p.ExitCode
  } finally { $env:LOCALAPPDATA = $keepEnv.l; $env:APPDATA = $keepEnv.a; $env:DEEPSLATE_UPDATED_FROM = $keepEnv.u; $env:DEEPSLATE_SELFTEST_HOME = $keepEnv.h }
  $out = if ([IO.File]::Exists($o)) { [IO.File]::ReadAllText($o) } else { "" }
  $newScript = Join-Path $wh "DeepslateWorks.ps1"
  Check ("install.ps1 -Play deepslate://play starts (exit " + $code + ") and says why it was given -Play") (($code -eq 0) -and ($out -match "started by an older installer's update step"))
  $names = @(Get-ChildItem -LiteralPath $wh -Force | ForEach-Object { $_.Name }) -join ","
  Check ("afterwards the home holds only DeepslateWorks.ps1: " + $names) ($names -eq "DeepslateWorks.ps1")
  Check "and it is this script" ([IO.File]::Exists($newScript) -and ((Get-FileHash -LiteralPath $newScript -Algorithm SHA256).Hash -eq (Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash))
  $h = [IO.File]::ReadAllText((Join-Path $wio "handler.txt"))
  Check ("the Play link points at it: " + $h) ($h -eq (Get-HandlerCommand $newScript))
  Check "the desktop shortcut, the Start Menu entries and the Settings -> Apps entry are there" ((@("Desktop.lnk", "Programs.lnk", "Uninstall.lnk", "apps.txt") | Where-Object { -not [IO.File]::Exists((Join-Path $wio $_)) }).Count -eq 0)
  Check "the report says updatedFrom 1.4.3, from this installer" ($out -match ("report: installer=" + [regex]::Escape($InstallerVersion) + " updatedFrom=1\.4\.3"))
  Check "and it does not update itself again in that run" ($out -match "update step: not again in this run")
  # a link that could not be set: the old files stay, so the Play button still starts something
  $lh = Join-Path $dir "no link\DeepslateWorks"
  [void][IO.Directory]::CreateDirectory($lh)
  Copy-Item -LiteralPath $PSCommandPath -Destination (Join-Path $lh "install.ps1")
  $stuck = Get-FileHomeIo (Join-Path $dir "no link")
  $stuck.setHandler = { param($t) return $false }
  $r = Repair-Home (Join-Path $lh "install.ps1") $lh $stuck
  Check "when the Play link cannot be pointed at the new script, install.ps1 is kept" ((-not $r.linked) -and [IO.File]::Exists((Join-Path $lh "install.ps1")) -and [IO.File]::Exists((Join-Path $lh "DeepslateWorks.ps1")))

  Write-Host "Self test: Setup, part by part (1.5.6)" -ForegroundColor White
  $ft = Join-Path $dir "fake temp"
  Check "a script in %TEMP%\Temp1_installer.zip is inside the zip; one in an extracted folder is not" ((Test-InsideZip (Join-Path $ft "Temp1_installer.zip\DeepslateWorks.ps1") $ft) -and (Test-InsideZip (Join-Path $ft "Temp2_installer (1).zip\installer\DeepslateWorks.ps1") $ft) -and -not (Test-InsideZip (Join-Path $dir "Downloads\installer\DeepslateWorks.ps1") $ft) -and -not (Test-InsideZip (Join-Path $ft "deepslate-update\DeepslateWorks.ps1") $ft))
  # run from inside the zip: the real -Setup in a copy of this script, with its own TEMP and LOCALAPPDATA
  $zd = Join-Path $ft "Temp1_installer.zip"
  [void][IO.Directory]::CreateDirectory($zd)
  Copy-Item -LiteralPath $PSCommandPath -Destination (Join-Path $zd "DeepslateWorks.ps1")
  $zl = Join-Path $dir "zip LocalAppData"; $za = Join-Path $dir "zip Roaming"
  [void][IO.Directory]::CreateDirectory($za)
  $keepZ = @{ t = $env:TEMP; l = $env:LOCALAPPDATA; a = $env:APPDATA }
  $env:TEMP = $ft; $env:LOCALAPPDATA = $zl; $env:APPDATA = $za
  $zo = Join-Path $dir "zip.out"
  try {
    $p = Start-Process -FilePath ((Get-Process -Id $PID).Path) -ArgumentList @("-NoProfile", "-File", ('"{0}"' -f (Join-Path $zd "DeepslateWorks.ps1")), "-Setup") -Wait -PassThru -NoNewWindow -RedirectStandardOutput $zo
    $zc = $p.ExitCode
  } finally { $env:TEMP = $keepZ.t; $env:LOCALAPPDATA = $keepZ.l; $env:APPDATA = $keepZ.a }
  $zt = if ([IO.File]::Exists($zo)) { [IO.File]::ReadAllText($zo) } else { "" }
  Check ("run from inside the zip: stops (exit " + $zc + ") and says to extract it first") (($zc -eq 2) -and ($zt -match "Setup\.bat was started from inside the zip\. Right-click the zip, choose Extract All, then run Setup\.bat from the new folder\."))
  Check "and nothing was copied or registered" ((-not (Test-Path -LiteralPath $zl)) -and (@(Get-ChildItem -LiteralPath $za -Force).Count -eq 0))

  $dl = Join-Path $dir "Downloads [x]\installer"
  [void][IO.Directory]::CreateDirectory($dl)
  $dlScript = Join-Path $dl "DeepslateWorks.ps1"
  Copy-Item -LiteralPath $PSCommandPath -Destination $dlScript
  function New-SetupIo([string]$name) { $a = Join-Path $dir $name; [void][IO.Directory]::CreateDirectory($a); $x = Get-FileHomeIo $a; $x.sleep = { param($n) $script:Slept += $n }; return $x }
  $denied = { param($from, $to) $script:Tries++; throw (New-Object UnauthorizedAccessException ("Access to the path '" + $to + "' is denied.")) }

  $script:Tries = 0; $script:Slept = 0
  $io2 = New-SetupIo "denied twice"; $io2.copier = $denied
  $h2 = Join-Path $dir "denied twice home\DeepslateWorks"
  $r2 = Repair-Home $dlScript $h2 $io2 -Force
  $c2 = @($r2.problems | Where-Object { $_.part -eq "copy" })
  Check ("copy refused twice: tried twice, 2 s apart, and says so: " + $c2[0].message) (($script:Tries -eq 2) -and ($script:Slept -eq 2) -and ($c2.Count -eq 1) -and ($c2[0].code -eq "copy_denied") -and ($c2[0].message -eq ("Your antivirus or Windows stopped the installer copying itself to {0}. The game is installed and works from the Deepslate Works launcher profile; the Play button on the site won't work on this PC until this is fixed." -f $h2)))
  Check "and the Play link is still set up, to the script where it ran" (($r2.linked) -and ([IO.File]::ReadAllText((Join-Path $io2.at "handler.txt")) -eq (Get-HandlerCommand $dlScript)) -and (@($r2.problems).Count -eq 1))
  Check "each part has its own line on screen" ((@($r2.said | ForEach-Object { $_.text }) -join "|") -eq ($c2[0].message + "|The Play button on the site now starts Deepslate Works on this PC|Shortcuts made"))

  $script:Tries = 0; $script:Slept = 0
  $io3 = New-SetupIo "denied once"; $io3.copier = { param($from, $to) $script:Tries++; if ($script:Tries -eq 1) { throw (New-Object IO.IOException "The process cannot access the file because it is being used by another process.") }; Copy-Item -LiteralPath $from -Destination $to -Force }
  $h3 = Join-Path $dir "denied once home\DeepslateWorks"
  $r3 = Repair-Home $dlScript $h3 $io3 -Force
  Check "copy refused once (antivirus scanning): the second try works, nothing to report" (($script:Tries -eq 2) -and ($script:Slept -eq 2) -and (@($r3.problems).Count -eq 0) -and ($r3.script -eq (Join-Path $h3 "DeepslateWorks.ps1")) -and [IO.File]::Exists($r3.script) -and ($r3.said[0].text -eq ("Installed in " + $h3)))

  $io4 = New-SetupIo "no desktop"; $io4.makeShortcuts = { param($t) return @{ made = 2; failed = @(@{ where = "desktop"; message = "Access is denied." }) } }; $io4.cfa = { return $true }
  $h4 = Join-Path $dir "no desktop home\DeepslateWorks"
  $r4 = Repair-Home $dlScript $h4 $io4 -Force
  Check "desktop not writable with ransomware protection on: a note, and the home copy and the link are fine" ((@($r4.problems).Count -eq 1) -and ($r4.problems[0].code -eq "shortcut_blocked") -and $r4.linked -and ($r4.script -eq (Join-Path $h4 "DeepslateWorks.ps1")) -and (@($r4.said | Where-Object { $_.tone -eq "note" })[0].text -eq "Windows' ransomware protection blocked the desktop shortcut. The Start Menu entry and the Play button still work."))
  $io4.cfa = { return $false }
  $r5 = Repair-Home $dlScript (Join-Path $dir "no desktop 2\DeepslateWorks") $io4 -Force
  Check "without it: a problem that names the reason" ((@($r5.problems).Count -eq 1) -and ($r5.problems[0].code -eq "other") -and ($r5.problems[0].message -eq "Could not make the shortcuts: Access is denied.") -and $r5.linked)
  $io6 = New-SetupIo "temp run"; $io6.copier = $denied; $io6.temp = $ft
  $tmpScript = Join-Path $ft "deepslate-update\DeepslateWorks.ps1"
  $r6 = Repair-Home $tmpScript (Join-Path $dir "temp run home\DeepslateWorks") $io6 -Force
  Check "copy refused while running from a temporary folder: no link and no shortcuts to it" ((-not $r6.linked) -and (-not [IO.File]::Exists((Join-Path $io6.at "handler.txt"))) -and (-not [IO.File]::Exists((Join-Path $io6.at "Desktop.lnk"))) -and (@($r6.problems | Where-Object { $_.code -eq "link_failed" }).Count -eq 1))
  $io7 = New-SetupIo "fixed later"
  [IO.File]::WriteAllText((Join-Path $io7.at "handler.txt"), "something else")
  $r7 = Repair-Home $dlScript (Join-Path $dir "fixed later home\DeepslateWorks") $io7
  Check "a later run puts right what Setup could not, and says so" ($r7.fixed -and $r7.linked -and (@($r7.problems).Count -eq 0))
  $keepSP = @($script:SetupProblems.ToArray()); $keepSC = $script:SetupChecked
  Set-SetupState $r2
  $j2 = (New-Report "ok") | ConvertTo-Json -Depth 8 -Compress
  Set-SetupState $r7
  $j7 = (New-Report "ok") | ConvertTo-Json -Depth 8 -Compress
  $script:SetupChecked = $false
  $j0 = (New-Report "ok") | ConvertTo-Json -Depth 8 -Compress
  Check "the report lists what was not set up, [] once all is in place, null when it was not looked at" (($j2 -match '"setupProblems":\[\{"part":"copy","code":"copy_denied","message":"Your antivirus') -and ($j7 -match '"setupProblems":\[\]') -and ($j0 -match '"setupProblems":null'))
  $script:SetupProblems.Clear(); foreach ($x in $keepSP) { $script:SetupProblems.Add($x) }; $script:SetupChecked = $keepSC

  Write-Host "Self test: render distance (1.5.4)" -ForegroundColor White
  $od = Join-Path $dir "options [x]"
  [void][IO.Directory]::CreateDirectory($od)
  $of = Join-Path $od "options.txt"
  $r = Set-RenderDistance $of $null 12 8
  Check ("first install: written with the tier's values: " + $r.text) (($r.status -eq "written") -and ($r.ours -eq 12) -and ([IO.File]::ReadAllText($of) -eq "renderDistance:12`r`nsimulationDistance:8`r`nfullscreen:false`r`nchatLinks:true`r`nchatLinksPrompt:true`r`n"))
  $game = "version:3955`r`nautoJump:false`r`nrenderDistance:8`r`nsimulationDistance:6`r`nlang:en_gb`r`nkey_key.jump:key.keyboard.space`r`nlastServer:mc.dsw.test`r`n"
  [IO.File]::WriteAllText($of, $game)
  $r = Set-RenderDistance $of 8 12 8
  Check ("still the value it wrote last time: " + $r.text) (($r.status -eq "changed") -and ($r.ours -eq 12) -and ($r.text -eq ("Render distance 8 {0} 12" -f [char]0x2192)))
  Check "only those two lines changed, everything else as it was" ([IO.File]::ReadAllText($of) -eq $game.Replace("renderDistance:8", "renderDistance:12").Replace("simulationDistance:6", "simulationDistance:8"))
  [IO.File]::WriteAllText($of, $game.Replace("renderDistance:8", "renderDistance:16"))
  $r = Set-RenderDistance $of 8 12 8
  Check ("changed by the player: left alone: " + $r.text) (($r.status -eq "left") -and ($r.ours -eq 8) -and ($r.text -eq "Render distance left at 16 (set by you)") -and ([IO.File]::ReadAllText($of) -eq $game.Replace("renderDistance:8", "renderDistance:16")))
  [IO.File]::WriteAllText($of, $game)
  $r = Set-RenderDistance $of $null 10 8
  Check ("no value in installed.json (installed before 1.5.4): 8 counts as its own: " + $r.text) (($r.status -eq "changed") -and ([IO.File]::ReadAllText($of) -match "(?m)^renderDistance:10\r?$"))
  $r = Set-RenderDistance $of 10 10 8
  Check "already the tier's value: nothing written" (($r.status -eq "same") -and ($r.ours -eq 10))
  $r = Set-RenderDistance $of 8 10 8
  Check "changed on a run that failed before it could remember it: taken as its own, not as the player's" (($r.status -eq "same") -and ($r.ours -eq 10))
  $lf = "renderDistance:8`nfullscreen:false`n"
  [IO.File]::WriteAllText($of, $lf)
  $r = Set-RenderDistance $of $null 12 8
  Check "a file with no simulationDistance line and Unix line endings keeps them, and gets the line" ([IO.File]::ReadAllText($of) -eq "renderDistance:12`nfullscreen:false`nsimulationDistance:8`n")
  [IO.File]::WriteAllText($of, $game)
  $r = Set-RenderDistance $of "banana" 12 8
  Check "nonsense in installed.json counts as 8" ($r.status -eq "changed")

  Write-Host "Self test: visual extras (1.6.0)" -ForegroundColor White
  [IO.File]::WriteAllText($of, $game)
  $r = Set-ResourcePackList $of @("FreshAnimations_v1.10.4.zip") @()
  Check ("no resourcePacks line yet: one is added with vanilla and ours: " + $r.text) (($r.status -eq "changed") -and ([IO.File]::ReadAllText($of) -eq ($game + "resourcePacks:[`"vanilla`",`"file/FreshAnimations_v1.10.4.zip`"]`r`n")))
  $r = Set-ResourcePackList $of @("FreshAnimations_v1.10.4.zip") @("FreshAnimations_v1.10.4.zip")
  Check "already on: nothing written" ($r.status -eq "same")
  $rpMine = $game.Replace("lang:en_gb", "resourcePacks:[`"vanilla`",`"mod_resources`",`"file/My Pack.zip`",`"file/FreshAnimations_v1.10.3.zip`"]`r`nlang:en_gb")
  [IO.File]::WriteAllText($of, $rpMine)
  $r = Set-ResourcePackList $of @("FreshAnimations_v1.10.4.zip") @("FreshAnimations_v1.10.3.zip")
  Check "a new version: the old one out, the new one on top, the player's own pack and the order kept" ([IO.File]::ReadAllText($of) -eq $rpMine.Replace(",`"file/FreshAnimations_v1.10.3.zip`"]", ",`"file/FreshAnimations_v1.10.4.zip`"]"))
  $r = Set-ResourcePackList $of @() @("FreshAnimations_v1.10.4.zip")
  Check ("extras off: ours out, the player's own stays: " + $r.text) (($r.status -eq "changed") -and ([IO.File]::ReadAllText($of) -eq $rpMine.Replace(",`"file/FreshAnimations_v1.10.3.zip`"", "")))
  [IO.File]::WriteAllText($of, $game)
  $r = Set-ResourcePackList $of @() @("FreshAnimations_v1.10.4.zip")
  Check "extras off and no list at all: the file is left as it is" (($r.status -eq "same") -and ([IO.File]::ReadAllText($of) -eq $game))
  [IO.File]::WriteAllText($of, "resourcePacks:not json`n")
  $r = Set-ResourcePackList $of @("FreshAnimations_v1.10.4.zip") @()
  Check "a list it cannot read: left alone" (($r.status -eq "left") -and ([IO.File]::ReadAllText($of) -eq "resourcePacks:not json`n"))
  [IO.File]::WriteAllText($of, "renderDistance:8`nresourcePacks:[]`n")
  $r = Set-ResourcePackList $of @("FA.zip") @()
  Check "an empty list and Unix line endings: ours added, endings kept" ([IO.File]::ReadAllText($of) -eq "renderDistance:8`nresourcePacks:[`"file/FA.zip`"]`n")
  $ip = Join-Path (Join-Path $od "config") "iris.properties"
  Set-IrisShader $ip "ComplementaryReimagined_r5.9.3.zip"
  Check "no iris.properties yet: written with the pack and shaders on" ([IO.File]::ReadAllText($ip) -eq "enableShaders=true`r`nshaderPack=ComplementaryReimagined_r5.9.3.zip`r`n")
  [IO.File]::WriteAllText($ip, "#Iris settings`ncolorSpace=SRGB`nenableShaders=false`nmaxShadowRenderDistance=32`nshaderPack=Mine.zip`n")
  Set-IrisShader $ip "MakeUp-UltraFast-9.5f.zip"
  Check "Iris's own file: the two lines changed, the rest as it was" ([IO.File]::ReadAllText($ip) -eq "#Iris settings`ncolorSpace=SRGB`nenableShaders=true`nmaxShadowRenderDistance=32`nshaderPack=MakeUp-UltraFast-9.5f.zip`n")
  Set-IrisShader $ip ""
  Check "None: shaders off, the pack name left" ([IO.File]::ReadAllText($ip) -eq "#Iris settings`ncolorSpace=SRGB`nenableShaders=false`nmaxShadowRenderDistance=32`nshaderPack=MakeUp-UltraFast-9.5f.zip`n")
  Write-Host "Self test: chat links (1.5.5)" -ForegroundColor White
  Remove-Temp $of
  $null = Set-RenderDistance $of $null 12 8
  Check "first install: chat links on, and the prompt before a link opens" (([IO.File]::ReadAllText($of) -match "(?m)^chatLinks:true\r?$") -and ([IO.File]::ReadAllText($of) -match "(?m)^chatLinksPrompt:true\r?$"))
  Check "and nothing more to do on the next run" ($null -eq (Set-ChatLinks $of))
  $withOff = $game.Replace("lang:en_gb", "chatLinks:false`r`nchatLinksPrompt:false`r`nlang:en_gb")
  [IO.File]::WriteAllText($of, $withOff)
  $said = Set-ChatLinks $of
  Check ("switched off by the player: on again, said in the log: " + $said) (($said -like "Chat links switched on*") -and ([IO.File]::ReadAllText($of) -eq $withOff.Replace("chatLinks:false", "chatLinks:true")))
  Check "only that line: the prompt setting and everything else as it was" ([IO.File]::ReadAllText($of) -match "(?m)^chatLinksPrompt:false\r?$")
  [IO.File]::WriteAllText($of, $game)
  Check "no chatLinks line at all (the game's default is on): left alone" (($null -eq (Set-ChatLinks $of)) -and ([IO.File]::ReadAllText($of) -eq $game))

  Write-Host "Self test: what kind of run it is" -ForegroundColor White
  $prevRun = [pscustomobject]@{ version = "0.1.0+aaaaaaaa"; hash = "aaaa" }
  Check "nothing installed yet: first_install" ((Get-RunMode $null "aaaa") -eq "first_install")
  Check "the pack changed since the last run: update" ((Get-RunMode $prevRun "bbbb") -eq "update")
  Check "everything current: play" ((Get-RunMode $prevRun "aaaa") -eq "play")
  foreach ($m in @("first_install", "update", "play", "already_running")) {
    $Mode = $m
    $rp = New-Report $(if ($m -eq "already_running") { "skipped" } else { "ok" })
    Check ("the report says " + $m) ($rp.mode -eq $m)
  }
  $Mode = "play"
  $rp = New-Report "failed"
  Check "a run that failed is a failed run of its kind" (($rp.mode -eq "play") -and ($rp.outcome -eq "failed"))

  Write-Host "Self test: one copy at a time" -ForegroundColor White
  $pwshExe = (Get-Process -Id $PID).Path
  $scratchRoot = Join-Path $dir "second run"
  [void][IO.Directory]::CreateDirectory($scratchRoot)
  function Invoke-Second {
    $o = Join-Path $dir "second.out"
    $p = Start-Process -FilePath $pwshExe -ArgumentList @("-NoProfile", "-File", ('"{0}"' -f $PSCommandPath), "-DryRun", "-Root", ('"{0}"' -f $scratchRoot)) -Wait -PassThru -NoNewWindow -RedirectStandardOutput $o
    return @{ code = $p.ExitCode; out = [IO.File]::ReadAllText($o) }
  }
  $script:Lock = Enter-Lock
  Check "this run takes the lock" ($null -ne $script:Lock)
  $before = @(Get-ChildItem -LiteralPath $scratchRoot -Recurse -Force).Count
  $r2 = Invoke-Second
  Check ("a second run while it is held says so and leaves (exit " + $r2.code + ")") (($r2.code -eq $ExitAlreadyRunning) -and ($r2.out -match "already running in another window\. Let it finish, then press Play again\."))
  Check "and touches nothing" (@(Get-ChildItem -LiteralPath $scratchRoot -Recurse -Force).Count -eq $before)
  Exit-Lock
  $r3 = Invoke-Second
  Check ("once it is let go the next run goes ahead (exit " + $r3.code + ")") (($r3.code -ne $ExitAlreadyRunning) -and ($r3.out -notmatch "already running"))
  # a copy that takes the lock and ends without letting go of it, as a killed run would
  $held = Join-Path $dir "held.txt"
  $code = ('$m = New-Object System.Threading.Mutex($false, "{0}"); if ($m.WaitOne(0)) {{ [IO.File]::WriteAllText("{1}", "held") }}; exit 0' -f $LockName, $held)
  $p = Start-Process -FilePath $pwshExe -ArgumentList @("-NoProfile", "-EncodedCommand", [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($code))) -Wait -PassThru -NoNewWindow
  $script:Lock = Enter-Lock
  Check "a run that was killed with the lock held does not keep everybody out" (([IO.File]::Exists($held)) -and ($null -ne $script:Lock))
  Exit-Lock

  Write-Host "Self test: the script updates itself" -ForegroundColor White
  Check "1.5.1 is newer than 1.5.0, and 1.10.0 than 1.9.0" ((Test-Newer "1.5.1" "1.5.0") -and (Test-Newer "1.10.0" "1.9.0"))
  $notNewer = @(@("1.5.0", "1.5.0"), @("1.4.9", "1.5.0"), @("banana", "1.5.0"), @("", "1.5.0"), @("9.9.9; calc", "1.5.0"), @("v2.0.0", "1.5.0")) | Where-Object { Test-Newer $_[0] $_[1] }
  Check "the same, an older one and anything that is not a version are not" (@($notNewer).Count -eq 0)
  $ud = Join-Path $dir "update"
  $site = Join-Path $dir "site"
  [void][IO.Directory]::CreateDirectory($ud); [void][IO.Directory]::CreateDirectory($site)
  $mineNow = Join-Path $ud "DeepslateWorks.ps1"
  $oldText = '$InstallerVersion = "' + $InstallerVersion + '"' + "`nWrite-Host old"
  $newText = '$InstallerVersion = "9.9.1"' + "`nWrite-Host new"
  function Reset-Update { Get-ChildItem -LiteralPath $ud -Force | ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force }; [IO.File]::WriteAllText($mineNow, $oldText) }
  function Test-UpdateUntouched { return (([IO.File]::ReadAllText($mineNow) -eq $oldText) -and (@(Get-ChildItem -LiteralPath $ud -Force).Count -eq 1)) }
  function Set-Site([string]$text) { $f = Join-Path $site "DeepslateWorks.ps1"; [IO.File]::WriteAllText($f, $text); return (Get-FileHash -LiteralPath $f -Algorithm SHA256).Hash.ToLower() }
  $script:Asked = 0
  $fromSite = { param($url, $out) $script:Asked++; if ($url -notmatch '/downloads/DeepslateWorks\.ps1$') { throw "asked for $url" }; Copy-Item -LiteralPath (Join-Path $site "DeepslateWorks.ps1") -Destination $out -Force }
  $offline = { param($url, $out) $script:Asked++; [IO.File]::WriteAllText($out, "half"); throw "The remote name could not be resolved" }

  Reset-Update; $sum = Set-Site $newText
  $u = Update-Script @{ version = "9.9.1"; sha256 = $sum } $mineNow $fromSite
  Check "a newer version: fetched from the site's /downloads, checked, put in place" (($u.status -eq "updated") -and ([IO.File]::ReadAllText($mineNow) -eq $newText))
  Check "the script it replaced is kept as .bak, and nothing else is left" (([IO.File]::ReadAllText("$mineNow.bak") -eq $oldText) -and (@(Get-ChildItem -LiteralPath $ud -Force).Count -eq 2))
  Reset-Update; $script:Asked = 0
  $u = Update-Script @{ version = $InstallerVersion; sha256 = $sum } $mineNow $fromSite
  Check "the same version: nothing fetched, nothing replaced" (($u.status -eq "current") -and ($script:Asked -eq 0) -and (Test-UpdateUntouched))
  $u = Update-Script $null $mineNow $fromSite
  Check "a mod list that names no script: nothing happens" (($u.status -eq "current") -and (Test-UpdateUntouched))
  $u = Update-Script @{ version = "9.9.1"; sha256 = $sum } $mineNow $offline
  Check ("the download fails: carried on with this version, nothing replaced, nothing left: " + $u.problem) (($u.status -eq "failed") -and ($u.problem -match "could not be downloaded") -and (Test-UpdateUntouched))
  $u = Update-Script @{ version = "9.9.1"; sha256 = ("0" * 64) } $mineNow $fromSite
  Check ("another checksum: nothing replaced: " + $u.problem) (($u.status -eq "failed") -and (Test-UpdateUntouched))
  $u = Update-Script @{ version = "9.9.1"; sha256 = "" } $mineNow $fromSite
  Check "no checksum from the site: nothing fetched, nothing replaced" (($u.status -eq "failed") -and (Test-UpdateUntouched))
  $sum = Set-Site ('$InstallerVersion = "9.9.2"' + "`nWrite-Host other")
  $u = Update-Script @{ version = "9.9.1"; sha256 = $sum } $mineNow $fromSite
  Check ("a script of another version than the site named: nothing replaced: " + $u.problem) (($u.status -eq "failed") -and (Test-UpdateUntouched))
  $sum = Set-Site ('$InstallerVersion = "9.9.1"' + "`nif ((( {")
  $u = Update-Script @{ version = "9.9.1"; sha256 = $sum } $mineNow $fromSite
  Check ("a script that does not read as PowerShell: nothing replaced: " + $u.problem) (($u.status -eq "failed") -and (Test-UpdateUntouched))
  $man = [pscustomobject]@{ installer = [pscustomobject]@{ version = "9.9.1"; sha256 = ("a" * 64); size = 1; script = [pscustomobject]@{ sha256 = ("b" * 64); size = 1 } } }
  $o = Get-OfferedScript $man
  Check "the mod list's script, not the zip, is what is checked" (($o.version -eq "9.9.1") -and ($o.sha256 -eq ("b" * 64)))
  Check "a mod list from before 1.5.0 offers no script" ($null -eq (Get-OfferedScript ([pscustomobject]@{ installer = [pscustomobject]@{ version = "1.4.3"; sha256 = ("a" * 64); size = 1 } })))
  $script:UpdatedFrom = "1.5.0"; $script:UpdateProblem = $null
  Check "a report from an updated script says which version fetched it" ((New-Report "ok").updatedFrom -eq "1.5.0")
  $script:UpdatedFrom = $null; $script:UpdateProblem = "it could not be downloaded: C:\Users\" + $script:Personal[0] + "\x"
  $rp = New-Report "ok"
  Check ("an update that was not applied is in the report, without the name: " + $rp.updateProblem) (($rp.updatedFrom -eq $null) -and ($rp.updateProblem -like "*C:\Users\~*"))
  $script:UpdateProblem = $null

  Write-Host "Self test: downloads land in mods\ only when complete" -ForegroundColor White
  $gd = Join-Path $dir "game [x]"
  $md = Join-Path $gd "mods"; $stg = Join-Path $gd ".downloading"
  [void][IO.Directory]::CreateDirectory($md)
  [IO.File]::WriteAllText((Join-Path $md "create-6.0.jar"), "old jar")
  $jarBytes = [Text.Encoding]::UTF8.GetBytes("a whole jar")
  $jarSha = [BitConverter]::ToString([System.Security.Cryptography.SHA512]::Create().ComputeHash($jarBytes)).Replace("-", "").ToLower()
  function Get-ModsState { return (@(Get-ChildItem -LiteralPath $md -Force | ForEach-Object { $_.Name + "=" + [IO.File]::ReadAllText($_.FullName) }) -join ";") }
  $was = Get-ModsState
  $killed = { param($url, $out) $b = [Text.Encoding]::UTF8.GetBytes("a who"); [IO.File]::WriteAllBytes($out, $b); throw "the run was killed here" }
  $threw = $false
  try { $null = Save-ModFile "https://cdn.modrinth.com/x.jar" (Join-Path $md "create-6.1.jar") $jarSha $stg $killed } catch { $threw = $true }
  Check "a download cut off half-way leaves mods\ exactly as it was" ($threw -and ((Get-ModsState) -eq $was))
  Check "what was half-downloaded is in .downloading\, not in mods\" ([IO.File]::Exists((Join-Path $stg "create-6.1.jar.part")))
  [IO.File]::WriteAllText((Join-Path $md "old-mod.jar.part"), "from 1.4.x")
  Clear-Leftovers $gd
  Check "the next run clears both kinds of part file first" ((@(Get-ChildItem -LiteralPath $stg -Force).Count -eq 0) -and (-not [IO.File]::Exists((Join-Path $md "old-mod.jar.part"))))
  $wrong = { param($url, $out) [IO.File]::WriteAllText($out, "not what the mod list says") }
  $r = Save-ModFile "https://cdn.modrinth.com/x.jar" (Join-Path $md "create-6.1.jar") $jarSha $stg $wrong
  Check "a download with the wrong checksum never reaches mods\" (($r -eq "wrong") -and ((Get-ModsState) -eq $was) -and (@(Get-ChildItem -LiteralPath $stg -Force).Count -eq 0))
  $whole = { param($url, $out) [IO.File]::WriteAllBytes($out, $jarBytes) }
  $r = Save-ModFile "https://cdn.modrinth.com/x.jar" (Join-Path $md "create-6.1.jar") $jarSha $stg $whole
  Check "a whole, checked download is moved into mods\ in one step" (($r -eq "") -and ([IO.File]::ReadAllText((Join-Path $md "create-6.1.jar")) -eq "a whole jar") -and (@(Get-ChildItem -LiteralPath $stg -Force).Count -eq 0))

  Write-Host "Self test: finding Java" -ForegroundColor White
  # Stand-ins for java that say their version the way java does: on stderr, and nothing on stdout.
  $onWindows = ([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT)
  function New-JavaStub([string]$name, [string[]]$lines) {
    $folder = Join-Path $dir $name
    New-Item -ItemType Directory -Force -Path $folder | Out-Null
    if ($onWindows) {
      $stub = Join-Path $folder "java.cmd"
      $body = "@echo off`r`n" + (($lines | ForEach-Object { "echo " + $_ + " 1>&2" }) -join "`r`n") + "`r`n"
      [IO.File]::WriteAllText($stub, $body, (New-Object Text.ASCIIEncoding))
    } else {
      $stub = Join-Path $folder "java"
      $body = "#!/bin/sh`n" + (($lines | ForEach-Object { "echo '" + $_ + "' 1>&2" }) -join "`n") + "`n"
      [IO.File]::WriteAllText($stub, $body, $utf8)
      & chmod +x $stub
    }
    return $stub
  }
  $java8 = New-JavaStub "java8" @('java version "1.8.0_503"', 'Java(TM) SE Runtime Environment (build 1.8.0_503-b13)')
  $java21 = New-JavaStub "java21" @('java version "21.0.12" 2026-07-21 LTS', 'Java(TM) SE Runtime Environment (build 21.0.12+8-LTS-250)')
  $javaOpts = New-JavaStub "javaopts" @('Picked up JAVA_TOOL_OPTIONS: -Dfile.encoding=UTF-8', 'openjdk version "21.0.4" 2024-07-16 LTS')
  $javaMute = New-JavaStub "javamute" @('Error: could not open jvm.cfg')
  $noJre = Join-Path $dir "no-runtime"
  $jre = Join-Path $dir "runtime"
  $jreBin = Join-Path (Join-Path $jre "jdk-21.0.4+7-jre") "bin"
  New-Item -ItemType Directory -Force -Path $jreBin | Out-Null
  [IO.File]::WriteAllText((Join-Path $jreBin "java.exe"), "stand-in", $utf8)

  $line = $null; $threw = $null
  try { $line = Get-JavaVersionText $java8 } catch { $threw = "$_" }
  Check ("a java that writes only to stderr is read, and nothing is thrown with errors set to stop the script: " + $line) (($ErrorActionPreference -eq "Stop") -and ($threw -eq $null) -and ($line -eq 'java version "1.8.0_503"'))
  Check "1.8.0_503 is Java 8, 21.0.12 is Java 21" (((Get-JavaMajor 'java version "1.8.0_503"') -eq 8) -and ((Get-JavaMajor 'java version "21.0.12" 2026-07-21 LTS') -eq 21) -and ((Get-JavaMajor 'openjdk version "17.0.9" 2023-10-17') -eq 17) -and ((Get-JavaMajor 'openjdk version "25" 2025-09-16') -eq 25))
  Check "what is not a version is no Java at all" (((Get-JavaMajor $null) -eq 0) -and ((Get-JavaMajor "") -eq 0) -and ((Get-JavaMajor "Error: could not open jvm.cfg") -eq 0) -and ((Get-JavaMajor "version 21") -eq 0))
  $s = Select-Java (Join-Path $dir "no-launcher-java.exe") $java8 $noJre
  Check ("Java 8 on PATH: passed over, Java 21 is downloaded (" + $s.passedOver + ")") (($s.path -eq $null) -and ($s.source -eq $null) -and ($s.passedOver -eq 'java version "1.8.0_503"'))
  $s = Select-Java (Join-Path $dir "no-launcher-java.exe") $java21 $noJre
  Check ("Java 21.0.12 on PATH: accepted (" + $s.say + ")") (($s.path -eq $java21) -and ($s.source -eq "on PATH") -and ($s.say -eq "Using Java 21 from PATH") -and ($s.passedOver -eq $null))
  $s = Select-Java (Join-Path $dir "no-launcher-java.exe") $java8 $jre
  Check "Java 8 on PATH and ours from an earlier run: ours, never the one on PATH" (($s.path -like "*jdk-21.0.4+7-jre*java.exe") -and ($s.source -eq "downloaded on an earlier run") -and ($s.passedOver -eq 'java version "1.8.0_503"'))
  $s = Select-Java (Join-Path $dir "no-launcher-java.exe") $javaOpts $noJre
  Check "a first line about JAVA_TOOL_OPTIONS is not taken for the version" (($s.source -eq "on PATH") -and ((Get-JavaVersionText $javaOpts) -eq 'openjdk version "21.0.4" 2024-07-16 LTS'))
  $s = Select-Java (Join-Path $dir "no-launcher-java.exe") $javaMute $noJre
  Check "a java that is broken or says nothing: passed over, Java 21 is downloaded" (($s.path -eq $null) -and ($s.passedOver -eq "a java that did not say its version"))
  $s = Select-Java (Join-Path $dir "no-launcher-java.exe") (Join-Path (Join-Path $dir "gone") "java.exe") $noJre
  Check "a java that PATH names but that is not there: the same" (($s.path -eq $null) -and ((Get-JavaVersionText (Join-Path (Join-Path $dir "gone") "java.exe")) -eq $null))
  $s = Select-Java $java21 $java8 $jre
  Check "the launcher's own Java comes first, and the one on PATH is not even asked" (($s.path -eq $java21) -and ($s.source -eq "the launcher's own") -and ($s.passedOver -eq $null))
  $s = Select-Java (Join-Path $dir "no-launcher-java.exe") "" $noJre
  Check "no Java anywhere: Java 21 is downloaded" (($s.path -eq $null) -and ($s.passedOver -eq $null))
  Write-Host "Self test: a user folder PowerShell would read as a pattern (1.4.2)" -ForegroundColor White
  $odd = Join-Path $dir "Pab [x] PABULU~1"
  [void][IO.Directory]::CreateDirectory($odd)
  $jarOdd = Join-Path $odd "neoforge-21.1.252-installer.jar"
  [IO.File]::WriteAllText($jarOdd, "jar")
  Check "such a folder is found" (Test-Path -LiteralPath $odd)
  Remove-Temp $jarOdd
  Check "a temporary file in it is removed" (-not [IO.File]::Exists($jarOdd))
  $threw = $false
  try { Remove-Temp $jarOdd; Remove-Temp (Join-Path $dir "nothing [here]\x.jar"); Remove-Temp $null } catch { $threw = $true }
  Check "removing what is not there, or cannot be, never stops the run" (-not $threw)
  $pf = Join-Path $odd "launcher_profiles.json"
  [IO.File]::WriteAllText($pf, $defaults, $utf8)
  Set-LauncherProfile $pf "deepslate-works" $entry
  Check "the launcher profile is written and read back in such a folder" ((Test-LauncherProfile $pf "deepslate-works" "neoforge-21.1.252") -eq "")
  $mine = [IO.File]::ReadAllLines($PSCommandPath)
  $st = [Array]::FindIndex($mine, [Predicate[string]]{ param($l) $l -match '^if \(\$SelfTest\) \{' })
  $en = $st + 1
  while ($en -lt $mine.Length -and $mine[$en] -notmatch '^\}') { $en++ }
  $loose = @()
  for ($k = 0; $k -lt $mine.Length; $k++) {
    if ($k -ge $st -and $k -le $en) { continue }   # the self test works on its own scratch files
    $l = $mine[$k]
    if ($l -match '^\s*#') { continue }
    if ($l -match '\b(Test-Path|Remove-Item|Move-Item|Copy-Item|Get-Content|Set-Content|Add-Content|Expand-Archive|Get-ChildItem|Get-FileHash|Resolve-Path)\b(?![^|;{}]*-LiteralPath)' -and $l -notmatch "\[regex\]|'\\b\(Test-Path") { $loose += ($k + 1) }
  }
  Check ("every file operation outside the self test takes its path literally" + $(if ($loose.Count) { ": line(s) " + ($loose -join ", ") } else { "" })) ($loose.Count -eq 0)

  Write-Host "Self test: uninstall" -ForegroundColor White
  # A whole PC in a scratch folder (brackets in the path on purpose): the game folder, vanilla .minecraft with a
  # profile file that has other profiles in it, the script's home, the shortcuts, and "registry" keys as folders.
  function New-Footprint([string]$r) {
    $g = Join-Path $r ".minecraft-deepslate-works"
    foreach ($d in @("mods", "config", "logs", "screenshots", "runtime\jdk-21.0.4+7-jre\bin")) { [void][IO.Directory]::CreateDirectory((Join-Path $g $d)) }
    foreach ($f in @("mods\create.jar", "config\x.toml", "logs\latest.log", "runtime\jdk-21.0.4+7-jre\bin\java.exe", "servers.dat", "installed.json")) { [IO.File]::WriteAllText((Join-Path $g $f), "x") }
    [IO.File]::WriteAllText((Join-Path $g "launcher.json"), '{"token":"t0k"}')
    [IO.File]::WriteAllText((Join-Path $g "screenshots\2026-09-30_10.00.00.png"), "png")
    $m = Join-Path $r ".minecraft"
    foreach ($d in @("saves\World 1", "versions\neoforge-21.1.252", "versions\1.21.1", "runtime\java-runtime-delta")) { [void][IO.Directory]::CreateDirectory((Join-Path $m $d)) }
    foreach ($f in @("options.txt", "saves\World 1\level.dat", "versions\neoforge-21.1.252\neoforge-21.1.252.json", "versions\1.21.1\1.21.1.jar")) { [IO.File]::WriteAllText((Join-Path $m $f), "vanilla") }
    $pf = Join-Path $m "launcher_profiles.json"
    [IO.File]::WriteAllText($pf, $defaults, $utf8)
    Set-LauncherProfile $pf "deepslate-works" $entry
    Remove-Temp "$pf.bak"
    $h = Join-Path $r "LocalAppData\DeepslateWorks"
    $null = Install-Home $PSCommandPath $h
    # 2.0.0: the extras downloaded for the Extras tab, and the app's own two files
    [void][IO.Directory]::CreateDirectory((Join-Path $g "extras\pictures"))
    foreach ($f in @("extras\iris.jar", "extras\fa.zip", "extras\pictures\iris.png")) { [IO.File]::WriteAllText((Join-Path $g $f), "x") }
    foreach ($f in @("consent.json", "extras.json", "extras-manifest.json")) { [IO.File]::WriteAllText((Join-Path $h $f), "{}") }
    foreach ($d in @("Desktop", "Programs", "Pictures")) { [void][IO.Directory]::CreateDirectory((Join-Path $r $d)) }
    foreach ($l in @("Desktop\Deepslate Works.lnk", "Programs\Deepslate Works.lnk", "Programs\Uninstall Deepslate Works.lnk", "Desktop\Somebody else.lnk")) { [IO.File]::WriteAllText((Join-Path $r $l), "lnk") }
    foreach ($k in @("registry\Software\Classes\deepslate\shell\open\command", "registry\Software\Microsoft\Windows\CurrentVersion\Uninstall\DeepslateWorks", "registry\Software\Classes\other")) { [void][IO.Directory]::CreateDirectory((Join-Path $r $k)) }
    return (Get-UninstallTargets $r $h (Join-Path $r "Desktop") (Join-Path $r "Programs") (Join-Path $r "Pictures") (Join-Path $r "registry"))
  }
  function Get-Vanilla([string]$r) {
    $m = Join-Path $r ".minecraft"
    return (@(Get-ChildItem -LiteralPath $m -Recurse -Force -File | Where-Object { $_.Name -ne "launcher_profiles.json" } | ForEach-Object { $_.FullName.Substring($m.Length) + " " + (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash }) -join "`n")
  }
  function Get-OtherProfiles([string]$pf) { $j = Read-Json $pf; return (@($j.profiles.PSObject.Properties | Where-Object { $_.Name -ne "deepslate-works" } | ForEach-Object { $_.Name + "=" + ($_.Value | ConvertTo-Json -Depth 20 -Compress) }) -join "`n") }

  $ur = Join-Path $dir "pc [1]"
  $ut = New-Footprint $ur
  $vanilla = Get-Vanilla $ur
  $otherProfiles = Get-OtherProfiles $ut.profiles
  $calls = New-Object System.Collections.Generic.List[string]
  $portalUp = @{ report = { param($x) $calls.Add("report " + $x) }.GetNewClosure(); revoke = { param($x) $calls.Add("revoke " + $x) }.GetNewClosure() }
  $e = Get-UninstallEntry "C:\Users\x\AppData\Local\DeepslateWorks\DeepslateWorks.ps1" "C:\Users\x\AppData\Roaming\.minecraft-deepslate-works" 1234
  Check "Settings -> Apps: name, version, publisher, size, and Uninstall runs this script with -Uninstall" (($e.DisplayName -eq $PackName) -and ($e.DisplayVersion -eq $InstallerVersion) -and ($e.Publisher -eq "Deepslate Works") -and ($e.EstimatedSize -eq 1234) -and ($e.UninstallString -match 'DeepslateWorks\.ps1" -Uninstall$') -and ($e.UninstallString -match 'powershell\.exe" -NoProfile'))
  Check "the Start Menu's Uninstall Deepslate Works runs the same script with -Uninstall" ((Get-UninstallShortcutSpec "C:\h\DeepslateWorks.ps1").arguments -match '-File "C:\\h\\DeepslateWorks\.ps1" -Uninstall$')
  Check "an installed PC is found as one" (Test-UninstallFootprint $ut)
  $PretendRunning = @("MinecraftLauncher")
  Check "with the Minecraft Launcher open it refuses, and says why" ((Get-UninstallRefusal) -match "Close the Minecraft Launcher")
  $PretendRunning = @()
  Check "with the launcher closed it goes ahead" ($null -eq (Get-UninstallRefusal))
  $res = Invoke-Uninstall $ut "t0k" $portalUp
  Check ("uninstall: nothing went wrong " + ($res.problems -join "; ")) ($res.problems.Count -eq 0)
  Check "the game folder is gone (mods, settings, our Java, logs, the sign-in)" (-not (Test-Path -LiteralPath $ut.gameDir))
  Check "Deepslate Works' own folder in AppData is gone" (-not (Test-Path -LiteralPath $ut.homeDir))
  Check "with it the extras\ folder, consent.json and extras.json (2.0.0)" ((-not (Test-Path -LiteralPath (Join-Path $ut.gameDir "extras"))) -and (-not (Test-Path -LiteralPath (Join-Path $ut.homeDir "consent.json"))) -and (-not (Test-Path -LiteralPath (Join-Path $ut.homeDir "extras.json"))))
  Check "the deepslate:// link and the Settings -> Apps entry are gone, another program's key is not" ((-not (Test-Path -LiteralPath $ut.handlerKey)) -and (-not (Test-Path -LiteralPath $ut.uninstallKey)) -and (Test-Path -LiteralPath (Join-Path $ur "registry\Software\Classes\other")))
  Check "the three shortcuts are gone, somebody else's is not" ((@($ut.shortcuts | Where-Object { Test-Path -LiteralPath $_ }).Count -eq 0) -and (Test-Path -LiteralPath (Join-Path $ur "Desktop\Somebody else.lnk")))
  $pj = Read-Json $ut.profiles
  Check "our launcher profile is gone and it is no longer the one selected" ((-not $pj.profiles.PSObject.Properties["deepslate-works"]) -and (-not ($pj.PSObject.Properties["selectedProfile"] -and $pj.selectedProfile -eq "deepslate-works")))
  Check "the other launcher profiles are exactly as they were" ((Get-OtherProfiles $ut.profiles) -eq $otherProfiles)
  Check "vanilla .minecraft is untouched (worlds, options, versions, NeoForge's shared files), and no backup is left" (((Get-Vanilla $ur) -eq $vanilla) -and (-not (Test-Path -LiteralPath ($ut.profiles + ".deepslate-backup"))))
  Check "the screenshots are in Pictures\Deepslate Works screenshots, and it says so" ((Test-Path -LiteralPath (Join-Path $ut.pictures "2026-09-30_10.00.00.png")) -and (($res.kept -join " ") -match "1 screenshot"))
  Check "the site is told (the report), then this PC's sign-in is revoked, before it is deleted" (($calls -join ",") -eq "report t0k,revoke t0k")
  Check "the list of what was kept names Java and the account" ((($res.kept -join " ") -match "Java") -and (($res.kept -join " ") -match "account"))
  Check "run again: nothing of ours is found" (-not (Test-UninstallFootprint $ut))
  $again = Invoke-Uninstall $ut $null $portalUp
  Check "and a second uninstall removes nothing and has no problems" (($again.removed.Count -eq 0) -and ($again.problems.Count -eq 0))

  $ur2 = Join-Path $dir "pc [2]"
  $ut2 = New-Footprint $ur2
  $offline = @{ report = { param($x) throw "The remote name could not be resolved" }; revoke = { param($x) throw "The remote name could not be resolved" } }
  $res2 = Invoke-Uninstall $ut2 "t0k" $offline
  Check "the site out of reach: it still uninstalls" (($res2.problems.Count -eq 0) -and (-not (Test-Path -LiteralPath $ut2.gameDir)) -and (-not (Test-UninstallFootprint $ut2)))
  Check "and says the sign-in expires by itself" (($res2.removed -join " ") -match "expires by itself")

  $ur3 = Join-Path $dir "pc [3]"
  $ut3 = New-Footprint $ur3
  [IO.File]::WriteAllText($ut3.profiles, "{ this is not json")
  $res3 = Invoke-Uninstall $ut3 $null $portalUp
  Check "a launcher file that cannot be read is left exactly as it was, and it says so" (([IO.File]::ReadAllText($ut3.profiles) -eq "{ this is not json") -and (($res3.problems -join " ") -match "launcher profile"))
  $ur4 = Join-Path $dir "pc [4]"
  $ut4 = New-Footprint $ur4
  $before4 = [IO.File]::ReadAllText($ut4.profiles)
  function Write-Json($path, $obj) { [IO.File]::WriteAllText($path, "{ half"); throw "disk full" }
  $threw = $false; try { $null = Remove-LauncherProfile $ut4.profiles "deepslate-works" } catch { $threw = $true }
  Remove-Item Function:\Write-Json
  Check "a write that fails half-way: the backup is put back and nothing is left over" ($threw -and ([IO.File]::ReadAllText($ut4.profiles) -eq $before4) -and (-not (Test-Path -LiteralPath ($ut4.profiles + ".deepslate-backup"))))

  Write-Host "Self test: wake on Play" -ForegroundColor White
  # a list, not a variable: the stand-ins are closures with a scope of their own, and they add to the same list
  $wakeAsked = New-Object System.Collections.Generic.List[string]
  $answer = { param($json) { param($m) $wakeAsked.Add($m); return ($json | ConvertFrom-Json) }.GetNewClosure() }
  $refuse = { param($code) { param($m) $wakeAsked.Add($m); throw ('{"error":{"code":"' + $code + '","message":"no"}}') }.GetNewClosure() }
  $script:WakeRefused = $null
  Check "a sleeping server: the wake is asked for once, with a POST, and the window says it is waking" (((Request-Wake (& $answer '{"result":"started","wake":{"phase":"waking"}}')) -eq "waking") -and (($wakeAsked -join ",") -eq "POST"))
  Check "a wake already running (somebody else pressed Play): waking, no second start asked for" ((Request-Wake (& $answer '{"result":"already","wake":{"phase":"waking"}}')) -eq "waking")
  Check "a server that is up: nothing to wait for" ((Request-Wake (& $answer '{"result":"awake","wake":{"phase":"idle"}}')) -eq "awake")
  $script:WakeRefused = $null
  Check "switched off: not woken, and later messages say so" (((Request-Wake (& $refuse "off")) -eq "no") -and ($script:WakeRefused -eq "off"))
  $closed = $null; try { throw '{"error":{"code":"server_offline"}}' } catch { $closed = Gate-Message $_ }
  Check ("the mod list then refuses with the reason: " + $closed) ($closed -eq "The server is switched off. Ask Alex in Discord.")
  $script:WakeRefused = $null
  Check "crashed: not woken" (((Request-Wake (& $refuse "crashed")) -eq "no") -and ($script:WakeRefused -eq "crashed"))
  $script:WakeRefused = $null
  Check "the site out of reach: carried on, nothing remembered" (((Request-Wake { param($m) throw "The remote name could not be resolved" }) -eq "no") -and ($null -eq $script:WakeRefused))
  $script:Seq = @("waking", "waking", "ready"); $script:Slept = 0
  $seqCall = { param($m) $p = $script:Seq[0]; if ($script:Seq.Count -gt 1) { $script:Seq = $script:Seq[1..($script:Seq.Count - 1)] }; return @{ wake = @{ phase = $p } } }
  Check "watched after the launcher opens: says Server ready once the site does" (((Watch-Wake $seqCall { param($s) $script:Slept += $s }) -eq "ready") -and ($script:Slept -eq 10))
  $script:Seq = @("waking", "failed")
  Check "a wake that failed says so" ((Watch-Wake $seqCall { param($s) }) -eq "failed")
  Check "stops watching after its time" ((Watch-Wake $seqCall { param($s) } 0) -eq "gave up")
  $script:WakeRefused = $null

  Write-Host "Self test: the app, permissions (2.0.0)" -ForegroundColor White
  $cp = Join-Path $dir "app [x]\consent.json"
  $c = Read-Consent $cp
  $ids = @(Get-ConsentSteps | ForEach-Object { $_.id })
  Check ("the planner's steps, in order: " + ($ids -join ", ")) (($ids -join ",") -eq "signin,launcher,java,neoforge,mods,profile,shortcuts,reports,extras")
  Check "needed to play: all but shortcuts, reports and extras" ((@(Get-ConsentSteps | Where-Object { -not $_.required } | ForEach-Object { $_.id }) -join ",") -eq "shortcuts,reports,extras")
  Check "first run: every step is asked" (@(Get-UnansweredSteps $c).Count -eq 9)
  foreach ($s0 in Get-ConsentSteps) { Set-ConsentAnswer $c $s0.id $(if ($s0.id -eq "reports") { "decline" } else { "allow" }) $s0.top }
  Save-Consent $cp $c
  $c = Read-Consent $cp
  Check "answers are remembered: nothing asked on the next run" (@(Get-UnansweredSteps $c).Count -eq 0)
  Check "a declined optional step stays declined, without asking" ((Get-ConsentDecision $c "reports") -eq "decline")
  $c.Remove("extras"); Save-Consent $cp $c; $c = Read-Consent $cp
  Check "a step new since the last run is the only one asked" ((@(Get-UnansweredSteps $c) | ForEach-Object { $_.id }) -join "," -eq "extras")
  Check "Java allowed on the first run covers a download then" ((Get-ConsentDecision $c "java" 2) -eq "allow")
  Set-ConsentUsed $c "java" 1
  Check "after a run that used the launcher's Java, a download is asked about again (bigger than before)" (((Get-ConsentDecision $c "java" 2) -eq "ask") -and ((Get-ConsentDecision $c "java" 1) -eq "allow"))
  $j = Get-ConsentStep "java"
  Check "the bigger Java question says how big" ($j.bigger -match "45 MB")
  Check "the reports card says what still goes when declined" ((Get-ConsentStep "reports").text -match "pressed Play")
  Set-Content -LiteralPath $cp -Value "{ not json"
  Check "a damaged consent.json: everything is asked again, nothing breaks" (@(Get-UnansweredSteps (Read-Consent $cp)).Count -eq 9)

  Write-Host "Self test: the app, extras (2.0.0)" -ForegroundColor White
  $gd = Join-Path $dir "game [x]"
  $xp = Get-ExtrasPaths $gd
  foreach ($d0 in @($xp.extras, $xp.mods, $xp.resourcepacks, $xp.shaderpacks)) { [void][IO.Directory]::CreateDirectory($d0) }
  $bodies = @{ "iris.jar" = "iris"; "makeup.zip" = "makeup"; "comp.zip" = "comp"; "fa.zip" = "fa"; "emf.jar" = "emf"; "etf.jar" = "etf"; "nea.jar" = "nea" }
  $shaOf = @{}
  foreach ($k in $bodies.Keys) { $f0 = Join-Path $dir "body.tmp"; [IO.File]::WriteAllText($f0, $bodies[$k] * 50); $shaOf[$k] = Get-Sha512 $f0; Remove-Item -LiteralPath $f0 }
  $fx = { param($n, $kind) [pscustomobject]@{ filename = $n; kind = $kind; url = ("https://example.invalid/" + $n); sha512 = $shaOf[$n]; size = 200 } }
  $xm = [pscustomobject]@{ extras = @(
    [pscustomobject]@{ id = "iris"; fps = "High"; shader = $null; requires = @(); files = @((& $fx "iris.jar" "mod")) },
    [pscustomobject]@{ id = "shader-light"; fps = "Medium"; shader = "light"; requires = @("iris"); files = @((& $fx "makeup.zip" "shader")) },
    [pscustomobject]@{ id = "shader-full"; fps = "High"; shader = "full"; requires = @("iris"); files = @((& $fx "comp.zip" "shader")) },
    [pscustomobject]@{ id = "fresh-animations"; fps = "Medium"; shader = $null; requires = @(); files = @((& $fx "fa.zip" "resourcepack"), (& $fx "emf.jar" "mod"), (& $fx "etf.jar" "mod")) },
    [pscustomobject]@{ id = "nea"; fps = "Low"; shader = $null; requires = @(); files = @((& $fx "nea.jar" "mod")) }
  ) }
  $fetchX = { param($url, $out) $n = Split-Path -Leaf ([uri]$url).AbsolutePath; [IO.File]::WriteAllText($out, $bodies[$n] * 50) }
  [IO.File]::WriteAllText((Join-Path $xp.mods "create.jar"), "pack"); [IO.File]::WriteAllText((Join-Path $xp.mods "sodium.jar"), "pack")
  [IO.File]::WriteAllText($xp.options, "renderDistance:10`r`nresourcePacks:[`"vanilla`",`"file/Mine.zip`"]`r`n")
  $snap = { param($d0) (@(Get-ChildItem -LiteralPath $d0 -File | Sort-Object Name | ForEach-Object { $_.Name + "=" + (Get-Sha512 $_.FullName) }) -join ";") }
  $modsBefore = & $snap $xp.mods; $optBefore = [IO.File]::ReadAllText($xp.options)
  $st = New-ExtrasState
  $r = Sync-ExtrasFiles $xp $xm $st $fetchX
  Check ("first download: every extra into extras\, nothing switched on, mods\ untouched: " + $r.downloaded) (($r.downloaded -eq 7) -and (@(Get-ChildItem -LiteralPath $xp.extras -File).Count -eq 7) -and ((& $snap $xp.mods) -eq $modsBefore))
  Check "and again: nothing downloaded twice" ((Sync-ExtrasFiles $xp $xm $st { param($u, $o) throw "no" }).downloaded -eq 0)
  Check "nothing switched: Apply has nothing to do" ((Get-ApplyRoute $false (Test-ExtrasChanged $xm $st)) -eq "nothing")
  $st.choices["iris"] = $true; $st.choices["fresh-animations"] = $true; $st.shader = "full"
  Check "the game running: Restart the game to apply? is asked" ((Get-ApplyRoute $true (Test-ExtrasChanged $xm $st)) -eq "ask_restart")
  Check "the game not running: applied straight away" ((Get-ApplyRoute $false (Test-ExtrasChanged $xm $st)) -eq "apply")
  $r = Invoke-ExtrasApply $xp $xm $st
  Check ("on: Iris, Fresh Animations with EMF and ETF, the Full shader pack in place: " + $r.error) ($r.ok -and [IO.File]::Exists((Join-Path $xp.mods "iris.jar")) -and [IO.File]::Exists((Join-Path $xp.mods "emf.jar")) -and [IO.File]::Exists((Join-Path $xp.mods "etf.jar")) -and [IO.File]::Exists((Join-Path $xp.resourcepacks "fa.zip")) -and [IO.File]::Exists((Join-Path $xp.shaderpacks "comp.zip")) -and -not [IO.File]::Exists((Join-Path $xp.shaderpacks "makeup.zip")) -and -not [IO.File]::Exists((Join-Path $xp.mods "nea.jar")))
  Check "Fresh Animations switched on in options.txt, the player's own pack kept" ([IO.File]::ReadAllText($xp.options) -match 'resourcePacks:\["vanilla","file/Mine.zip","file/fa.zip"\]')
  Check "Iris set to the chosen shader pack" ([IO.File]::ReadAllText($xp.iris) -match "(?m)^shaderPack=comp.zip" -and [IO.File]::ReadAllText($xp.iris) -match "(?m)^enableShaders=true")
  Check "dependencies on together: Light is chosen only with Iris" (((Get-ExtrasOn $xm @{ choices = @{}; shader = "light" }) -join ",") -eq "")
  $st.shader = "light"
  $r = Invoke-ExtrasApply $xp $xm $st
  Check "Full to Light: one shader pack out, the other in" ($r.ok -and [IO.File]::Exists((Join-Path $xp.shaderpacks "makeup.zip")) -and -not [IO.File]::Exists((Join-Path $xp.shaderpacks "comp.zip")) -and [IO.File]::Exists((Join-Path $xp.extras "comp.zip")))
  $st.choices = @{}; $st.shader = "none"
  $r = Invoke-ExtrasApply $xp $xm $st
  Check "all off again: mods\ exactly as before (names and contents), options.txt's list as before" ($r.ok -and ((& $snap $xp.mods) -eq $modsBefore) -and ([IO.File]::ReadAllText($xp.options) -eq $optBefore))
  Check "and every extra is back in extras\" (@(Get-ChildItem -LiteralPath $xp.extras -File).Count -eq 7)
  $st.choices["iris"] = $true; $st.choices["fresh-animations"] = $true; $st.choices["nea"] = $true; $st.shader = "full"
  $n0 = 0
  $badMove = @{ move = { param($a, $b) $script:MoveCount++; if ($script:MoveCount -ge 4) { throw "disk full" }; Move-ExtraFile $a $b } }
  $script:MoveCount = 0
  $r = Invoke-ExtrasApply $xp $xm $st $badMove
  Check ("a move that fails half-way: everything put back (" + $r.error + ")") ((-not $r.ok) -and ((& $snap $xp.mods) -eq $modsBefore) -and (@(Get-ChildItem -LiteralPath $xp.extras -File).Count -eq 7) -and ([IO.File]::ReadAllText($xp.options) -eq $optBefore) -and (@($st.applied.mods).Count -eq 0))
  [IO.File]::WriteAllText((Join-Path $xp.extras "nea.jar"), "damaged")
  $r = Invoke-ExtrasApply $xp $xm $st
  Check ("a damaged file found by the check after the moves: everything put back (" + $r.error + ")") ((-not $r.ok) -and ((& $snap $xp.mods) -eq $modsBefore) -and ([IO.File]::ReadAllText($xp.options) -eq $optBefore))
  Remove-Item -LiteralPath (Join-Path $xp.extras "nea.jar")
  $r = Invoke-ExtrasApply $xp $xm $st
  Check "an extra not downloaded yet: refused, nothing changed" ((-not $r.ok) -and ($r.error -match "not downloaded") -and ((& $snap $xp.mods) -eq $modsBefore))
  $r2 = Sync-ExtrasFiles $xp $xm $st $fetchX
  Check "the next Play fetches what is missing and applies the choice that was waiting" ($r2.applied.ok -and [IO.File]::Exists((Join-Path $xp.mods "nea.jar")) -and [IO.File]::Exists((Join-Path $xp.mods "iris.jar")))
  Check "the pack's mod sync leaves switched-on extras alone" ((@(Get-AppliedExtraJars $st) | Sort-Object) -join "," -eq "emf.jar,etf.jar,iris.jar,nea.jar")
  # a new version of an extra that is on
  $bodies["iris2.jar"] = "iris two"; $f0 = Join-Path $dir "body.tmp"; [IO.File]::WriteAllText($f0, $bodies["iris2.jar"] * 50); $shaOf["iris2.jar"] = Get-Sha512 $f0; Remove-Item -LiteralPath $f0
  $xm.extras[0].files = @((& $fx "iris2.jar" "mod"))
  $r3 = Sync-ExtrasFiles $xp $xm $st $fetchX
  Check "a new version of an extra that is on: swapped in mods\, the old file gone everywhere" ($r3.applied.ok -and [IO.File]::Exists((Join-Path $xp.mods "iris2.jar")) -and -not [IO.File]::Exists((Join-Path $xp.mods "iris.jar")) -and -not [IO.File]::Exists((Join-Path $xp.extras "iris.jar")))
  $sp0 = Join-Path $dir "app [x]\extras.json"
  Save-ExtrasState $sp0 $st
  $st2 = Read-ExtrasState $sp0
  Check "extras.json remembers the choices and where the files are" ($st2.choices["nea"] -and $st2.shader -eq "full" -and (@($st2.applied.mods) -contains "nea.jar"))

  Write-Host "Self test: the app, the game and the PC (2.0.0)" -ForegroundColor White
  $procs = @(
    [pscustomobject]@{ Id = 11; Name = "javaw.exe"; CommandLine = '"C:\Program Files\Java\bin\javaw.exe" -Xmx6G -Dminecraft.client.jar=... --gameDir C:\Users\x\AppData\Roaming\.minecraft-deepslate-works --username y' },
    [pscustomobject]@{ Id = 12; Name = "javaw.exe"; CommandLine = '"javaw.exe" --gameDir C:\Users\x\AppData\Roaming\.minecraft' },
    [pscustomobject]@{ Id = 13; Name = "chrome.exe"; CommandLine = 'chrome.exe .minecraft-deepslate-works' }
  )
  Check "finds the Deepslate game, not another Minecraft and not a browser" ((@(Find-GameProcess "C:\Users\x\AppData\Roaming\.minecraft-deepslate-works" $procs) | ForEach-Object { $_.Id }) -join "," -eq "11")
  Check "no game running: no restart question" ((Get-ApplyRoute ((@(Find-GameProcess "C:\none" $procs)).Count -gt 0) $true) -eq "apply")
  Check "weak: 4 GB with a real card" (Test-WeakPc 4 @("NVIDIA GeForce RTX 3060"))
  Check "weak: 16 GB with built-in Intel graphics" (Test-WeakPc 16 @("Intel(R) UHD Graphics 620"))
  Check "not weak: 16 GB and an RTX 3060" (-not (Test-WeakPc 16 @("Intel(R) UHD Graphics 770", "NVIDIA GeForce RTX 3060")))
  Check "not weak: 16 GB and a Radeon RX 6600" (-not (Test-WeakPc 16 @("AMD Radeon RX 6600")))
  Check "weak: memory known, no graphics card seen" (Test-WeakPc 16 @())

  Write-Host "Self test: the window's layout (2.0.0)" -ForegroundColor White
  $okXaml = $true; $names = @()
  try { $x1 = [xml]$AppXaml; $x2 = [xml]$RestartXaml; $names = @($x1.SelectNodes("//*[@*[local-name()='Name']]") | ForEach-Object { $_.GetAttribute("Name", "http://schemas.microsoft.com/winfx/2006/xaml") }) } catch { $okXaml = $false }
  Check "both windows' XAML is well-formed" $okXaml
  $want = @("Tabs", "PlayTab", "ExtrasTab", "LogTab", "PlayTitle", "PlayStatus", "PlayChanged", "ReviewLink", "PlayButton", "PlayBody", "ApplyButton", "ExtrasStatus", "ExtrasBody", "LogBox")
  Check ("every name the code looks up is in the XAML") (@($want | Where-Object { $names -notcontains $_ }).Count -eq 0)
  Check "the window is titled Deepslate Works with Play, Extras and Log tabs" (($AppXaml -match 'Title="Deepslate Works"') -and ($AppXaml -match 'Header="  Play  "') -and ($AppXaml -match 'Header="  Extras  "') -and ($AppXaml -match 'Header="  Log  "'))
  Check "the restart prompt offers Restart now and Later" (($RestartXaml -match 'Content="Restart now"') -and ($RestartXaml -match 'Content="Later"'))

  $own = [IO.File]::ReadAllText($PSCommandPath)
  $left = @([regex]::Matches($own, '(?m)^(?!\s*#)(?!.*\[regex\]).*&\s+\$[\w.:]+[^\r\n|]*2>&1')).Count
  Check "no command's stderr is sent through 2>&1 anywhere in this script" ($left -eq 0)

  Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
  if ($script:SelfTestBad -gt 0) { Write-Host ("{0} check(s) failed" -f $script:SelfTestBad) -ForegroundColor Red; exit 1 }
  Write-Host "All checks passed." -ForegroundColor Green
  exit 0
}

Write-Host ("{0} {1}" -f $PackName, $InstallerVersion) -ForegroundColor White
$script:CustomRoot = ($Root -ne "")   # a test run: nothing is copied, registered or linked
if ($Root -eq "") { $Root = $env:APPDATA }
$OnWindows = ($env:OS -eq "Windows_NT")

# ---- -Uninstall: Settings -> Apps, or "Uninstall Deepslate Works" in the Start Menu ------------------------
if ($Uninstall) {
  $Mode = "uninstall"
  $Quiet = $false
  if ($script:CustomRoot -or -not $OnWindows) {
    # a test run keeps everything, the "registry" too, inside -Root
    $t = Get-UninstallTargets $Root (Join-Path $Root "LocalAppData\DeepslateWorks") (Join-Path $Root "Desktop") (Join-Path $Root "Programs") (Join-Path $Root "Pictures") (Join-Path $Root "registry")
  } else {
    $t = Get-UninstallTargets $Root (Get-HomeDir) ([Environment]::GetFolderPath("Desktop")) ([Environment]::GetFolderPath("Programs")) ([Environment]::GetFolderPath("MyPictures")) "HKCU:"
  }
  Log ("=== {0} {1} uninstall start ===" -f $PackName, $InstallerVersion)
  $script:Lock = Enter-Lock
  if (-not $script:Lock) {
    Write-Host ""
    Write-Host "Deepslate Works is already running in another window. Let it finish, then run the uninstall again." -ForegroundColor Yellow
    Hold-Window
    exit $ExitAlreadyRunning
  }
  $no = Get-UninstallRefusal
  if ($no) { Write-Host ""; Write-Host $no -ForegroundColor Yellow; Log "uninstall refused: the launcher is open"; Exit-Lock; Hold-Window; exit 1 }
  if (-not (Test-UninstallFootprint $t)) {
    Write-Host ""
    Write-Host "Deepslate Works isn't on this PC. There is nothing to remove." -ForegroundColor Green
    Exit-Lock; Hold-Window; exit 0
  }
  if (-not $Yes) {
    Write-Host ""
    Write-Host "Remove Deepslate Works from this PC? Your worlds on the server are safe; this only removes the mods and files on this computer." -ForegroundColor White
    $answer = ""
    try { $answer = [string](Read-Host "Type Y and press Enter to remove it, or just press Enter to keep it") } catch {}
    if ($answer -notmatch '^\s*y(es)?\s*$') { Write-Host "Nothing was removed." -ForegroundColor Green; Log "uninstall: the answer was no"; Exit-Lock; Hold-Window; exit 0 }
  }
  $tok = $null
  $tf = Join-Path $t.gameDir "launcher.json"
  if (Test-Path -LiteralPath $tf) { try { $tok = (Get-Content -LiteralPath $tf -Raw | ConvertFrom-Json).token } catch {} }
  $portal = @{
    report = { param($token) $script:Token = $token; $script:Reported = $false; Send-Report "ok" }
    revoke = { param($token) Invoke-RestMethod -Uri "$PortalUrl/api/launcher/revoke" -Method Post -Headers @{ Authorization = "Bearer $token" } -UseBasicParsing -TimeoutSec 15 }
  }
  $r = Invoke-Uninstall $t $tok $portal
  $script:Reported = $true
  Write-Host ""
  if ($r.removed.Count -gt 0) { Write-Host "Removed:" -ForegroundColor Green; foreach ($x in $r.removed) { Write-Host ("   - {0}" -f $x) } }
  Write-Host "Kept:" -ForegroundColor Gray
  foreach ($x in $r.kept) { Write-Host ("   - {0}" -f $x) -ForegroundColor Gray }
  if ($r.problems.Count -gt 0) { Write-Host "Not done:" -ForegroundColor Yellow; foreach ($x in $r.problems) { Write-Host ("   - {0}" -f $x) -ForegroundColor Yellow } }
  Write-Host ""
  if ($r.problems.Count -eq 0) { Write-Host "Deepslate Works is off this PC. To play again, download it from the site and run Setup.bat." -ForegroundColor Green }
  else { Write-Host "Most of it is gone. Close Minecraft and run the uninstall again for the rest." -ForegroundColor Yellow }
  Log ("uninstall done: {0} removed, {1} problems" -f $r.removed.Count, $r.problems.Count)
  Exit-Lock
  if ($r.problems.Count -eq 0 -and -not $script:CustomRoot) { Remove-Temp $LogFile }   # the last trace: this run's log
  Hold-Window
  exit $(if ($r.problems.Count -eq 0) { 0 } else { 1 })
}

# ---- Setup.bat: put the script in its home, then run that copy in this window --------------------------
if ($Setup) {
  $me = (Resolve-Path -LiteralPath $PSCommandPath).Path
  $target = $me
  $dir = Get-HomeDir
  # Started from inside the zip: nothing is copied or registered from a folder Windows will empty (1.5.6).
  if (Test-InsideZip $me $Temp) {
    $why = "Setup.bat was started from inside the zip. Right-click the zip, choose Extract All, then run Setup.bat from the new folder."
    Write-Host ""
    Write-Host $why -ForegroundColor Yellow
    $p = New-Object System.Collections.Generic.List[object]
    Add-SetupProblem $p "setup" "in_zip" $why
    foreach ($x in $p) { $script:SetupProblems.Add($x) }
    $script:SetupChecked = $true
    $script:StepName = "Setup"
    $tf = Join-Path (Join-Path $Root ".minecraft-deepslate-works") "launcher.json"
    if (-not $script:CustomRoot -and [IO.File]::Exists($tf)) { try { $script:Token = (Get-Content -LiteralPath $tf -Raw | ConvertFrom-Json).token } catch {} }
    Send-Report "failed"
    exit 2
  }
  if (-not $DryRun -and -not $script:CustomRoot -and $OnWindows -and $dir) {
    # 2.0.0: the Play link and the shortcuts wait for their permission (the app's "Shortcuts and Play button" card)
    $r = Repair-Home $me $dir (Get-WindowsHomeIo (Join-Path $Root ".minecraft-deepslate-works")) -Force -NoLinks
    foreach ($line in $r.said) {
      $colour = @{ ok = "DarkGray"; note = "Gray"; problem = "Yellow" }[$line.tone]
      Write-Host ("  " + $line.text) -ForegroundColor $colour
    }
    $target = $r.script
    if (@($r.problems).Count -gt 0) { $env:DEEPSLATE_SETUP_PROBLEMS = (ConvertTo-Json -InputObject @($r.problems) -Compress -Depth 4) }
    else { $env:DEEPSLATE_SETUP_PROBLEMS = "[]" }
  }
  $env:DEEPSLATE_FROM_SETUP = "1"
  if ($OnWindows -and -not $DryRun -and -not $script:CustomRoot) {
    # 2.0.0: the app's window, on its own; this console (Setup.bat's) closes
    Start-Process -FilePath (Get-PowerShellExe) -ArgumentList @("-NoProfile", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-File", ('"{0}"' -f $target)) -WindowStyle Hidden
    Write-Host "Deepslate Works is opening in its own window." -ForegroundColor Green
    exit 0
  }
  $again = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ('"{0}"' -f $target), "-Console")
  if ($DryRun) { $again += "-DryRun" }
  if ($script:CustomRoot) { $again += @("-Root", ('"{0}"' -f $Root)) }
  $child = Start-Process -FilePath ((Get-Process -Id $PID).Path) -ArgumentList $again -Wait -PassThru -NoNewWindow
  exit $child.ExitCode
}

$DataDir = Join-Path $Root ".minecraft-deepslate-works"   # the game folder (the mod list's profile.dir; it has always been this)
$tokenFile = Join-Path $DataDir "launcher.json"
function Read-Token {
  $t = $null
  if (Test-Path -LiteralPath $tokenFile) { try { $t = (Get-Content -LiteralPath $tokenFile -Raw | ConvertFrom-Json).token } catch {} }
  if ($DryRun -and $env:DEEPSLATE_LAUNCHER_TOKEN) { $t = $env:DEEPSLATE_LAUNCHER_TOKEN }   # tests under pwsh on Linux
  return $t
}

# ---- 2.0.0: the window ------------------------------------------------------------------------------------
# Every ordinary start on Windows (the Play button, the shortcut, Setup) opens the app's window; the window starts this
# script again as -Engine for the install steps. Tests, -Console and a PC where WPF will not start run the steps here.
$AppHome = $(if ($script:CustomRoot -or -not (Get-HomeDir)) { Join-Path $Root "LocalAppData\DeepslateWorks" } else { Get-HomeDir })
$script:MePath = $PSCommandPath
if ($OnWindows -and -not $Engine -and -not $Console -and -not $DryRun -and -not $script:CustomRoot -and @($PretendRunning).Count -eq 0) {
  if ([Threading.Thread]::CurrentThread.ApartmentState -ne "STA") {
    # WPF needs a single-threaded apartment: Windows PowerShell gives one, pwsh does not
    Start-Process -FilePath (Get-PowerShellExe) -ArgumentList @("-NoProfile", "-Sta", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-File", ('"{0}"' -f $PSCommandPath)) -WindowStyle Hidden
    exit 0
  }
  try {
    if ($Screenshots) { Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase; Show-App $Screenshots; exit 0 }
    Start-AppWindow
    exit 0
  } catch {
    Log ("the window could not open, running in the console: " + ($_ | Out-String))
    Write-Host ("The Deepslate Works window could not open ({0}). Carrying on here." -f $_.Exception.Message) -ForegroundColor Yellow
    $Console = $true
  }
}

# ---- a. the lock ----------------------------------------------------------------------------------------
$script:Lock = Enter-Lock
if (-not $script:Lock) {
  $Mode = "already_running"
  Write-Host ""
  Write-Host "Deepslate Works is already running in another window. Let it finish, then press Play again." -ForegroundColor Yellow
  Log "another copy holds the lock: nothing was touched"
  $script:Token = Read-Token
  Send-Report "skipped"
  Hold-Window
  exit $ExitAlreadyRunning
}

$installedFile = Join-Path $DataDir "installed.json"
$prev = $null
if (Test-Path -LiteralPath $installedFile) { try { $prev = Get-Content -LiteralPath $installedFile -Raw | ConvertFrom-Json } catch {} }
$Mode = Get-RunMode $prev ""
if ($Mode -eq "first_install") { $Quiet = $false }
Log ("=== {0} {1} ({2}) start, {3} ===" -f $PackName, $InstallerVersion, $PackVersion, $Mode)
if ($script:UpdatedFrom) {
  Write-Host ("Updated to {0}" -f $InstallerVersion) -ForegroundColor Green
  Log ("STEP Updating Deepslate Works {0} {1} {2}" -f $script:UpdatedFrom, [char]0x2192, $InstallerVersion)
  Log ("OK {0} fetched, checked and started by {1}" -f $InstallerVersion, $script:UpdatedFrom)
}
if ($FromOldUpdater) { Log "started by an older installer's update step (its -Play / -NoPrompt are taken and ignored)" }

# ---- the first run under 1.4.x's name (1.5.3) -------------------------------------------------------------
# 1.4.x's update step puts this script in %LOCALAPPDATA%\DeepslateWorks\install.ps1 and starts it there, with the Play
# link still naming install.ps1. Before anything else, this run moves the home into the one-script layout: the copy
# as DeepslateWorks.ps1, the link and the shortcuts pointing at it, the Settings -> Apps entry; then the old files go.
# DEEPSLATE_SELFTEST_HOME (set by -SelfTest for the copy it starts; a link cannot set it) does the same against files
# in that folder in place of the registry and the shortcuts, says what it found, and ends the run there.
$SelfTestHome = [string]$env:DEEPSLATE_SELFTEST_HOME
$script:MePath = $PSCommandPath   # this script; after the move below, the DeepslateWorks.ps1 it was moved to
$UnderOldName = $PSCommandPath -and (Get-HomeDir) -and ((Split-Path -Leaf $PSCommandPath) -eq "install.ps1") -and ((Split-Path -Parent (Resolve-Path -LiteralPath $PSCommandPath).Path) -eq (Get-HomeDir))
if ($UnderOldName -and ($SelfTestHome -or (-not $DryRun -and -not $script:CustomRoot -and $OnWindows))) {
  $io = if ($SelfTestHome) { Get-FileHomeIo $SelfTestHome } else { Get-WindowsHomeIo $DataDir }
  try {
    $moved = Repair-Home (Resolve-Path -LiteralPath $PSCommandPath).Path (Get-HomeDir) $io
    Set-SetupState $moved
    Log ("moved to the one-script layout: {0}, Play link {1}" -f $moved.script, $(if ($moved.linked) { "points at it" } else { "NOT set" }))
    if (Test-Path -LiteralPath $moved.script) { $script:MePath = $moved.script }
  } catch { Log ("could not move to the one-script layout: " + $_.Exception.Message) }
  if ($SelfTestHome) {
    $rp = New-Report "ok"
    Write-Host ("home: " + (@(Get-ChildItem -LiteralPath (Get-HomeDir) -Force | ForEach-Object { $_.Name } | Sort-Object) -join ","))
    Write-Host ("handler: " + (& $io.handler))
    Write-Host ("shortcuts: " + (& $io.shortcutsThere) + "; apps: " + (& $io.listed (Join-Path (Get-HomeDir) $ScriptName)))
    Write-Host ("report: installer={0} updatedFrom={1}" -f $rp.installerVersion, $rp.updatedFrom)
    Write-Host ("update step: " + $(if ($script:UpdatedFrom) { "not again in this run" } else { "would run" }))
    Write-Host ("log: " + (($script:RunLog.ToArray()) -join " / "))
    Exit-Lock
    exit 0
  }
}
# What Setup.bat found, when it started this run (1.5.6): in the log and the report, until this run's own check.
if ($FromSetup -and $env:DEEPSLATE_SETUP_PROBLEMS) {
  try {
    $script:SetupChecked = $true
    foreach ($x in @($env:DEEPSLATE_SETUP_PROBLEMS | ConvertFrom-Json)) {
      if ([string]$x.part -notmatch '^(copy|link|shortcuts|apps|setup)$' -or [string]$x.code -notmatch '^(in_zip|copy_denied|link_failed|shortcut_blocked|other)$') { continue }
      $m = [string]$x.message; $m = $m.Substring(0, [Math]::Min(500, $m.Length))
      $script:SetupProblems.Add([ordered]@{ part = [string]$x.part; code = [string]$x.code; message = $m })
      Log ("Setup said: {0} {1}: {2}" -f $x.part, $x.code, $m)
    }
  } catch { Log ("could not read what Setup found: " + $_.Exception.Message) }
}
$Minecraft = Join-Path $Root ".minecraft"
$Profiles = Join-Path $Minecraft "launcher_profiles.json"
# 2.0.0: what this PC's person allowed (the window asked); extras chosen in the Extras tab
$script:Consent = Read-Consent (Join-Path $AppHome $ConsentFileName)
$ExtrasStatePath = Join-Path $AppHome $ExtrasStateName
$script:ExtrasState = Read-ExtrasState $ExtrasStatePath
$script:ReportsOff = -not (Request-Consent "reports")
if ($script:ReportsOff) { Log "install reports are switched off: only 'pressed Play' and the pack version are sent" }

try {
  Clear-Leftovers $DataDir

  # ---- b. what the site has, and this script brought up to date --------------------------------------
  $token = Read-Token
  $headers = @{}
  $manifest = $null
  $wakeCall = { param($m) Invoke-RestMethod -Uri $WakeUrl -Method $m -Headers $headers -UseBasicParsing -TimeoutSec 15 }
  function Get-Manifest {
    try { return (Invoke-RestMethod -Uri $ManifestUrl -Headers $headers -UseBasicParsing -TimeoutSec 60) }
    catch {
      $code = 0; try { $code = [int]$_.Exception.Response.StatusCode } catch {}
      if ($code -eq 401) { return "unauthorized" }
      if ($code -eq 403) { Fail (Gate-Message $_) }
      Fail ("Couldn't reach {0}. Check your internet, or ask Alex if the site is down." -f $PortalUrl)
    }
  }
  if ($token) {
    $headers = @{ Authorization = "Bearer $token" }
    if (-not $DryRun) { $script:Waking = ((Request-Wake $wakeCall) -eq "waking") }
    Step "Checking for updates"
    $manifest = Get-Manifest
    if ($manifest -eq "unauthorized") { $manifest = $null; $token = $null; Note "Your sign-in expired; signing in again" }
    else { Tick "Signed in" }
  }

  # ---- c. sign in, only when not signed in --------------------------------------------------------------
  if (-not $token) {
    $null = Request-Consent "signin"
    Step "Signing in"
    if ($DryRun) { Note "(dry run) would open the browser to sign in"; Fail "(dry run) not signed in; the mod list needs a sign-in" }
    try { $start = Invoke-RestMethod -Uri "$PortalUrl/api/launcher/start" -Method Post -ContentType "application/json" -Body (@{ hostname = $env:COMPUTERNAME } | ConvertTo-Json) -UseBasicParsing -TimeoutSec 30 }
    catch { Fail ("Couldn't reach {0}. Check your internet, or ask Alex if the site is down." -f $PortalUrl) }
    Write-Host ("   Your code is  {0}  - a browser window is opening. Sign in with Discord and press 'Yes, that's me'." -f $start.code) -ForegroundColor Yellow
    Write-Host ("   If nothing opens, go to {0}" -f $start.url) -ForegroundColor Gray
    Start-Process $start.url
    $deadline = (Get-Date).AddSeconds([int]$start.expiresInSec)
    while ((Get-Date) -lt $deadline) {
      Start-Sleep -Seconds ([int]$start.pollEverySec)
      try { $poll = Invoke-RestMethod -Uri ("{0}/api/launcher/poll?token={1}" -f $PortalUrl, $start.pollToken) -UseBasicParsing -TimeoutSec 30 } catch { continue }
      if ($poll.status -eq "approved" -and $poll.launcherToken) { $token = $poll.launcherToken; break }
      if ($poll.status -eq "denied") { Fail "Sign-in was denied in the browser." }
      if ($poll.status -eq "expired") { Fail "The sign-in code expired. Press Play again." }
    }
    if (-not $token) { Fail "Timed out waiting for the browser sign-in. Press Play again." }
    New-Item -ItemType Directory -Force -Path (Split-Path $tokenFile) | Out-Null
    @{ token = $token; savedAt = (Get-Date).ToString("s") } | ConvertTo-Json | Set-Content -LiteralPath $tokenFile
    $headers = @{ Authorization = "Bearer $token" }
    Tick ("Signed in as {0}" -f $poll.displayName)
    if (-not $script:Waking) { $script:Waking = ((Request-Wake $wakeCall) -eq "waking") }
    $manifest = Get-Manifest
    if ($manifest -eq "unauthorized") { Fail "The site did not take the new sign-in. Press Play again." }
  }
  $script:Token = $token
  if ($manifest.version) { $script:PackSeen = [string]$manifest.version }

  # A newer script on the site: fetched, checked, put in place and started with what this one was started with.
  if (-not $script:UpdatedFrom -and -not $DryRun -and $script:MePath -and @($PretendRunning).Count -eq 0) {
    $offer = Get-OfferedScript $manifest
    if ($offer -and (Test-Newer $offer.version $InstallerVersion)) {
      Step ("Updating Deepslate Works {0} {1} {2}" -f $InstallerVersion, [char]0x2192, $offer.version)
      $u = Update-Script $offer $script:MePath { param($url, $out) Invoke-WebRequest -Uri $url -Headers $headers -OutFile $out -UseBasicParsing -TimeoutSec 120 }
      if ($u.status -eq "updated") {
        Log ("OK {0} is in place; starting it" -f $u.version)
        $script:Reported = $true   # the report is the new script's to send
        Exit-Lock
        $env:DEEPSLATE_UPDATED_FROM = $InstallerVersion
        $again = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ('"{0}"' -f $script:MePath))
        if ($FromLink) { $again += $Link }
        elseif ($script:CustomRoot) { $again += @("-Root", ('"{0}"' -f $Root)) }
        # the window's engine stays the engine: same status file, no second window
        if ($Engine) { $again += @("-Engine", "-StatusFile", ('"{0}"' -f $StatusFile)); if ($NoLaunch) { $again += "-NoLaunch" } }
        $child = Start-Process -FilePath ((Get-Process -Id $PID).Path) -ArgumentList $again -Wait -PassThru -NoNewWindow
        exit $child.ExitCode
      }
      $script:UpdateProblem = $u.problem
      Log ("UPDATE NOT APPLIED: " + $u.problem)
      Write-Host ("   Deepslate Works could not update itself ({0}). Carrying on with {1}." -f $u.problem, $InstallerVersion) -ForegroundColor Yellow
    }
  }

  $neo = $manifest.neoforge
  $mc = $manifest.minecraft
  $profile = $manifest.profile
  $GameDir = Join-Path $Root $profile.dir
  $files = @($manifest.files | Where-Object { $_.side -ne "server" })
  $Mode = Get-RunMode $prev ([string]$manifest.hash)
  if ($Mode -eq "update") { Note ("Pack {0} {1} {2}" -f $prev.version, [char]0x2192, $script:PackSeen) }
  Log ("{0} mods for Minecraft {1} / NeoForge {2}; this run: {3}" -f $files.Count, $mc, $neo, $Mode)

  # ---- the launcher: there? Open is fine until something it would overwrite has to be written -------------
  $null = Request-Consent "launcher"
  Step "Checking the Minecraft Launcher"
  if (-not (Test-Path -LiteralPath $Profiles)) {
    $script:Facts.launcher = [ordered]@{ kind = "not found"; version = $null; profilesFormat = $null }
    if (-not $DryRun) { try { Start-Process "https://www.minecraft.net/download" } catch {} }
    Fail "Install the Minecraft Launcher from minecraft.net, open it once, close it, then press Play again."
  }
  $script:Facts.launcher = Get-LauncherFacts
  if (@(Find-Launcher).Count -gt 0) { Log "the launcher is open; it only has to be closed if NeoForge or the profile has to be written" }
  Tick "Launcher found"

  # ---- Java 21: the launcher's own, then one on PATH that is 21 or newer, then one downloaded for us -------
  Step "Finding Java 21"
  $bundled = Join-Path $Minecraft "runtime\java-runtime-delta\windows-x64\java-runtime-delta\bin\java.exe"
  $cmd = Get-Command java -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  $onPath = if ($cmd) { [string]$cmd.Source } else { "" }
  $chosen = Select-Java $bundled $onPath (Join-Path $GameDir "runtime")
  # A Java download is more than the answer may have covered (planner: "something bigger than before"): asked again.
  $null = Request-Consent "java" $(if ($chosen.path) { 1 } else { 2 })
  Emit ([ordered]@{ t = "used"; step = "java"; level = $(if ($chosen.path -and $chosen.source -notmatch "downloaded") { 1 } else { 2 }) })
  $java = $chosen.path
  $javaSource = $chosen.source
  $javaPassedOver = $chosen.passedOver
  if ($javaPassedOver) { Note ("The Java on this PC ({0}) is not Java 21. It is left as it is; Minecraft gets its own." -f $javaPassedOver) }
  if ($java) { Tick $chosen.say }
  if (-not $java) {
    if ($DryRun) { $java = "java"; Note "(dry run) would download Temurin 21" }
    else {
      Note "Downloading Java 21 (about 45 MB), one time only"
      New-Item -ItemType Directory -Force -Path (Join-Path $GameDir "runtime") | Out-Null
      $zip = Join-Path $Temp "temurin21.zip"
      Invoke-WebRequest -Uri "https://api.adoptium.net/v3/binary/latest/21/ga/windows/x64/jre/hotspot/normal/eclipse" -OutFile $zip -UseBasicParsing
      Expand-Archive -LiteralPath $zip -DestinationPath (Join-Path $GameDir "runtime") -Force
      Remove-Temp $zip
      $found = Get-ChildItem -LiteralPath (Join-Path $GameDir "runtime") -Filter java.exe -Recurse | Select-Object -First 1
      if (-not $found) { Fail "Java download didn't work. Press Play again, or ask Alex." }
      $java = $found.FullName
      $javaSource = "downloaded on this run"
      Tick "Java 21 downloaded"
    }
  }
  $javaVersion = $null
  if (-not $DryRun) { $javaVersion = Get-JavaVersionText $java }
  $script:Facts.java = [ordered]@{ source = $javaSource; path = [string]$java; version = $javaVersion; passedOver = $javaPassedOver }

  # ---- NeoForge ---------------------------------------------------------------------------------------------
  $null = Request-Consent "neoforge"
  Step ("Installing NeoForge {0}" -f $neo)
  $versionId = "neoforge-$neo"
  $neoBefore = Test-Path -LiteralPath (Join-Path $Minecraft ("versions\{0}" -f $versionId))
  $script:Facts.neoforge = [ordered]@{ version = [string]$neo; before = [bool]$neoBefore; after = [bool]$neoBefore }
  if ($neoBefore) { Tick "Already installed" }
  elseif ($DryRun) { Note "(dry run) would run the NeoForge installer" }
  else {
    Require-LauncherClosed "the NeoForge installer"
    $jar = Join-Path $Temp ("neoforge-{0}-installer.jar" -f $neo)
    Invoke-WebRequest -Uri ("https://maven.neoforged.net/releases/net/neoforged/neoforge/{0}/neoforge-{0}-installer.jar" -f $neo) -OutFile $jar -UseBasicParsing
    $p = Start-Process -FilePath $java -ArgumentList @("-jar", "`"$jar`"", "--install-client", "`"$Minecraft`"") -Wait -PassThru -NoNewWindow -RedirectStandardOutput (Join-Path $Temp "neoforge-install.out")
    if ($p.ExitCode -ne 0) {
      $p = Start-Process -FilePath $java -ArgumentList @("-jar", "`"$jar`"", "--installClient", "`"$Minecraft`"") -Wait -PassThru -NoNewWindow -RedirectStandardOutput (Join-Path $Temp "neoforge-install.out")
    }
    Get-Content -LiteralPath (Join-Path $Temp "neoforge-install.out") -ErrorAction SilentlyContinue | ForEach-Object { Log ("neoforge: " + $_) }
    Remove-Temp $jar
    Remove-Temp (Join-Path $Temp "neoforge-install.out")
    if (-not (Test-Path -LiteralPath (Join-Path $Minecraft ("versions\{0}" -f $versionId)))) { Fail "NeoForge didn't install. Open the Minecraft Launcher, make sure vanilla 1.21.1 has been run once, close it, then press Play again." }
    $script:Facts.neoforge.after = $true
    Tick "NeoForge installed"
  }

  # ---- mods: downloaded into .downloading\, checked, then moved into mods\ ----------------------------------
  $null = Request-Consent "mods"
  Step "Setting up the mods"
  foreach ($d in @("mods", "config", "resourcepacks")) { New-Item -ItemType Directory -Force -Path (Join-Path $GameDir $d) | Out-Null }
  $modsDir = Join-Path $GameDir "mods"
  $staging = Join-Path $GameDir ".downloading"
  $sha = [System.Security.Cryptography.SHA512]::Create()
  $keep = @{}
  # the extras switched on in the Extras tab are the app's, not the pack's: left where they are
  foreach ($x in @(Get-AppliedExtraJars $script:ExtrasState)) { $keep[$x] = $true }
  $i = 0
  $fetched = 0
  $dropped = 0
  foreach ($f in $files) {
    $i++
    $dest = Join-Path $modsDir $f.filename
    $keep[$f.filename] = $true
    if (Test-Path -LiteralPath $dest) {
      $hash = [BitConverter]::ToString($sha.ComputeHash([IO.File]::ReadAllBytes($dest))).Replace("-", "").ToLower()
      if ($hash -eq $f.sha512) { continue }
    }
    Write-Progress -Activity "Downloading mods" -Status $f.filename -PercentComplete ([int](100 * $i / $files.Count))
    if ($DryRun) { Note ("(dry run) would download {0}" -f $f.filename); continue }
    $r = Save-ModFile $f.url $dest $f.sha512 $staging { param($url, $out) Invoke-WebRequest -Uri $url -OutFile $out -UseBasicParsing }
    if ($r -eq "wrong") { Fail ("{0} downloaded wrong. Press Play again." -f $f.filename) }
    if ($r -eq "in use") { Fail ("{0} is in use. Close Minecraft (the game, not only the launcher), then press Play again." -f $f.filename) }
    $fetched++
    Log ("downloaded " + $f.filename)
  }
  Write-Progress -Activity "Downloading mods" -Completed
  Get-ChildItem -LiteralPath $modsDir -Filter *.jar | Where-Object { -not $keep[$_.Name] } | ForEach-Object {
    Log ("removing " + $_.Name)
    $dropped++
    if (-not $DryRun) {
      $gone = $_.Name
      try { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction Stop }
      catch { Log ("could not remove " + $gone + ": " + $_.Exception.Message); Fail ("{0} is in use. Close Minecraft (the game, not only the launcher), then press Play again." -f $gone) }
    }
  }
  Tick ("{0} mods in place ({1} downloaded)" -f $files.Count, $fetched)
  # "Updated 3 mods" on the Play tab, in place of asking about routine updates (planner)
  if ($Mode -ne "first_install" -and ($fetched + $dropped) -gt 0) {
    $what = @()
    if ($fetched -gt 0) { $what += ("Updated {0} mod{1}" -f $fetched, $(if ($fetched -eq 1) { "" } else { "s" })) }
    if ($dropped -gt 0) { $what += ("removed {0}" -f $dropped) }
    Emit ([ordered]@{ t = "changed"; text = ($what -join ", ") })
  }

  # ---- settings: the pack's config files (zip from the site) and, the first time, options.txt ---------------
  Step "Settings"
  if ($manifest.config_url -and -not $DryRun) {
    $cz = Join-Path $Temp "deepslate-config.zip"
    try {
      Invoke-WebRequest -Uri $manifest.config_url -Headers $headers -OutFile $cz -UseBasicParsing
      Expand-Archive -LiteralPath $cz -DestinationPath $GameDir -Force
      Tick "Config files updated"
    } catch { Note ("The config files could not be updated this time: " + $_.Exception.Message) }
    finally { Remove-Temp $cz }
  }
  $options = Join-Path $GameDir "options.txt"
  $rd = 8; $sd = 6
  try { if ($manifest.render_distance) { $rd = [int]$manifest.render_distance }; if ($manifest.simulation_distance) { $sd = [int]$manifest.simulation_distance } } catch {}
  $prevOurs = $null
  if ($prev -and $prev.PSObject.Properties["renderDistance"]) { $prevOurs = $prev.renderDistance }
  $script:OurRender = $prevOurs
  if ($DryRun) { Note ("(dry run) render distance for this PC: {0}" -f $rd) }
  else {
    try {
      $r = Set-RenderDistance $options $prevOurs $rd $sd
      $script:OurRender = $r.ours
      Tick $r.text
      $cl = Set-ChatLinks $options
      if ($cl) { Tick $cl }
    } catch { Note ("The render distance was left as it is: " + $_.Exception.Message) }
  }

  # ---- extras (2.0.0): every extra downloaded into extras\, nothing switched on; the Extras tab switches them -----
  if (-not $DryRun -and (Request-Consent "extras")) {
    try {
      $xm = Invoke-RestMethod -Uri "$PortalUrl/api/modpack/extras" -Headers $headers -UseBasicParsing -TimeoutSec 60
      Step "Visual extras"
      Write-JsonFile (Join-Path $AppHome $ExtrasManifestName) $xm
      $xp = Get-ExtrasPaths $GameDir
      $sx = Sync-ExtrasFiles $xp $xm $script:ExtrasState { param($url, $out) Invoke-WebRequest -Uri $url -OutFile $out -UseBasicParsing }
      if (-not $script:ExtrasState.downloaded) { $script:ExtrasState.seen = @($xm.extras | ForEach-Object { [string]$_.id }); $script:ExtrasState.downloaded = $true }
      if ($sx.applied -and -not $sx.applied.ok) { Note ("Your extras could not be updated this time: " + $sx.applied.error) }
      Save-ExtrasState $ExtrasStatePath $script:ExtrasState
      Tick ("{0} extras ready ({1} downloaded), {2} on" -f @($xm.extras).Count, $sx.downloaded, @(Get-ExtrasOn $xm $script:ExtrasState).Count)
      Emit ([ordered]@{ t = "extras"; downloaded = $sx.downloaded })
    } catch { Note ("The visual extras could not be fetched this time: " + $_.Exception.Message) }
  }

  # ---- the server list (servers.dat: uncompressed NBT, one entry), the first time --------------------------
  $null = Request-Consent "profile"
  $serversDat = Join-Path $GameDir "servers.dat"
  if (-not (Test-Path -LiteralPath $serversDat) -and -not $DryRun) {
    $ms = New-Object IO.MemoryStream
    $w = New-Object IO.BinaryWriter($ms)
    function WriteStr([IO.BinaryWriter]$bw, [string]$s) { $b = [Text.Encoding]::UTF8.GetBytes($s); $bw.Write([byte](($b.Length -shr 8) -band 0xFF)); $bw.Write([byte]($b.Length -band 0xFF)); $bw.Write($b) }
    $w.Write([byte]10); WriteStr $w ""                  # TAG_Compound ""
    $w.Write([byte]9);  WriteStr $w "servers"           # TAG_List "servers"
    $w.Write([byte]10)                                  #   of TAG_Compound
    $w.Write([byte[]](0,0,0,1))                         #   length 1
    $w.Write([byte]8);  WriteStr $w "name"; WriteStr $w $PackName
    $w.Write([byte]8);  WriteStr $w "ip";   WriteStr $w $manifest.server_address
    $w.Write([byte]0)                                   #   TAG_End (entry)
    $w.Write([byte]0)                                   # TAG_End (root)
    $w.Flush()
    [IO.File]::WriteAllBytes($serversDat, $ms.ToArray())
    Tick ("Server added to your list: {0}" -f $manifest.server_address)
  }

  # ---- the launcher profile ---------------------------------------------------------------------------------
  Step "Adding the launcher profile"
  $totalGb = 8
  try { $totalGb = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB) } catch {}
  $xmx = 3
  if ($totalGb -ge 16) { $xmx = 6 } elseif ($totalGb -ge 12) { $xmx = 5 } elseif ($totalGb -ge 8) { $xmx = 4 }
  $xmx = [math]::Max($manifest.ram.min_gb, [math]::Min($manifest.ram.max_gb, $xmx))
  $javaArgs = "-Xmx${xmx}G -Xms1G -XX:+UseG1GC -XX:+UnlockExperimentalVMOptions -XX:MaxGCPauseMillis=50 -XX:G1NewSizePercent=20 -XX:G1ReservePercent=20"
  $now = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
  $entry = [ordered]@{ name = $PackName; type = "custom"; lastVersionId = $versionId; gameDir = $GameDir; javaArgs = $javaArgs; javaDir = $java; icon = $profile.icon; created = $now; lastUsed = $now }
  $profileLeft = $false
  if (-not $DryRun -and @(Find-Launcher).Count -gt 0 -and (Test-LauncherProfile $Profiles $profile.id $versionId) -eq "") {
    # Launcher open, profile already there and pointing at the right NeoForge: nothing to write.
    $profileLeft = $true
    Log "the launcher is open and the profile is right: launcher_profiles.json left as it is"
  }
  if ($DryRun) { Note "(dry run) would write the profile to launcher_profiles.json" }
  elseif (-not $profileLeft) {
    Require-LauncherClosed "launcher_profiles.json is written"
    Set-LauncherProfile $Profiles $profile.id $entry
    # Read it back. Then once more after a moment: a launcher that was just starting would have written over it by now.
    $problem = Test-LauncherProfile $Profiles $profile.id $versionId
    if ($problem -eq "") {
      Start-Sleep -Seconds 2
      $problem = Test-LauncherProfile $Profiles $profile.id $versionId
    }
    if ($problem -eq "" -and @(Find-Launcher).Count -gt 0) { $problem = "the Minecraft Launcher was opened while the profile was being written, and will overwrite it when it closes" }
    if ($problem -ne "") {
      Log ("PROFILE NOT SAVED: " + $problem)
      Write-Host ""
      Write-Host "   THE LAUNCHER PROFILE WAS NOT SAVED." -ForegroundColor Red
      Write-Host ("   What is wrong: {0}." -f $problem) -ForegroundColor Red
      Write-Host "   Close the Minecraft Launcher completely (also its icon next to the clock), then press Play again." -ForegroundColor Yellow
      Write-Host "   The mods are in place; only the profile is missing." -ForegroundColor Gray
      Write-Host ("   Log file: {0}" -f $LogFile) -ForegroundColor White
      Log "FAIL the launcher profile was not saved"
      Send-Report "failed"
      Exit-Lock
      Hold-Window
      exit 1
    }
  }
  if ($profileLeft) { Tick ("Profile '{0}' is already in the launcher" -f $PackName) }
  else { Tick ("Profile '{0}' with {1} GB of RAM (your PC has {2} GB), saved and checked" -f $PackName, $xmx, $totalGb) }

  # ---- the Play link and the shortcuts: put right when missing (Setup.bat made them; this keeps them) ------
  if (-not $DryRun -and -not $script:CustomRoot -and $OnWindows -and (Get-HomeDir)) {
    try {
      $links = Request-Consent "shortcuts"
      $rh = Repair-Home (Resolve-Path -LiteralPath $script:MePath).Path (Get-HomeDir) (Get-WindowsHomeIo $GameDir) -NoLinks:(-not $links)
      Set-SetupState $rh
      if ($rh.fixed) { Tick "Play button set up on this run" }
      foreach ($line in @($rh.said | Where-Object { $_.tone -ne "ok" })) { Note $line.text }
    } catch { Log ("could not check the Play link and the shortcuts: " + $_.Exception.Message) }
  }

  if (-not $DryRun) { @{ version = $script:PackSeen; installedAt = $now; hash = $manifest.hash; installer = $InstallerVersion; renderDistance = $script:OurRender } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $installedFile }

  # ---- d. the report, e. the game -------------------------------------------------------------------------
  Log "=== done ==="
  $script:StepName = ""
  Write-Host ""
  if ($Mode -eq "first_install") { Write-Host ("Installed {0} {1}." -f $PackName, $script:PackSeen) -ForegroundColor Green }
  elseif ($Mode -eq "update") { Write-Host ("Updated to {0}." -f $script:PackSeen) -ForegroundColor Green }
  else { Write-Host "Everything is up to date." -ForegroundColor Green }
  Send-Report "ok"
  Exit-Lock
  Emit ([ordered]@{ t = "done"; mode = $Mode; pack = [string]$script:PackSeen })
  if ($DryRun) { Write-Host "(dry run) Nothing was changed." -ForegroundColor Green }
  elseif ($NoLaunch) { Log "not opening the launcher (asked not to)" }
  else {
    if ($profileLeft) { Write-Host ("The Minecraft Launcher is already open. Choose {0} next to Play, then press Play." -f $PackName) -ForegroundColor Green }
    elseif (Open-Launcher) { Write-Host ("Opening the Minecraft Launcher on {0}. Press Play." -f $PackName) -ForegroundColor Green }
    else { Write-Host ("Open the Minecraft Launcher from the Start menu, choose {0}, press Play." -f $PackName) -ForegroundColor Yellow }
    if ($Mode -eq "first_install") { Write-Host ("From now on, press Play on {0} or open {1} from your desktop. It keeps itself up to date." -f $PortalUrl.Replace("https://", ""), $PackName) -ForegroundColor Gray }
    if ($script:Waking) { [void](Watch-Wake $wakeCall { param($s) Start-Sleep -Seconds $s }) }
    if (-not $FromSetup) { Start-Sleep -Seconds 3 }
  }
} catch {
  Log ($_ | Out-String)
  Fail "Something went wrong. Send Alex the log file and he'll sort it."
} finally {
  # Reached without a report having gone: the window was closed or Ctrl+C was pressed part-way.
  if (-not $script:Reported) { Log "stopped before the end"; Send-Report "cancelled" }
  Exit-Lock
}

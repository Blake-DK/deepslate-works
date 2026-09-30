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
  [switch]$NoPrompt
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
}
# ---- config block (stamped by `modpack build installer`) ----
$PortalUrl = "https://deepslate.dsw.test"
$PackName = "Deepslate Works"
$PackVersion = "dev"
# -------------------------------------------------------------
$InstallerVersion = "1.5.4"   # 1.5.4: render distance by PC tier, also on PCs installed before. History in docs/07
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
}
function Tick($msg) { if (-not $Quiet) { Write-Host ("   [OK] {0}" -f $msg) -ForegroundColor Green }; Log "OK $msg" }
# Every file operation takes its path literally (-LiteralPath): with -Path PowerShell reads [ ] in a path as a pattern
# and can fail to resolve a user folder at all (Pabulum's PC, 2026-09-29, installer 1.4.1).
function Remove-Temp($path) {
  # A leftover temporary file is never a reason to stop.
  try { if ($path -and [IO.File]::Exists($path)) { [IO.File]::Delete($path) } } catch { Log ("could not remove " + $path + ": " + $_.Exception.Message) }
}
function Note($msg) { if (-not $Quiet) { Write-Host ("   {0}" -f $msg) -ForegroundColor Gray }; Log $msg }
function Hold-Window {
  # Started from the Play button or a shortcut there is no .bat to keep the window open: wait, so the message can be read.
  if (-not $FromSetup -and -not $SelfTest -and -not $DryRun -and -not $script:Held) { $script:Held = $true; try { [void](Read-Host "Press Enter to close this window") } catch {} }
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
    $json = (New-Report $outcome) | ConvertTo-Json -Depth 8 -Compress
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
  return ('"{0}" -NoProfile -ExecutionPolicy Bypass -File "{1}" "%1"' -f (Get-PowerShellExe), $scriptPath)
}

function Get-ShortcutSpec([string]$scriptPath) {
  return [ordered]@{
    target = Get-PowerShellExe
    arguments = ('-NoProfile -ExecutionPolicy Bypass -File "{0}"' -f $scriptPath)
    workingDirectory = (Split-Path -Parent $scriptPath)
    description = "Updates Deepslate Works and opens the Minecraft Launcher on it"
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

function Set-Shortcuts([string]$scriptPath) {
  $spec = Get-ShortcutSpec $scriptPath
  $shell = New-Object -ComObject WScript.Shell
  $made = 0
  foreach ($folder in @([Environment]::GetFolderPath("Desktop"), [Environment]::GetFolderPath("Programs"))) {
    if (-not $folder) { continue }
    try {
      $s = $shell.CreateShortcut((Join-Path $folder ("{0}.lnk" -f $PackName)))
      $s.TargetPath = $spec.target; $s.Arguments = $spec.arguments; $s.WorkingDirectory = $spec.workingDirectory; $s.Description = $spec.description
      $s.IconLocation = ("{0},0" -f $spec.target)
      $s.Save(); $made++
    } catch { Log ("could not make the shortcut in " + $folder + ": " + $_.Exception.Message) }
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
    } catch { Log ("could not make the uninstall shortcut: " + $_.Exception.Message) }
  }
  return $made
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
    @($t.gameDir, "the game folder (mods, settings, the Java it downloaded, logs, the server list)"),
    @($t.homeDir, "Deepslate Works itself, in your AppData")
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
function Install-Home([string]$me, [string]$dir) {
  [void][IO.Directory]::CreateDirectory($dir)
  $target = Join-Path $dir $ScriptName
  if ($me -ne $target) {
    $same = (Test-Path -LiteralPath $target) -and ((Get-FileHash -LiteralPath $me -Algorithm SHA256).Hash -eq (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash)
    if (-not $same -and (Test-Path -LiteralPath $target) -and (Test-Newer (Get-ScriptVersion $target) $InstallerVersion)) { $same = $true; Log ("the copy in " + $dir + " is newer than this one; left as it is") }
    if (-not $same) { Copy-Item -LiteralPath $me -Destination $target -Force; Log ("put " + $ScriptName + " in " + $dir) }
  }
  return $target
}

# What 1.3.x/1.4.x left in the home folder. Removed only once the Play link points at DeepslateWorks.ps1: until then
# the link may still name install.ps1, and removing it would leave the Play button starting nothing.
function Remove-OldLayout([string]$dir) {
  foreach ($old in $OldFiles) { $p = Join-Path $dir $old; if (Test-Path -LiteralPath $p) { Remove-Temp $p; Log ("removed the old " + $old) } }
}

# The home folder, the Play link, the shortcuts and the Settings -> Apps entry, put right: after Setup.bat, at the end of
# every run, and at once on a run under a 1.4.x name (install.ps1, started by 1.4.x's update step). $io says how each is
# read and written: the registry and the shortcuts on Windows, files in a scratch folder in the self test. Its blocks
# run inside this function, so they read $io. Returns the home script and whether the Play link points at it.
function Repair-Home([string]$me, [string]$dir, $io) {
  $target = Install-Home $me $dir
  $want = Get-HandlerCommand $target
  if ((& $io.handler) -ne $want) { if (& $io.setHandler $target) { Log "the Play link was set up again" } }
  $linked = ((& $io.handler) -eq $want)
  if (-not (& $io.shortcutsThere)) { $null = & $io.makeShortcuts $target; Log "the shortcuts were made again" }
  if (-not (& $io.listed $target)) { & $io.list $target; Log "listed in Settings -> Apps" }
  if ($linked) { Remove-OldLayout $dir } else { Log "the Play link does not point at the new script yet; the old files are kept" }
  return @{ script = $target; linked = $linked }
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
    makeShortcuts = { param($t) foreach ($n in @("Desktop.lnk", "Programs.lnk", "Uninstall.lnk")) { [IO.File]::WriteAllText((Join-Path $io.at $n), $t) }; return 3 }
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
    [IO.File]::WriteAllText($path, ("renderDistance:{0}`r`nsimulationDistance:{1}`r`nfullscreen:false`r`n" -f $render, $sim), (New-Object Text.UTF8Encoding($false)))
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
  Check ("Windows is told to run the one script for the link: " + $cmd) ($cmd -eq '"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "C:\Users\x\AppData\Local\DeepslateWorks\DeepslateWorks.ps1" "%1"')
  $sc = Get-ShortcutSpec $home2
  Check ("the shortcuts run the same script, with nothing else: " + $sc.arguments) (($sc.target -eq "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe") -and ($sc.arguments -eq '-NoProfile -ExecutionPolicy Bypass -File "C:\Users\x\AppData\Local\DeepslateWorks\DeepslateWorks.ps1"'))
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

  Write-Host "Self test: render distance (1.5.4)" -ForegroundColor White
  $od = Join-Path $dir "options [x]"
  [void][IO.Directory]::CreateDirectory($od)
  $of = Join-Path $od "options.txt"
  $r = Set-RenderDistance $of $null 12 8
  Check ("first install: written with the tier's values: " + $r.text) (($r.status -eq "written") -and ($r.ours -eq 12) -and ([IO.File]::ReadAllText($of) -eq "renderDistance:12`r`nsimulationDistance:8`r`nfullscreen:false`r`n"))
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
  if (-not $DryRun -and -not $script:CustomRoot -and $OnWindows -and $dir) {
    try {
      $target = Install-Home $me $dir
      $linked = Register-PlayLink $target
      if ($linked) { Remove-OldLayout $dir }
      $made = Set-Shortcuts $target
      try { Register-Uninstall $target (Join-Path $Root ".minecraft-deepslate-works") } catch { Log ("could not list it in Settings -> Apps: " + $_.Exception.Message) }
      Write-Host ("  Installed in {0}" -f $dir) -ForegroundColor DarkGray
      if ($linked) { Write-Host "  The Play button on the site now starts Deepslate Works on this PC" -ForegroundColor DarkGray }
      if ($made -gt 0) { Write-Host ("  '{0}' is on your desktop and in the Start Menu" -f $PackName) -ForegroundColor DarkGray }
    } catch {
      Log ("setup: " + $_.Exception.Message)
      Write-Host ("  Could not set up the Play button and the shortcuts ({0}). Carrying on from this folder." -f $_.Exception.Message) -ForegroundColor Yellow
      $target = $me
    }
  }
  $env:DEEPSLATE_FROM_SETUP = "1"
  $again = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ('"{0}"' -f $target))
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
$Minecraft = Join-Path $Root ".minecraft"
$Profiles = Join-Path $Minecraft "launcher_profiles.json"

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
  Step "Setting up the mods"
  foreach ($d in @("mods", "config", "resourcepacks")) { New-Item -ItemType Directory -Force -Path (Join-Path $GameDir $d) | Out-Null }
  $modsDir = Join-Path $GameDir "mods"
  $staging = Join-Path $GameDir ".downloading"
  $sha = [System.Security.Cryptography.SHA512]::Create()
  $keep = @{}
  $i = 0
  $fetched = 0
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
    if (-not $DryRun) {
      $gone = $_.Name
      try { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction Stop }
      catch { Log ("could not remove " + $gone + ": " + $_.Exception.Message); Fail ("{0} is in use. Close Minecraft (the game, not only the launcher), then press Play again." -f $gone) }
    }
  }
  Tick ("{0} mods in place ({1} downloaded)" -f $files.Count, $fetched)

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
    } catch { Note ("The render distance was left as it is: " + $_.Exception.Message) }
  }

  # ---- the server list (servers.dat: uncompressed NBT, one entry), the first time --------------------------
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
    try { $null = Repair-Home (Resolve-Path -LiteralPath $script:MePath).Path (Get-HomeDir) (Get-WindowsHomeIo $GameDir) }
    catch { Log ("could not check the Play link and the shortcuts: " + $_.Exception.Message) }
  }

  if (-not $DryRun) { @{ version = $script:PackSeen; installedAt = $now; hash = $manifest.hash; installer = $InstallerVersion; renderDistance = $script:OurRender } | ConvertTo-Json | Set-Content -LiteralPath $installedFile }

  # ---- d. the report, e. the game -------------------------------------------------------------------------
  Log "=== done ==="
  $script:StepName = ""
  Write-Host ""
  if ($Mode -eq "first_install") { Write-Host ("Installed {0} {1}." -f $PackName, $script:PackSeen) -ForegroundColor Green }
  elseif ($Mode -eq "update") { Write-Host ("Updated to {0}." -f $script:PackSeen) -ForegroundColor Green }
  else { Write-Host "Everything is up to date." -ForegroundColor Green }
  Send-Report "ok"
  Exit-Lock
  if ($DryRun) { Write-Host "(dry run) Nothing was changed." -ForegroundColor Green }
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

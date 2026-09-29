# Deepslate Works client installer. PowerShell 5.1, no modules, no admin rights. See docs/07-installer.md.
[CmdletBinding(PositionalBinding = $false)]
param(
  [Parameter(Position = 0)]
  [string]$Link = "",       # the deepslate:// link, when Windows starts this from the Play button on the site
  [switch]$DryRun,          # no downloads, no writes outside -Root, no browser
  [switch]$Play,            # update quietly, then open the Minecraft Launcher on our profile and exit
  [string]$Root = "",       # override %APPDATA% (tests)
  [switch]$NoPrompt,        # never ask anything at the end (automation)
  [switch]$SelfTest,        # check the script's own code against scratch files, touch nothing else, exit
  [string[]]$PretendRunning = @()   # tests: process names to treat as running
)

# ---- started from a link on a web page ------------------------------------------------------------------
# The Play button is a link, deepslate://play, and Windows hands this script whatever link was clicked.
# ANY web page can put such a link in front of someone, so: exactly one link is accepted, and when the
# script was started by a link nothing else on the command line counts. It installs where it always
# installs, from the site it was built for, and does nothing a normal run would not do.
function Test-PlayLink([string]$l) { return ($l -match '^deepslate://play/?$') }

$FromLink = ($Link -ne "")
if ($FromLink) {
  if (-not (Test-PlayLink $Link)) {
    Write-Host "That is not a link this installer knows. Use the Play button on the site." -ForegroundColor Red
    Start-Sleep -Seconds 6
    exit 1
  }
  $Play = $true; $DryRun = $false; $SelfTest = $false; $NoPrompt = $true; $Root = ""; $PretendRunning = @()
}
$Mode = "install"
if ($Play) { $Mode = "play" }
$Quiet = [bool]$Play      # play mode: one grey line per step, no ticks; failures are said in full
# ---- config block (stamped by `modpack build installer`) ----
$PortalUrl = "https://deepslate.dsw.test"
$PackName = "Deepslate Works"
$PackVersion = "dev"
# -------------------------------------------------------------
$InstallerVersion = "1.4.3"   # 1.1.0: launcher must be closed, profile read back; 1.2.0: install report; 1.3.0: Play from the site; 1.4.0: updates itself; 1.4.1: a Java on PATH no longer ends the install; 1.4.2: paths are taken literally, a temp file left behind ends nothing; 1.4.3: shows what the site says about an old installer
$ManifestUrl = "$PortalUrl/api/modpack/manifest"

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Temp = if ($env:TEMP) { $env:TEMP } else { [IO.Path]::GetTempPath() }   # $env:TEMP is unset when testing under pwsh on Linux
$LogFile = Join-Path $Temp "deepslate-install.log"
$script:Step = 0
$script:StepName = ""          # the step in hand: what a report calls "the step that failed"
$script:Started = Get-Date
$script:RunLog = New-Object System.Collections.Generic.List[string]   # this run's lines of the log file
$script:Token = $null
$script:Reported = $false
$script:PackSeen = $PackVersion
# Set when an older copy of this script fetched this one and started it in its place. It comes through the
# environment, which a link cannot reach, and it is also what stops a second update in the same run.
$script:UpdatedFrom = $null
if ($env:DEEPSLATE_UPDATED_FROM -match '^\d{1,4}(\.\d{1,4}){1,3}$') { $script:UpdatedFrom = [string]$env:DEEPSLATE_UPDATED_FROM }
$script:UpdateProblem = $null  # why an update that was due was not applied
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
# 1.4.2: every file operation takes its path literally (-LiteralPath). With -Path, PowerShell reads [ ] in a
# path as a pattern and can fail to resolve a user folder at all; on Pabulum's PC (2026-09-29) deleting the
# NeoForge installer from %TEMP% ended a run whose install had just gone through.
function Remove-Temp($path) {
  # A leftover temporary file is never a reason to stop.
  try { if ($path -and [IO.File]::Exists($path)) { [IO.File]::Delete($path) } } catch { Log ("could not remove " + $path + ": " + $_.Exception.Message) }
}
function Note($msg) { if (-not $Quiet) { Write-Host ("   {0}" -f $msg) -ForegroundColor Gray }; Log $msg }
function Hold-Window {
  # Started from the Play button there is no .bat to keep the window open: wait, so the message can be read.
  if ($FromLink -and -not $script:Held) { $script:Held = $true; try { [void](Read-Host "Press Enter to close this window") } catch {} }
}
function Gate-Message($err) {
  $body = ""
  try { $body = (New-Object IO.StreamReader($err.Exception.Response.GetResponseStream())).ReadToEnd() } catch {}
  if ($body -match "not_live") { return "The server hasn't launched yet. Watch Discord for the date." }
  if ($body -match "server_offline") { return "The server is offline right now, so updates are paused. Try again later." }
  return "The site said no (" + $body.Substring(0, [Math]::Min(120, $body.Length)) + ")"
}
function Fail($msg) {
  Write-Host ""
  Write-Host ("   {0}" -f $msg) -ForegroundColor Red
  Write-Host ("   Details are in {0}" -f $LogFile) -ForegroundColor DarkGray
  Log "FAIL $msg"
  Send-Report "failed"
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
    system           = Redact-Tree (Get-SystemInfo)
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
  if ($Play) { Hold-Window }
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
  Write-Host ("Sending the install log to {0} so Alex can help if something went wrong." -f $site) -ForegroundColor Gray
  try {
    $json = (New-Report $outcome) | ConvertTo-Json -Depth 8 -Compress
    $answer = Invoke-RestMethod -Uri "$PortalUrl/api/installer/report" -Method Post -Headers @{ Authorization = "Bearer $($script:Token)" } -ContentType "application/json; charset=utf-8" -Body ([Text.Encoding]::UTF8.GetBytes($json)) -UseBasicParsing -TimeoutSec 20
    Write-Host "   Sent." -ForegroundColor Gray
    Log "install report sent"
    Show-Notice $answer
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

# ---- Play from the site (docs/07 "Play from the site") ------------------------------------------------
# The script keeps a copy of itself in %LOCALAPPDATA%\DeepslateWorks and tells Windows, for this user
# only (HKCU, no admin rights), to run that copy for deepslate:// links.

function Get-HandlerCommand([string]$scriptPath) {
  $ps = ([string]$env:SystemRoot).TrimEnd("\") + "\System32\WindowsPowerShell\v1.0\powershell.exe"   # the full path: never whatever "powershell" is found first
  return ('"{0}" -NoProfile -ExecutionPolicy Bypass -File "{1}" -Play "%1"' -f $ps, $scriptPath)
}

function Register-PlayLink([string]$scriptPath) {
  $base = "HKCU:\Software\Classes\deepslate"
  New-Item -Path "$base\shell\open\command" -Force | Out-Null
  Set-Item -Path $base -Value ("URL:{0}" -f $PackName)
  New-ItemProperty -Path $base -Name "URL Protocol" -Value "" -PropertyType String -Force | Out-Null
  Set-Item -Path "$base\shell\open\command" -Value (Get-HandlerCommand $scriptPath)
}

# ---- the installer updates itself (docs/07 "The installer updates itself") ------------------------------
# The mod list names the installer the site hands out and the SHA-256 of its zip. In -Play mode a script
# older than that fetches the zip, checks it, replaces install.ps1 and Setup.bat next to itself and starts
# the new script in its own place. Nothing is replaced unless every check has passed.

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

# "" when install.ps1 and Setup.bat in $dir are now the ones from the zip. Otherwise what was wrong, in
# words, and nothing in $dir has been touched.
function Install-Update([string]$zip, [string]$sha256, [string]$version, [string]$dir) {
  if ($sha256 -notmatch '^[0-9a-fA-F]{64}$') { return "the site gave no checksum for it" }
  $got = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLower()
  if ($got -ne $sha256.ToLower()) { return ("the checksum of the download ({0}...) is not the one the site gave ({1}...)" -f $got.Substring(0, 12), $sha256.Substring(0, 12).ToLower()) }
  Add-Type -AssemblyName System.IO.Compression
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $names = @("Setup.bat", "install.ps1")   # these two and nothing else, whatever the zip holds; taken by name, never unpacked by path
  $files = @{}
  $archive = [IO.Compression.ZipFile]::OpenRead($zip)
  try {
    foreach ($name in $names) {
      $entry = @($archive.Entries | Where-Object { $_.FullName -ceq $name }) | Select-Object -First 1
      if (-not $entry) { return ("{0} is not in the download" -f $name) }
      if ($entry.Length -lt 1 -or $entry.Length -gt 2MB) { return ("{0} in the download has an unlikely size" -f $name) }
      $ms = New-Object IO.MemoryStream
      $in = $entry.Open()
      try { $in.CopyTo($ms) } finally { $in.Dispose() }
      $files[$name] = $ms.ToArray()
    }
  } finally { $archive.Dispose() }
  $text = (New-Object Text.UTF8Encoding($false)).GetString($files["install.ps1"])
  if ($text -notmatch ('(?m)^\$InstallerVersion = "' + [regex]::Escape($version) + '"')) { return ("the script in the download is not version {0}" -f $version) }
  $errs = $null; $tokens = $null
  [void][System.Management.Automation.Language.Parser]::ParseInput($text, [ref]$tokens, [ref]$errs)
  if ($errs -and @($errs).Count -gt 0) { return "the script in the download does not read as PowerShell" }

  # Everything has been checked. Written next to the old files first, then moved over them.
  foreach ($name in $names) { [IO.File]::WriteAllBytes((Join-Path $dir ($name + ".new")), [byte[]]$files[$name]) }
  $old = Join-Path $dir "install.ps1"
  if (Test-Path -LiteralPath $old) { Copy-Item -LiteralPath $old -Destination ($old + ".bak") -Force }
  foreach ($name in $names) { Move-Item -Force -LiteralPath (Join-Path $dir ($name + ".new")) -Destination (Join-Path $dir $name) }
  return ""
}

# $true when the newer script is in place and has to be started; the caller does that and leaves.
function Update-Self($manifest, $headers) {
  if ($Mode -ne "play" -or $DryRun -or $script:UpdatedFrom -or @($PretendRunning).Count -gt 0 -or -not $PSCommandPath) { return $false }
  $inst = $null
  if ($manifest.PSObject.Properties["installer"]) { $inst = $manifest.installer }
  if (-not $inst -or -not (Test-Newer ([string]$inst.version) $InstallerVersion)) { return $false }
  $new = [string]$inst.version
  Step ("Updating the installer {0} {1} {2}" -f $InstallerVersion, [char]0x2192, $new)
  $zip = Join-Path $Temp "deepslate-installer-update.zip"
  $problem = ""
  try {
    # From this site's /downloads and nowhere else: the mod list says which version and which checksum, never where from.
    Invoke-WebRequest -Uri "$PortalUrl/downloads/installer.zip" -Headers $headers -OutFile $zip -UseBasicParsing -TimeoutSec 120
    $problem = Install-Update $zip ([string]$inst.sha256) $new (Split-Path -Parent $PSCommandPath)
  } catch { $problem = ("it could not be fetched or written: {0}" -f $_.Exception.Message) }
  finally { Remove-Temp $zip }
  if ($problem -ne "") {
    $script:UpdateProblem = $problem
    Log ("UPDATE NOT APPLIED: " + $problem)
    Write-Host ("   The installer was not updated: {0}." -f $problem) -ForegroundColor Yellow
    Write-Host ("   Nothing was replaced. Carrying on with installer {0}." -f $InstallerVersion) -ForegroundColor Gray
    return $false
  }
  Tick ("Installer {0} is in place; starting it" -f $new)
  return $true
}

# $true when the Play button will work on this PC afterwards.
function Install-Self {
  if ($DryRun -or $script:CustomRoot -or $env:OS -ne "Windows_NT" -or -not $env:LOCALAPPDATA -or -not $PSCommandPath) { return $false }
  $dir = Join-Path $env:LOCALAPPDATA "DeepslateWorks"
  $target = Join-Path $dir "install.ps1"
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $me = (Resolve-Path -LiteralPath $PSCommandPath).Path
  if ($me -ne $target) {
    $same = (Test-Path -LiteralPath $target) -and ((Get-FileHash -LiteralPath $me -Algorithm SHA256).Hash -eq (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash)
    # Never an older script over a newer one: the copy may have updated itself since this folder was unzipped.
    if (-not $same -and (Test-Path -LiteralPath $target) -and (Test-Newer (Get-ScriptVersion $target) $InstallerVersion)) { $same = $true; Log ("the copy in " + $dir + " is newer than this script; left as it is") }
    if (-not $same) {
      Copy-Item -LiteralPath $me -Destination $target -Force
      $bat = Join-Path (Split-Path -Parent $me) "Setup.bat"
      if (Test-Path -LiteralPath $bat) { Copy-Item -LiteralPath $bat -Destination (Join-Path $dir "Setup.bat") -Force }
      Log ("copied the installer to " + $target)
    }
  }
  if (-not (Test-Path -LiteralPath $target)) { return $false }
  Register-PlayLink $target
  $got = [string](Get-Item "HKCU:\Software\Classes\deepslate\shell\open\command").GetValue("")
  return ($got -eq (Get-HandlerCommand $target))
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
  # Runs the profile code against a scratch copy of what the launcher writes on a fresh install.
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

  Write-Host "Self test: the Play link" -ForegroundColor White
  Check "deepslate://play is accepted, with or without the slash a browser adds" ((Test-PlayLink "deepslate://play") -and (Test-PlayLink "deepslate://play/") -and (Test-PlayLink "DEEPSLATE://PLAY"))
  $no = @("deepslate://play/../x", "deepslate://play?root=\\evil\share", "deepslate://play -Root C:\x", 'deepslate://play" -SelfTest "', "deepslate://update", "deepslate://", "deepslate:play", "http://deepslate.dsw.test/play", "deepslate://play/ ", " deepslate://play", "deepslate://play`n-DryRun", "")
  $let = @($no | Where-Object { Test-PlayLink $_ })
  Check ("every other link is refused (let through: " + $let.Count + ")") ($let.Count -eq 0)
  $env:SystemRoot = "C:\Windows"
  $cmd = Get-HandlerCommand "C:\Users\x\AppData\Local\DeepslateWorks\install.ps1"
  Check ("Windows is told to run: " + $cmd) ($cmd -eq '"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "C:\Users\x\AppData\Local\DeepslateWorks\install.ps1" -Play "%1"')
  $Mode = "play"
  Check "a run from the Play button says so in its report" ((New-Report "ok").mode -eq "play")
  $Mode = "install"
  Check "a normal run says so too" ((New-Report "ok").mode -eq "install")

  Write-Host "Self test: the installer updates itself" -ForegroundColor White
  Check "1.4.0 is newer than 1.3.0, and 1.10.0 than 1.9.0" ((Test-Newer "1.4.0" "1.3.0") -and (Test-Newer "1.10.0" "1.9.0"))
  $notNewer = @(@("1.3.0", "1.3.0"), @("1.2.9", "1.3.0"), @("banana", "1.3.0"), @("", "1.3.0"), @("9.9.9; calc", "1.3.0"), @("v2.0.0", "1.3.0")) | Where-Object { Test-Newer $_[0] $_[1] }
  Check "the same, an older one and anything that is not a version are not" (@($notNewer).Count -eq 0)
  Add-Type -AssemblyName System.IO.Compression
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  function New-TestZip($path, $entries) {
    if (Test-Path $path) { Remove-Item $path -Force }
    $z = [IO.Compression.ZipFile]::Open($path, [IO.Compression.ZipArchiveMode]::Create)
    try {
      foreach ($k in $entries.Keys) {
        $w = New-Object IO.StreamWriter($z.CreateEntry($k).Open())
        try { $w.Write([string]$entries[$k]) } finally { $w.Dispose() }
      }
    } finally { $z.Dispose() }
    return (Get-FileHash -Path $path -Algorithm SHA256).Hash
  }
  $up = Join-Path $dir "update"
  $home1 = Join-Path $up "folder"
  New-Item -ItemType Directory -Force -Path $home1 | Out-Null
  $oldPs = '$InstallerVersion = "1.3.0"' + "`nWrite-Host old"
  $newPs = '$InstallerVersion = "1.4.0"' + "`nWrite-Host new"
  function Reset-Folder { [IO.File]::WriteAllText((Join-Path $home1 "install.ps1"), $oldPs); [IO.File]::WriteAllText((Join-Path $home1 "Setup.bat"), "old bat"); Get-ChildItem $home1 | Where-Object { $_.Name -notin @("install.ps1", "Setup.bat") } | Remove-Item -Force -Recurse }
  function Test-Untouched { return ((([IO.File]::ReadAllText((Join-Path $home1 "install.ps1"))) -eq $oldPs) -and (([IO.File]::ReadAllText((Join-Path $home1 "Setup.bat"))) -eq "old bat") -and (@(Get-ChildItem $home1).Count -eq 2)) }
  $zip = Join-Path $up "installer.zip"

  Reset-Folder
  $sum = New-TestZip $zip ([ordered]@{ "install.ps1" = $newPs; "Setup.bat" = "new bat"; "README.txt" = "read me" })
  $r = Install-Update $zip "0000000000000000000000000000000000000000000000000000000000000000" "1.4.0" $home1
  Check ("a download with another checksum replaces nothing: " + $r) (($r -ne "") -and (Test-Untouched))
  $r = Install-Update $zip "" "1.4.0" $home1
  Check ("no checksum from the site, nothing replaced: " + $r) (($r -ne "") -and (Test-Untouched))
  $r = Install-Update $zip $sum "1.5.0" $home1
  Check ("a script of another version than the site named, nothing replaced: " + $r) (($r -ne "") -and (Test-Untouched))
  $r = Install-Update $zip $sum "1.4.0" $home1
  Check "the right download replaces install.ps1 and Setup.bat" (($r -eq "") -and ([IO.File]::ReadAllText((Join-Path $home1 "install.ps1")) -eq $newPs) -and ([IO.File]::ReadAllText((Join-Path $home1 "Setup.bat")) -eq "new bat"))
  Check "the script it replaced is kept as install.ps1.bak, and nothing else was written" (([IO.File]::ReadAllText((Join-Path $home1 "install.ps1.bak")) -eq $oldPs) -and (@(Get-ChildItem $home1).Count -eq 3))
  Check "the version of a script file can be read" ((Get-ScriptVersion (Join-Path $home1 "install.ps1")) -eq "1.4.0")

  Reset-Folder
  $sum = New-TestZip $zip ([ordered]@{ "install.ps1" = ('$InstallerVersion = "1.4.0"' + "`nif ((( {"); "Setup.bat" = "new bat" })
  $r = Install-Update $zip $sum "1.4.0" $home1
  Check ("a script that does not parse replaces nothing: " + $r) (($r -ne "") -and (Test-Untouched))
  $sum = New-TestZip $zip ([ordered]@{ "install.ps1" = $newPs })
  $r = Install-Update $zip $sum "1.4.0" $home1
  Check ("a download without Setup.bat replaces nothing: " + $r) (($r -ne "") -and (Test-Untouched))
  $sum = New-TestZip $zip ([ordered]@{ "sub/install.ps1" = $newPs; "../install.ps1" = $newPs; "INSTALL.PS1" = $newPs; "Setup.bat" = "new bat" })
  $r = Install-Update $zip $sum "1.4.0" $home1
  Check ("install.ps1 under another path or spelling is not taken: " + $r) (($r -ne "") -and (Test-Untouched))

  Reset-Folder
  $sum = New-TestZip $zip ([ordered]@{ "../evil.ps1" = "evil"; "..\evil2.ps1" = "evil"; "sub/evil.exe" = "evil"; "evil.bat" = "evil"; "install.ps1" = $newPs; "Setup.bat" = "new bat" })
  $r = Install-Update $zip $sum "1.4.0" $home1
  $strays = @(Get-ChildItem $up -Recurse -Force | Where-Object { $_.Name -like "*evil*" })
  Check "whatever else the zip holds stays in the zip" (($r -eq "") -and ($strays.Count -eq 0) -and (@(Get-ChildItem $home1).Count -eq 3))
  $script:UpdatedFrom = "1.3.0"; $script:UpdateProblem = $null
  Check "a report from an updated script says which version fetched it" ((New-Report "ok").updatedFrom -eq "1.3.0")
  $script:UpdatedFrom = $null; $script:UpdateProblem = "could not write C:\Users\" + $script:Personal[0] + "\AppData\Local\DeepslateWorks\install.ps1.new"
  $rp = New-Report "ok"
  Check ("an update that was not applied is in the report, without the name: " + $rp.updateProblem) (($rp.updatedFrom -eq $null) -and ($rp.updateProblem -like "could not write C:\Users\~\*") )
  $script:UpdateProblem = $null

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

  $own = [IO.File]::ReadAllText($PSCommandPath)
  $left = @([regex]::Matches($own, '(?m)^(?!\s*#)(?!.*\[regex\]).*&\s+\$[\w.:]+[^\r\n|]*2>&1')).Count
  Check "no command's stderr is sent through 2>&1 anywhere in this script" ($left -eq 0)

  Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
  if ($script:SelfTestBad -gt 0) { Write-Host ("{0} check(s) failed" -f $script:SelfTestBad) -ForegroundColor Red; exit 1 }
  Write-Host "All checks passed." -ForegroundColor Green
  exit 0
}

Write-Host ("{0} installer ({1})" -f $PackName, $PackVersion) -ForegroundColor White
Log ("=== {0} {1} start ===" -f $PackName, $PackVersion)
$script:CustomRoot = ($Root -ne "")   # a test run: nothing is copied or registered
if ($script:UpdatedFrom) {
  Log ("STEP Updating the installer {0} {1} {2}" -f $script:UpdatedFrom, [char]0x2192, $InstallerVersion)
  Log ("OK installer {0} fetched, checked and started by installer {1}" -f $InstallerVersion, $script:UpdatedFrom)
}
if ($Root -eq "") { $Root = $env:APPDATA }
$Minecraft = Join-Path $Root ".minecraft"
$Profiles = Join-Path $Minecraft "launcher_profiles.json"

try {
  # 1. sign in with Discord through the portal (device-style flow); token remembered for a week.
  #    First, so that whatever goes wrong afterwards can be reported under their name.
  Step "Signing in"
  $token = $null
  $tokenFile = Join-Path (Join-Path $Root ".minecraft-deepslate-works") "launcher.json"
  if (Test-Path -LiteralPath $tokenFile) { try { $token = (Get-Content -LiteralPath $tokenFile -Raw | ConvertFrom-Json).token } catch {} }
  if ($DryRun -and $env:DEEPSLATE_LAUNCHER_TOKEN) { $token = $env:DEEPSLATE_LAUNCHER_TOKEN }   # tests under pwsh on Linux
  $headers = @{}
  if ($token) {
    $headers = @{ Authorization = "Bearer $token" }
    try { $null = Invoke-RestMethod -Uri $ManifestUrl -Headers $headers -UseBasicParsing -TimeoutSec 30; Tick "Still signed in" }
    catch {
      $code = 0; try { $code = [int]$_.Exception.Response.StatusCode } catch {}
      if ($code -eq 401) { $token = $null; Note "Your sign-in expired; signing in again" }
      elseif ($code -eq 403) { Fail (Gate-Message $_) }
      else { Fail ("Couldn't reach {0}. Check your internet, or ask Alex if the site is down." -f $PortalUrl) }
    }
  }
  if (-not $token) {
    if ($DryRun) { Note "(dry run) would open the browser to sign in"; $headers = @{} }
    else {
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
        if ($poll.status -eq "expired") { Fail "The sign-in code expired. Run this again." }
      }
      if (-not $token) { Fail "Timed out waiting for the browser sign-in. Run this again." }
      New-Item -ItemType Directory -Force -Path (Split-Path $tokenFile) | Out-Null
      @{ token = $token; savedAt = (Get-Date).ToString("s") } | ConvertTo-Json | Set-Content -LiteralPath $tokenFile
      $headers = @{ Authorization = "Bearer $token" }
      Tick ("Signed in as {0}" -f $poll.displayName)
    }
  }

  $script:Token = $token

  # 2. launcher present, and closed?
  Step "Checking the Minecraft Launcher"
  if (-not (Test-Path -LiteralPath $Profiles)) {
    $script:Facts.launcher = [ordered]@{ kind = "not found"; version = $null; profilesFormat = $null }
    if (-not $DryRun) { try { Start-Process "https://www.minecraft.net/download" } catch {} }
    Fail "Install the Minecraft Launcher from minecraft.net, open it once, then run this again."
  }
  $script:Facts.launcher = Get-LauncherFacts
  $script:LauncherOpen = $false
  if ($Mode -eq "play") {
    # Pressing Play with the launcher already open is ordinary. The mods can be brought up to date all the
    # same; only NeoForge and the profile need it closed, and they are checked when their turn comes.
    $script:LauncherOpen = (@(Find-Launcher).Count -gt 0)
    if ($script:LauncherOpen) { Log "the launcher is open; carrying on with the mods" }
    Tick "Launcher found"
  } else {
    Require-LauncherClosed "anything is changed"   # asked for before NeoForge and before the profile; said first, so nobody waits through the downloads to hear it
    Tick "Launcher found, and closed"
  }

  # 3. manifest
  Step "Fetching the mod list"
  try { $manifest = Invoke-RestMethod -Uri $ManifestUrl -Headers $headers -UseBasicParsing -TimeoutSec 60 }
  catch {
    $code = 0; try { $code = [int]$_.Exception.Response.StatusCode } catch {}
    if ($code -eq 403) { Fail (Gate-Message $_) }
    if ($code -eq 401 -and $DryRun) { Fail "(dry run) not signed in; the manifest needs a sign-in" }
    Fail ("Couldn't reach {0}. Check your internet, or ask Alex if the site is down." -f $ManifestUrl)
  }
  if ($manifest.version) { $script:PackSeen = [string]$manifest.version }

  # A newer installer on the site? (-Play only.) The new script starts again from the top, with what this one was started with.
  if (Update-Self $manifest $headers) {
    $env:DEEPSLATE_UPDATED_FROM = $InstallerVersion
    $again = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ('"{0}"' -f $PSCommandPath), "-Play")
    if ($FromLink) { $again += $Link }
    else {
      if ($script:CustomRoot) { $again += @("-Root", ('"{0}"' -f $Root)) }
      if ($NoPrompt) { $again += "-NoPrompt" }
    }
    $script:Reported = $true   # the report is the new script's to send
    $child = Start-Process -FilePath ((Get-Process -Id $PID).Path) -ArgumentList $again -Wait -PassThru -NoNewWindow
    exit $child.ExitCode
  }
  $neo = $manifest.neoforge
  $mc = $manifest.minecraft
  $profile = $manifest.profile
  $GameDir = Join-Path $Root $profile.dir
  $files = @($manifest.files | Where-Object { $_.side -ne "server" })
  Tick ("{0} mods for Minecraft {1} / NeoForge {2}" -f $files.Count, $mc, $neo)

  # already up to date?
  $installedFile = Join-Path $GameDir "installed.json"
  $prev = $null
  if (Test-Path -LiteralPath $installedFile) { try { $prev = Get-Content -LiteralPath $installedFile -Raw | ConvertFrom-Json } catch {} }

  # 3. Java 21
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
      if (-not $found) { Fail "Java download didn't work. Run this again, or ask Alex." }
      $java = $found.FullName
      $javaSource = "downloaded on this run"
      Tick "Java 21 downloaded"
    }
  }
  $javaVersion = $null
  if (-not $DryRun) { $javaVersion = Get-JavaVersionText $java }
  $script:Facts.java = [ordered]@{ source = $javaSource; path = [string]$java; version = $javaVersion; passedOver = $javaPassedOver }

  # 4. NeoForge
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
    if (-not (Test-Path -LiteralPath (Join-Path $Minecraft ("versions\{0}" -f $versionId)))) { Fail "NeoForge didn't install. Open the Minecraft Launcher, make sure vanilla 1.21.1 has been run once, then try again." }
    $script:Facts.neoforge.after = $true
    Tick "NeoForge installed"
  }

  # 5. game dir + mods
  Step "Setting up the mods"
  foreach ($d in @("mods", "config", "resourcepacks")) { New-Item -ItemType Directory -Force -Path (Join-Path $GameDir $d) | Out-Null }
  $modsDir = Join-Path $GameDir "mods"
  $sha = [System.Security.Cryptography.SHA512]::Create()
  $keep = @{}
  $i = 0
  foreach ($f in $files) {
    $i++
    $dest = Join-Path $modsDir $f.filename
    $keep[$f.filename] = $true
    $ok = $false
    if (Test-Path -LiteralPath $dest) {
      $hash = [BitConverter]::ToString($sha.ComputeHash([IO.File]::ReadAllBytes($dest))).Replace("-", "").ToLower()
      $ok = ($hash -eq $f.sha512)
    }
    if ($ok) { continue }
    Write-Progress -Activity "Downloading mods" -Status $f.filename -PercentComplete ([int](100 * $i / $files.Count))
    if ($DryRun) { Note ("(dry run) would download {0}" -f $f.filename); continue }
    $tmp = "$dest.part"
    Invoke-WebRequest -Uri $f.url -OutFile $tmp -UseBasicParsing
    $hash = [BitConverter]::ToString($sha.ComputeHash([IO.File]::ReadAllBytes($tmp))).Replace("-", "").ToLower()
    if ($hash -ne $f.sha512) { Remove-Temp $tmp; Fail ("{0} downloaded wrong. Run this again." -f $f.filename) }
    try { Move-Item -Force -LiteralPath $tmp -Destination $dest }
    catch { Log ("could not replace " + $f.filename + ": " + $_.Exception.Message); Remove-Temp $tmp; Fail ("{0} is in use. Close Minecraft (the game, not only the launcher), then try again." -f $f.filename) }
    Log ("downloaded " + $f.filename)
  }
  Write-Progress -Activity "Downloading mods" -Completed
  Get-ChildItem -LiteralPath $modsDir -Filter *.jar | Where-Object { -not $keep[$_.Name] } | ForEach-Object {
    Log ("removing " + $_.Name)
    if (-not $DryRun) {
      $gone = $_.Name
      try { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction Stop }
      catch { Log ("could not remove " + $gone + ": " + $_.Exception.Message); Fail ("{0} is in use. Close Minecraft (the game, not only the launcher), then try again." -f $gone) }
    }
  }
  Tick ("{0} mods in place" -f $files.Count)

  # 6. configs (zip from the site) and options.txt
  Step "Settings"
  if ($manifest.config_url -and -not $DryRun) {
    $cz = Join-Path $Temp "deepslate-config.zip"
    try {
      Invoke-WebRequest -Uri $manifest.config_url -Headers $headers -OutFile $cz -UseBasicParsing
      Expand-Archive -LiteralPath $cz -DestinationPath $GameDir -Force
      Remove-Temp $cz
      Tick "Config files updated"
    } catch { Note "No config files this time" }
  }
  $options = Join-Path $GameDir "options.txt"
  if (-not (Test-Path -LiteralPath $options)) {
    $rd = 8; $sd = 6
    if ($manifest.render_distance) { $rd = [int]$manifest.render_distance }
    if ($manifest.simulation_distance) { $sd = [int]$manifest.simulation_distance }
    if (-not $DryRun) { Set-Content -LiteralPath $options -Value @("renderDistance:$rd", "simulationDistance:$sd", "fullscreen:false") }
    Tick ("Render distance set to {0}" -f $rd)
  } else { Tick "Kept your existing settings" }

  # 7. servers.dat (uncompressed NBT, one entry)
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

  # 8. RAM + launcher profile
  Step "Adding the launcher profile"
  $totalGb = 8
  try { $totalGb = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB) } catch {}
  $xmx = 3
  if ($totalGb -ge 16) { $xmx = 6 } elseif ($totalGb -ge 12) { $xmx = 5 } elseif ($totalGb -ge 8) { $xmx = 4 }
  $xmx = [math]::Max($manifest.ram.min_gb, [math]::Min($manifest.ram.max_gb, $xmx))
  $javaArgs = "-Xmx${xmx}G -Xms1G -XX:+UseG1GC -XX:+UnlockExperimentalVMOptions -XX:MaxGCPauseMillis=50 -XX:G1NewSizePercent=20 -XX:G1ReservePercent=20"
  $now = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
  $entry = [ordered]@{ name = $PackName; type = "custom"; lastVersionId = $versionId; gameDir = $GameDir; javaArgs = $javaArgs; javaDir = $java; icon = $profile.icon; created = $now; lastUsed = $now }
  $profileSaved = $false
  $profileLeft = $false
  if ($Mode -eq "play" -and -not $DryRun -and @(Find-Launcher).Count -gt 0 -and (Test-LauncherProfile $Profiles $profile.id $versionId) -eq "") {
    # Launcher open, profile already there and pointing at the right NeoForge: nothing to write.
    $profileLeft = $true
    $profileSaved = $true
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
      Write-Host "   Close the Minecraft Launcher completely (also its icon next to the clock), then run this again." -ForegroundColor Yellow
      Write-Host "   The mods are in place; only the profile is missing." -ForegroundColor Gray
      Write-Host ("   Log file: {0}" -f $LogFile) -ForegroundColor White
      Log "FAIL the launcher profile was not saved"
      Send-Report "failed"
      Hold-Window
      exit 1
    }
    $profileSaved = $true
  }
  if ($profileLeft) { Tick ("Profile '{0}' is already in the launcher" -f $PackName) }
  else { Tick ("Profile '{0}' with {1} GB of RAM (your PC has {2} GB), saved and checked" -f $PackName, $xmx, $totalGb) }

  # 9. the Play button on the site
  if ($profileSaved) {
    Step "Setting up the Play button"
    $linked = $false
    try { $linked = Install-Self } catch { Log ("could not set up the Play button: " + $_.Exception.Message) }
    if ($linked) { Tick "The Play button on the site now starts the game on this PC" }
    else { Note "The Play button was not set up this time; Update and Play.bat does the same job" }
  }

  if (-not $DryRun) { @{ version = $script:PackSeen; installedAt = $now; hash = $manifest.hash } | ConvertTo-Json | Set-Content -LiteralPath $installedFile }

  Write-Host ""
  if ($prev -and $prev.hash -eq $manifest.hash) { Write-Host "Already up to date." -ForegroundColor Green }
  elseif ($Quiet -and $prev) { Write-Host ("Updated to {0}." -f $script:PackSeen) -ForegroundColor Green }
  if (-not $Quiet) { Write-Host ("Server address: {0}" -f $manifest.server_address) -ForegroundColor White }
  if ($DryRun) {
    Write-Host ("(dry run) Done. Nothing was changed." ) -ForegroundColor Green
  } elseif ($Play) {
    if ($profileLeft) { Write-Host ("The Minecraft Launcher is already open. Choose {0} next to Play, then press Play." -f $PackName) -ForegroundColor Green }
    else { Write-Host ("Opening the Minecraft Launcher on {0}. Press Play." -f $PackName) -ForegroundColor Green }
    if (-not (Open-Launcher)) { Write-Host "Couldn't find the launcher automatically; open it from the Start menu." -ForegroundColor Yellow }
    Start-Sleep -Seconds 2
  } else {
    Write-Host ("Done. '{0}' is in the Minecraft Launcher, next to the Play button." -f $PackName) -ForegroundColor Green
    $open = $false
    if ($profileSaved -and -not $NoPrompt) {
      $answer = "n"
      try { $answer = Read-Host "Open the Minecraft Launcher now? [Y/n]" } catch { $answer = "n" }   # no console to ask on: don't
      $open = ($answer -eq $null -or $answer.Trim() -eq "" -or $answer.Trim() -match '^(y|yes)$')
    }
    if ($open) {
      if (Open-Launcher) { Write-Host ("Choose {0} next to Play, then press Play." -f $PackName) -ForegroundColor Green }
      else { Write-Host "Couldn't find the launcher automatically; open it from the Start menu." -ForegroundColor Yellow }
    } else {
      Write-Host ("Open the Minecraft Launcher, choose {0}, press Play." -f $PackName) -ForegroundColor Green
    }
    Write-Host ("Next time, press Play on {0}: it checks for updates and opens the launcher for you." -f $PortalUrl.Replace("https://", "")) -ForegroundColor Gray
  }
  Log "=== done ==="
  $script:StepName = ""
  Send-Report "ok"
} catch {
  Log ($_ | Out-String)
  Fail "Something went wrong. Send Alex the log file and he'll sort it."
} finally {
  # Reached without a report having gone: the window was closed or Ctrl+C was pressed part-way.
  if (-not $script:Reported) { Log "stopped before the end"; Send-Report "cancelled" }
}

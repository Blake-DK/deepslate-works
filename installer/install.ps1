# Deepslate Works client installer. PowerShell 5.1, no modules, no admin rights. See docs/07-installer.md.
param(
  [switch]$DryRun,          # no downloads, no writes outside -Root, no browser
  [switch]$Play,            # after updating: open the Minecraft Launcher on our profile and exit
  [string]$Root = "",       # override %APPDATA% (tests)
  [switch]$NoPrompt,        # never ask anything at the end (automation)
  [switch]$SelfTest,        # check the launcher-profile code against a scratch file, touch nothing else, exit
  [string[]]$PretendRunning = @()   # tests: process names to treat as running
)
# ---- config block (stamped by `modpack build installer`) ----
$PortalUrl = "https://deepslate.dsw.test"
$PackName = "Deepslate Works"
$PackVersion = "dev"
# -------------------------------------------------------------
$InstallerVersion = "1.2.0"   # 1.1.0: launcher must be closed, profile read back; 1.2.0: install report
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
$script:Facts = @{ java = $null; neoforge = $null; launcher = $null }
# Words that would identify the person or the PC. They are blanked in everything that is sent.
$script:Personal = @(@($env:USERNAME, [Environment]::UserName, $env:COMPUTERNAME, [Environment]::MachineName) | Where-Object { $_ -and ([string]$_).Length -ge 3 } | Select-Object -Unique)

function Log($msg) {
  $line = "[{0}] {1}" -f (Get-Date -Format s), $msg
  $script:RunLog.Add($line)
  try { Add-Content -Path $LogFile -Value $line } catch {}
}
function Step($msg) { $script:Step++; $script:StepName = [string]$msg; Write-Host ("`n{0}. {1}" -f $script:Step, $msg) -ForegroundColor Cyan; Log "STEP $msg" }
function Tick($msg) { Write-Host ("   [OK] {0}" -f $msg) -ForegroundColor Green; Log "OK $msg" }
function Note($msg) { Write-Host ("   {0}" -f $msg) -ForegroundColor Gray; Log $msg }
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
  return [ordered]@{
    packVersion      = [string]$script:PackSeen
    installerVersion = $InstallerVersion
    outcome          = $outcome
    failedStep       = $failed
    durationSec      = [int]((Get-Date) - $script:Started).TotalSeconds
    log              = Shorten (Redact (($script:RunLog.ToArray()) -join "`n") -Addresses) (512 * 1024)
    system           = Redact-Tree (Get-SystemInfo)
  }
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
    $null = Invoke-RestMethod -Uri "$PortalUrl/api/installer/report" -Method Post -Headers @{ Authorization = "Bearer $($script:Token)" } -ContentType "application/json; charset=utf-8" -Body ([Text.Encoding]::UTF8.GetBytes($json)) -UseBasicParsing -TimeoutSec 20
    Write-Host "   Sent." -ForegroundColor Gray
    Log "install report sent"
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
  Move-Item -Force -Path $tmp -Destination $path
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
  Copy-Item -Path $path -Destination "$path.bak" -Force
  Write-Json $path $json
}

# "" when the profile is there and points at the right version; otherwise what is wrong, in words.
function Test-LauncherProfile($path, $id, $versionId) {
  if (-not (Test-Path $path)) { return "launcher_profiles.json is gone" }
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
  foreach ($exe in @("$env:ProgramFiles(x86)\Minecraft Launcher\MinecraftLauncher.exe", "$env:ProgramFiles\Minecraft Launcher\MinecraftLauncher.exe", "$env:LOCALAPPDATA\Programs\Minecraft Launcher\MinecraftLauncher.exe")) {
    try { if (Test-Path $exe) { $f.kind = "classic"; if (-not $f.version) { $f.version = [string](Get-Item $exe).VersionInfo.ProductVersion }; return $f } } catch {}
  }
  try { $pkg = Get-AppxPackage -Name "Microsoft.4297127D64EC6" -ErrorAction Stop; if ($pkg) { $f.kind = "store"; if (-not $f.version) { $f.version = [string]$pkg.Version } } } catch {}
  return $f
}

function Open-Launcher {
  Log "launching"
  foreach ($exe in @("$env:ProgramFiles(x86)\Minecraft Launcher\MinecraftLauncher.exe", "$env:ProgramFiles\Minecraft Launcher\MinecraftLauncher.exe", "$env:LOCALAPPDATA\Programs\Minecraft Launcher\MinecraftLauncher.exe")) {
    if (Test-Path $exe) { Start-Process $exe; return $true }
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
  $script:Token = $null

  Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
  if ($script:SelfTestBad -gt 0) { Write-Host ("{0} check(s) failed" -f $script:SelfTestBad) -ForegroundColor Red; exit 1 }
  Write-Host "All checks passed." -ForegroundColor Green
  exit 0
}

Write-Host ("{0} installer ({1})" -f $PackName, $PackVersion) -ForegroundColor White
Log ("=== {0} {1} start ===" -f $PackName, $PackVersion)
if ($Root -eq "") { $Root = $env:APPDATA }
$Minecraft = Join-Path $Root ".minecraft"
$Profiles = Join-Path $Minecraft "launcher_profiles.json"

try {
  # 1. sign in with Discord through the portal (device-style flow); token remembered for a week.
  #    First, so that whatever goes wrong afterwards can be reported under their name.
  Step "Signing in"
  $token = $null
  $tokenFile = Join-Path (Join-Path $Root ".minecraft-deepslate-works") "launcher.json"
  if (Test-Path $tokenFile) { try { $token = (Get-Content $tokenFile -Raw | ConvertFrom-Json).token } catch {} }
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
      @{ token = $token; savedAt = (Get-Date).ToString("s") } | ConvertTo-Json | Set-Content -Path $tokenFile
      $headers = @{ Authorization = "Bearer $token" }
      Tick ("Signed in as {0}" -f $poll.displayName)
    }
  }

  $script:Token = $token

  # 2. launcher present, and closed?
  Step "Checking the Minecraft Launcher"
  if (-not (Test-Path $Profiles)) {
    $script:Facts.launcher = [ordered]@{ kind = "not found"; version = $null; profilesFormat = $null }
    if (-not $DryRun) { try { Start-Process "https://www.minecraft.net/download" } catch {} }
    Fail "Install the Minecraft Launcher from minecraft.net, open it once, then run this again."
  }
  $script:Facts.launcher = Get-LauncherFacts
  Require-LauncherClosed "anything is changed"   # asked for before NeoForge and before the profile; said first, so nobody waits through the downloads to hear it
  Tick "Launcher found, and closed"

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
  $neo = $manifest.neoforge
  $mc = $manifest.minecraft
  $profile = $manifest.profile
  $GameDir = Join-Path $Root $profile.dir
  $files = @($manifest.files | Where-Object { $_.side -ne "server" })
  Tick ("{0} mods for Minecraft {1} / NeoForge {2}" -f $files.Count, $mc, $neo)

  # already up to date?
  $installedFile = Join-Path $GameDir "installed.json"
  $prev = $null
  if (Test-Path $installedFile) { try { $prev = Get-Content $installedFile -Raw | ConvertFrom-Json } catch {} }

  # 3. Java 21
  Step "Finding Java 21"
  $java = $null
  $bundled = Join-Path $Minecraft "runtime\java-runtime-delta\windows-x64\java-runtime-delta\bin\java.exe"
  $javaSource = $null
  if (Test-Path $bundled) { $java = $bundled; $javaSource = "the launcher's own"; Tick "Using the launcher's own Java" }
  if (-not $java) {
    $cmd = Get-Command java -ErrorAction SilentlyContinue
    if ($cmd) {
      $ver = (& $cmd.Source -version 2>&1 | Select-Object -First 1) -replace '[^0-9.]', ' '
      $major = [int](($ver.Trim() -split '[ .]')[0])
      if ($major -ge 21) { $java = $cmd.Source; $javaSource = "on PATH"; Tick ("Using Java {0} from PATH" -f $major) }
    }
  }
  if (-not $java) {
    $jreDir = Join-Path $GameDir "runtime"
    $found = Get-ChildItem -Path $jreDir -Filter java.exe -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($found) { $java = $found.FullName; $javaSource = "downloaded on an earlier run"; Tick "Using the Java we downloaded last time" }
  }
  if (-not $java) {
    if ($DryRun) { $java = "java"; Note "(dry run) would download Temurin 21" }
    else {
      Note "Downloading Java 21 (about 45 MB), one time only"
      New-Item -ItemType Directory -Force -Path (Join-Path $GameDir "runtime") | Out-Null
      $zip = Join-Path $Temp "temurin21.zip"
      Invoke-WebRequest -Uri "https://api.adoptium.net/v3/binary/latest/21/ga/windows/x64/jre/hotspot/normal/eclipse" -OutFile $zip -UseBasicParsing
      Expand-Archive -Path $zip -DestinationPath (Join-Path $GameDir "runtime") -Force
      Remove-Item $zip -Force
      $found = Get-ChildItem -Path (Join-Path $GameDir "runtime") -Filter java.exe -Recurse | Select-Object -First 1
      if (-not $found) { Fail "Java download didn't work. Run this again, or ask Alex." }
      $java = $found.FullName
      $javaSource = "downloaded on this run"
      Tick "Java 21 downloaded"
    }
  }
  $javaVersion = $null
  if (-not $DryRun) { try { $javaVersion = [string](& $java -version 2>&1 | Select-Object -First 1) } catch {} }
  $script:Facts.java = [ordered]@{ source = $javaSource; path = [string]$java; version = $javaVersion }

  # 4. NeoForge
  Step ("Installing NeoForge {0}" -f $neo)
  $versionId = "neoforge-$neo"
  $neoBefore = Test-Path (Join-Path $Minecraft ("versions\{0}" -f $versionId))
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
    Get-Content (Join-Path $Temp "neoforge-install.out") -ErrorAction SilentlyContinue | ForEach-Object { Log ("neoforge: " + $_) }
    Remove-Item $jar -Force -ErrorAction SilentlyContinue
    if (-not (Test-Path (Join-Path $Minecraft ("versions\{0}" -f $versionId)))) { Fail "NeoForge didn't install. Open the Minecraft Launcher, make sure vanilla 1.21.1 has been run once, then try again." }
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
    if (Test-Path $dest) {
      $hash = [BitConverter]::ToString($sha.ComputeHash([IO.File]::ReadAllBytes($dest))).Replace("-", "").ToLower()
      $ok = ($hash -eq $f.sha512)
    }
    if ($ok) { continue }
    Write-Progress -Activity "Downloading mods" -Status $f.filename -PercentComplete ([int](100 * $i / $files.Count))
    if ($DryRun) { Note ("(dry run) would download {0}" -f $f.filename); continue }
    $tmp = "$dest.part"
    Invoke-WebRequest -Uri $f.url -OutFile $tmp -UseBasicParsing
    $hash = [BitConverter]::ToString($sha.ComputeHash([IO.File]::ReadAllBytes($tmp))).Replace("-", "").ToLower()
    if ($hash -ne $f.sha512) { Remove-Item $tmp -Force; Fail ("{0} downloaded wrong. Run this again." -f $f.filename) }
    Move-Item -Force $tmp $dest
    Log ("downloaded " + $f.filename)
  }
  Write-Progress -Activity "Downloading mods" -Completed
  Get-ChildItem -Path $modsDir -Filter *.jar | Where-Object { -not $keep[$_.Name] } | ForEach-Object { Log ("removing " + $_.Name); if (-not $DryRun) { Remove-Item $_.FullName -Force } }
  Tick ("{0} mods in place" -f $files.Count)

  # 6. configs (zip from the site) and options.txt
  Step "Settings"
  if ($manifest.config_url -and -not $DryRun) {
    $cz = Join-Path $Temp "deepslate-config.zip"
    try {
      Invoke-WebRequest -Uri $manifest.config_url -Headers $headers -OutFile $cz -UseBasicParsing
      Expand-Archive -Path $cz -DestinationPath $GameDir -Force
      Remove-Item $cz -Force
      Tick "Config files updated"
    } catch { Note "No config files this time" }
  }
  $options = Join-Path $GameDir "options.txt"
  if (-not (Test-Path $options)) {
    $rd = 8; $sd = 6
    if ($manifest.render_distance) { $rd = [int]$manifest.render_distance }
    if ($manifest.simulation_distance) { $sd = [int]$manifest.simulation_distance }
    if (-not $DryRun) { Set-Content -Path $options -Value @("renderDistance:$rd", "simulationDistance:$sd", "fullscreen:false") }
    Tick ("Render distance set to {0}" -f $rd)
  } else { Tick "Kept your existing settings" }

  # 7. servers.dat (uncompressed NBT, one entry)
  $serversDat = Join-Path $GameDir "servers.dat"
  if (-not (Test-Path $serversDat) -and -not $DryRun) {
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
  if ($DryRun) { Note "(dry run) would write the profile to launcher_profiles.json" }
  else {
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
      exit 1
    }
    $profileSaved = $true
  }
  Tick ("Profile '{0}' with {1} GB of RAM (your PC has {2} GB), saved and checked" -f $PackName, $xmx, $totalGb)

  if (-not $DryRun) { @{ version = $PackVersion; installedAt = $now; hash = $manifest.hash } | ConvertTo-Json | Set-Content -Path $installedFile }

  Write-Host ""
  if ($prev -and $prev.hash -eq $manifest.hash) { Write-Host "Already up to date." -ForegroundColor Green }
  Write-Host ("Server address: {0}" -f $manifest.server_address) -ForegroundColor White
  if ($DryRun) {
    Write-Host ("(dry run) Done. Nothing was changed." ) -ForegroundColor Green
  } elseif ($Play) {
    Write-Host ("Opening the Minecraft Launcher on {0}. Press Play." -f $PackName) -ForegroundColor Green
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

# Deepslate Works client installer. PowerShell 5.1, no modules, no admin rights. See docs/07-installer.md.
param(
  [switch]$DryRun,          # no downloads, no writes outside -Root, no browser
  [switch]$Play,            # after updating: open the Minecraft Launcher on our profile and exit
  [string]$Root = ""        # override %APPDATA% (tests)
)
# ---- config block (stamped by `modpack build installer`) ----
$PortalUrl = "https://deepslate.dsw.test"
$PackName = "Deepslate Works"
$PackVersion = "dev"
# -------------------------------------------------------------
$ManifestUrl = "$PortalUrl/api/modpack/manifest"

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Temp = if ($env:TEMP) { $env:TEMP } else { [IO.Path]::GetTempPath() }   # $env:TEMP is unset when testing under pwsh on Linux
$LogFile = Join-Path $Temp "deepslate-install.log"
$script:Step = 0

function Log($msg) { Add-Content -Path $LogFile -Value ("[{0}] {1}" -f (Get-Date -Format s), $msg) }
function Step($msg) { $script:Step++; Write-Host ("`n{0}. {1}" -f $script:Step, $msg) -ForegroundColor Cyan; Log "STEP $msg" }
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
  exit 1
}

Write-Host ("{0} installer ({1})" -f $PackName, $PackVersion) -ForegroundColor White
Log ("=== {0} {1} start ===" -f $PackName, $PackVersion)
if ($Root -eq "") { $Root = $env:APPDATA }
$Minecraft = Join-Path $Root ".minecraft"
$Profiles = Join-Path $Minecraft "launcher_profiles.json"

try {
  # 1. launcher present?
  Step "Checking the Minecraft Launcher"
  if (-not (Test-Path $Profiles)) {
    if (-not $DryRun) { Start-Process "https://www.minecraft.net/download" }
    Fail "Install the Minecraft Launcher from minecraft.net, open it once, then run this again."
  }
  Tick "Launcher found"

  # 2. sign in with Discord through the portal (device-style flow); token remembered for a week
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

  # 3. manifest
  Step "Fetching the mod list"
  try { $manifest = Invoke-RestMethod -Uri $ManifestUrl -Headers $headers -UseBasicParsing -TimeoutSec 60 }
  catch {
    $code = 0; try { $code = [int]$_.Exception.Response.StatusCode } catch {}
    if ($code -eq 403) { Fail (Gate-Message $_) }
    if ($code -eq 401 -and $DryRun) { Fail "(dry run) not signed in; the manifest needs a sign-in" }
    Fail ("Couldn't reach {0}. Check your internet, or ask Alex if the site is down." -f $ManifestUrl)
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
  if (Test-Path $installedFile) { try { $prev = Get-Content $installedFile -Raw | ConvertFrom-Json } catch {} }

  # 3. Java 21
  Step "Finding Java 21"
  $java = $null
  $bundled = Join-Path $Minecraft "runtime\java-runtime-delta\windows-x64\java-runtime-delta\bin\java.exe"
  if (Test-Path $bundled) { $java = $bundled; Tick "Using the launcher's own Java" }
  if (-not $java) {
    $cmd = Get-Command java -ErrorAction SilentlyContinue
    if ($cmd) {
      $ver = (& $cmd.Source -version 2>&1 | Select-Object -First 1) -replace '[^0-9.]', ' '
      $major = [int](($ver.Trim() -split '[ .]')[0])
      if ($major -ge 21) { $java = $cmd.Source; Tick ("Using Java {0} from PATH" -f $major) }
    }
  }
  if (-not $java) {
    $jreDir = Join-Path $GameDir "runtime"
    $found = Get-ChildItem -Path $jreDir -Filter java.exe -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($found) { $java = $found.FullName; Tick "Using the Java we downloaded last time" }
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
      Tick "Java 21 downloaded"
    }
  }

  # 4. NeoForge
  Step ("Installing NeoForge {0}" -f $neo)
  $versionId = "neoforge-$neo"
  if (Test-Path (Join-Path $Minecraft ("versions\{0}" -f $versionId))) { Tick "Already installed" }
  elseif ($DryRun) { Note "(dry run) would run the NeoForge installer" }
  else {
    $jar = Join-Path $Temp ("neoforge-{0}-installer.jar" -f $neo)
    Invoke-WebRequest -Uri ("https://maven.neoforged.net/releases/net/neoforged/neoforge/{0}/neoforge-{0}-installer.jar" -f $neo) -OutFile $jar -UseBasicParsing
    $p = Start-Process -FilePath $java -ArgumentList @("-jar", "`"$jar`"", "--install-client", "`"$Minecraft`"") -Wait -PassThru -NoNewWindow -RedirectStandardOutput (Join-Path $Temp "neoforge-install.out")
    if ($p.ExitCode -ne 0) {
      $p = Start-Process -FilePath $java -ArgumentList @("-jar", "`"$jar`"", "--installClient", "`"$Minecraft`"") -Wait -PassThru -NoNewWindow -RedirectStandardOutput (Join-Path $Temp "neoforge-install.out")
    }
    Get-Content (Join-Path $Temp "neoforge-install.out") -ErrorAction SilentlyContinue | ForEach-Object { Log ("neoforge: " + $_) }
    Remove-Item $jar -Force -ErrorAction SilentlyContinue
    if (-not (Test-Path (Join-Path $Minecraft ("versions\{0}" -f $versionId)))) { Fail "NeoForge didn't install. Open the Minecraft Launcher, make sure vanilla 1.21.1 has been run once, then try again." }
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
  $raw = Get-Content $Profiles -Raw
  $json = $raw | ConvertFrom-Json
  $now = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
  $entry = [ordered]@{ name = $PackName; type = "custom"; lastVersionId = $versionId; gameDir = $GameDir; javaArgs = $javaArgs; javaDir = $java; icon = $profile.icon; created = $now; lastUsed = $now }
  if ($json.profiles.PSObject.Properties[$profile.id]) {
    $entry.created = $json.profiles.($profile.id).created
    $json.profiles.PSObject.Properties.Remove($profile.id)
  }
  $json.profiles | Add-Member -NotePropertyName $profile.id -NotePropertyValue ([pscustomobject]$entry)
  if ($json.PSObject.Properties["selectedProfile"]) { $json.selectedProfile = $profile.id } else { $json | Add-Member -NotePropertyName selectedProfile -NotePropertyValue $profile.id }
  if (-not $DryRun) {
    Copy-Item $Profiles "$Profiles.bak" -Force
    $json | ConvertTo-Json -Depth 10 | Set-Content -Path $Profiles -Encoding UTF8
  }
  Tick ("Profile '{0}' with {1} GB of RAM (your PC has {2} GB)" -f $PackName, $xmx, $totalGb)

  if (-not $DryRun) { @{ version = $PackVersion; installedAt = $now; hash = $manifest.hash } | ConvertTo-Json | Set-Content -Path $installedFile }

  Write-Host ""
  if ($prev -and $prev.hash -eq $manifest.hash) { Write-Host "Already up to date." -ForegroundColor Green }
  Write-Host ("Server address: {0}" -f $manifest.server_address) -ForegroundColor White
  if ($Play -and -not $DryRun) {
    Write-Host ("Opening the Minecraft Launcher on {0}. Press Play." -f $PackName) -ForegroundColor Green
    Log "launching"
    $launched = $false
    foreach ($exe in @("$env:ProgramFiles(x86)\Minecraft Launcher\MinecraftLauncher.exe", "$env:ProgramFiles\Minecraft Launcher\MinecraftLauncher.exe", "$env:LOCALAPPDATA\Programs\Minecraft Launcher\MinecraftLauncher.exe")) {
      if (Test-Path $exe) { Start-Process $exe; $launched = $true; break }
    }
    if (-not $launched) {
      try { Start-Process "shell:AppsFolder\Microsoft.4297127D64EC6_8wekyb3d8bbwe!Minecraft"; $launched = $true } catch {}   # Microsoft Store launcher
    }
    if (-not $launched) { try { Start-Process "minecraft://"; $launched = $true } catch {} }
    if (-not $launched) { Write-Host "Couldn't find the launcher automatically; open it from the Start menu." -ForegroundColor Yellow }
    Start-Sleep -Seconds 2
  } else {
    Write-Host ("Done. Open the Minecraft Launcher, choose {0}, press Play." -f $PackName) -ForegroundColor Green
  }
  Log "=== done ==="
} catch {
  Log ($_ | Out-String)
  Fail "Something went wrong. Send Alex the log file and he'll sort it."
}

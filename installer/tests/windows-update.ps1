# The reopening day on a real Windows desktop (GitHub's windows runner, .github/workflows/installer.yml, job update):
# the real app 3.5.5 (built from its own commit) on a PC that has it, the site offering the new app. It must update
# itself, carry on as the new version, remove the jars the mod list no longer has and report as the new version.
#
# Both exes are built in this job with the stand-in site's address built in (http://127.0.0.1:47555): an app that
# updates itself restarts without -Root, so a -Root run could not follow it. The runner's own profile is the PC; it
# is thrown away with the runner. The real site is never asked. Exit 1 when a check fails.
param([Parameter(Mandatory = $true)][string]$Old, [Parameter(Mandatory = $true)][string]$New, [string]$Out = "shots", [int]$Port = 47555)
$ErrorActionPreference = "Stop"
$Shots = Join-Path $Out "update"
[void][IO.Directory]::CreateDirectory($Shots)
$Shots = (Resolve-Path $Shots).Path
$Old = (Resolve-Path $Old).Path; $New = (Resolve-Path $New).Path
$bad = 0
function Check($name, $ok) { if ($ok) { Write-Host "  [OK] $name" } else { Write-Host "  [FAIL] $name"; $script:bad++ } }
Add-Type -AssemblyName System.Drawing, System.Windows.Forms, UIAutomationClient, UIAutomationTypes
function Ver([string]$exe) { ((Get-Item $exe).VersionInfo.ProductVersion -split '\+')[0] }
$oldVer = Ver $Old; $newVer = Ver $New
Write-Host "old app $oldVer, new app $newVer"
Check "the old exe is 3.5.5" ($oldVer -eq "3.5.5")

# ---- the PC: what 3.5.5 left on it ------------------------------------------------------------------------------------
$appHome = Join-Path $env:LOCALAPPDATA "DeepslateWorks"
$roaming = $env:APPDATA
$game = Join-Path $roaming ".minecraft-deepslate-works"
$mc = Join-Path $roaming ".minecraft"
foreach ($d in @($appHome, (Join-Path $game "mods"), (Join-Path $mc "versions\neoforge-21.1.252"))) { [void][IO.Directory]::CreateDirectory($d) }
[IO.File]::WriteAllText((Join-Path $mc "launcher_profiles.json"), '{"profiles":{},"settings":{},"version":3}')
[IO.File]::WriteAllText((Join-Path $game "launcher.json"), '{"token":"update-test-token-0123456789","savedAt":"2026-10-09T12:00:00"}')
[IO.File]::WriteAllText((Join-Path $game "options.txt"), "renderDistance:12`r`n")
$kept = [Text.Encoding]::ASCII.GetBytes("a mod the pack still has")
$keptSha = (Get-FileHash -InputStream (New-Object IO.MemoryStream(,$kept)) -Algorithm SHA512).Hash.ToLower()
[IO.File]::WriteAllBytes((Join-Path $game "mods\kept-1.0.jar"), $kept)
[IO.File]::WriteAllText((Join-Path $game "mods\removed-boss-1.0.jar"), "a mod the pack no longer has")
[IO.File]::WriteAllText((Join-Path $game "installed.json"), '{"version":"0.1.0+old","hash":"old","renderDistance":12}')
$steps = [ordered]@{}; foreach ($s in @("signin", "launcher", "java", "neoforge", "mods", "profile", "shortcuts", "reports", "extras")) { $steps[$s] = [ordered]@{ answer = "allow"; level = 2; at = "2026-10-09T12:00:00" } }
[IO.File]::WriteAllText((Join-Path $appHome "consent.json"), (ConvertTo-Json -InputObject ([ordered]@{ version = 1; steps = $steps }) -Depth 4))
[IO.File]::WriteAllText((Join-Path $appHome "settings.json"), '{"version":2,"websitePlay":"wait"}')
$homeExe = Join-Path $appHome "DeepslateWorks.exe"
Copy-Item $Old $homeExe -Force

# ---- the stand-in site: the new app on offer ----------------------------------------------------------------------------
$work = Join-Path $env:TEMP "update-site"; Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue; [void][IO.Directory]::CreateDirectory($work)
$reports = Join-Path $work "reports.txt"; $requests = Join-Path $work "requests.txt"
$newSha = (Get-FileHash $New -Algorithm SHA256).Hash.ToLower(); $newSize = (Get-Item $New).Length
$manifest = ConvertTo-Json -Depth 6 -InputObject ([ordered]@{
  name = "Deepslate Works"; version = "0.1.0+new"; hash = "new"; minecraft = "1.21.1"; neoforge = "21.1.252"; server_address = "mc.dsw.test"
  profile = [ordered]@{ id = "deepslate-works"; dir = ".minecraft-deepslate-works"; icon = "Furnace" }
  ram = [ordered]@{ min_gb = 3; max_gb = 6; user_max_gb = 12 }; render_distance = 10; simulation_distance = 8; server_view_distance = 12; tier = "MID"
  config_url = $null; configs = @(); branding = $null
  files = @([ordered]@{ slug = "kept"; name = "Kept"; filename = "kept-1.0.jar"; url = "http://127.0.0.1:$Port/files/kept-1.0.jar"; sha512 = $keptSha; size = $kept.Length; side = "both" })
  installer = [ordered]@{ exe = [ordered]@{ version = $newVer; sha256 = $newSha; size = $newSize } } })
[IO.File]::WriteAllText((Join-Path $work "manifest.json"), $manifest)
[IO.File]::WriteAllBytes((Join-Path $work "kept-1.0.jar"), $kept)
$siteJob = Start-Job -ArgumentList "http://127.0.0.1:$Port/", $work, $New, $requests, $reports -ScriptBlock {
  param($prefix, $work, $newExe, $requests, $reports)
  $l = New-Object Net.HttpListener; $l.Prefixes.Add($prefix); $l.Start()
  while ($true) {
    $c = $l.GetContext(); $p = $c.Request.Url.AbsolutePath; $code = 404; $body = '{"error":{"code":"not_here"}}'; $bytes = $null; $type = "application/json"
    [IO.File]::AppendAllText($requests, $c.Request.HttpMethod + " " + $p + "`n")
    switch -regex ($p) {
      '^/api/modpack/manifest$' { $code = 200; $body = [IO.File]::ReadAllText((Join-Path $work "manifest.json")) }
      '^/downloads/DeepslateWorks\.exe$' { $code = 200; $bytes = [IO.File]::ReadAllBytes($newExe); $type = "application/octet-stream" }
      '^/files/kept-1\.0\.jar$' { $code = 200; $bytes = [IO.File]::ReadAllBytes((Join-Path $work "kept-1.0.jar")); $type = "application/java-archive" }
      '^/api/app/home$' { $code = 200; $body = '{"signedIn":true,"site":"http://127.0.0.1","name":"Bramble09","admin":false,"server":{"state":"online","line":"Online, nobody on","label":"Online","tone":"good","hint":"","wake":{"phase":"idle"},"canStart":false},"online":[],"players":[],"news":null,"votes":{"polls":[],"ballot":null,"order":[],"button":"Vote first"}}' }
      '^/api/play/wake$' { $code = 200; $body = '{"result":"awake"}' }
      '^/api/installer/report$' { $r = New-Object IO.StreamReader($c.Request.InputStream, [Text.Encoding]::UTF8); [IO.File]::AppendAllText($reports, $r.ReadToEnd() + "`n"); $code = 200; $body = '{"ok":true}' }
    }
    if (-not $bytes) { $bytes = [Text.Encoding]::UTF8.GetBytes($body) }
    $c.Response.StatusCode = $code; $c.Response.ContentType = $type; $c.Response.OutputStream.Write($bytes, 0, $bytes.Length); $c.Response.Close()
  }
}
Start-Sleep -Seconds 3

$log = Join-Path $env:TEMP "deepslate-works.log"
Remove-Item $log -Force -ErrorAction SilentlyContinue
function Log-Text { if (Test-Path $log) { $fs = [IO.File]::Open($log, 'Open', 'Read', 'ReadWrite'); $t = (New-Object IO.StreamReader($fs)).ReadToEnd(); $fs.Close(); return $t } return "" }
function Wait-Log([string]$pattern, [int]$sec) { for ($i = 0; $i -lt $sec; $i++) { if ((Log-Text) -match $pattern) { return $true }; Start-Sleep -Seconds 1 }; return $false }
function Shot([string]$name) {
  try { $b = [Windows.Forms.SystemInformation]::VirtualScreen; $bmp = New-Object Drawing.Bitmap $b.Width, $b.Height; $g = [Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.Left, $b.Top, 0, 0, $bmp.Size); $g.Dispose(); $bmp.Save((Join-Path $Shots $name), [Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose(); Write-Host "  picture: update/$name" } catch {}
}
$savedPath = $env:PATH
if ($env:JAVA_HOME_21_X64) { $env:PATH = (Join-Path $env:JAVA_HOME_21_X64 "bin") + ";" + $env:PATH }
try {
  Write-Host "The app 3.5.5 opened from the desktop, the site offering $newVer"
  Start-Process -FilePath $homeExe -ArgumentList @("-From", "desktop") | Out-Null
  Check "3.5.5 started its run" (Wait-Log 'Deepslate Works 3\.5\.5 .* start' 90)
  Check "it saw the new app and updated itself" (Wait-Log ("Updating Deepslate Works 3\.5\.5 .* " + [regex]::Escape($newVer)) 120)
  Shot "1-updating.png"
  Check ("the new copy carried on: " + $newVer + " fetched, checked and started by 3.5.5") (Wait-Log ([regex]::Escape($newVer) + " fetched, checked and started by 3\.5\.5|Updated to " + [regex]::Escape($newVer)) 180)
  Check "the new copy got the game ready" (Wait-Log 'ready: waiting for the window to start the game' 240)
  Start-Sleep -Seconds 3
  Shot "2-updated-ready.png"
  Check ("the app in its home folder is now " + (Ver $homeExe)) ((Ver $homeExe) -eq $newVer)
  Check "the jar the mod list no longer has is gone" (-not (Test-Path (Join-Path $game "mods\removed-boss-1.0.jar")))
  Check "the jar the mod list has is still there" (Test-Path (Join-Path $game "mods\kept-1.0.jar"))
  # Play, as the player would press it
  $w = @(Get-Process DeepslateWorks -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 })[0]
  $pressed = $false
  if ($w) {
    $root = [Windows.Automation.AutomationElement]::FromHandle($w.MainWindowHandle)
    $play = $root.FindFirst([Windows.Automation.TreeScope]::Descendants, (New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::AutomationIdProperty, "PlayButton")))
    if ($play) { try { $play.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke(); $pressed = $true } catch {} }
  }
  Check "Play pressed in the new app's window" $pressed
  Check "the run went on to the launcher" (Wait-Log 'launching' 60)
  Start-Sleep -Seconds 5
  Shot "3-after-play.png"
  $okReports = @(Get-Content $reports -ErrorAction SilentlyContinue | Where-Object { $_ -match '"outcome":"ok"' })
  Check ("a report says it went through, from " + $newVer) (@($okReports | Where-Object { $_ -match ('"installerVersion":"' + [regex]::Escape($newVer)) }).Count -ge 1)
  Check "it says it was updated from 3.5.5" (@($okReports | Where-Object { $_ -match '"updatedFrom":"3\.5\.5"' }).Count -ge 1)
  Check "the real site was never asked: every request went to the stand-in" ((Log-Text) -notmatch 'deepslate\.dsw\.test/api')
} finally {
  $env:PATH = $savedPath
  Get-Process DeepslateWorks -ErrorAction SilentlyContinue | ForEach-Object { try { $_.Kill() } catch {} }
  Stop-Job $siteJob -ErrorAction SilentlyContinue; Remove-Job $siteJob -Force -ErrorAction SilentlyContinue
  Copy-Item $requests (Join-Path $Shots "requests.txt") -ErrorAction SilentlyContinue
  Copy-Item $log (Join-Path $Shots "deepslate-works.log") -ErrorAction SilentlyContinue
  # reports carry the log: kept only with the token taken out
  if (Test-Path $reports) { (Get-Content -Raw $reports) -replace 'update-test-token-[0-9]+', '<token>' | Set-Content (Join-Path $Shots "reports.txt") }
}
if ($bad -gt 0) { Write-Host "$bad check(s) failed"; exit 1 }
Write-Host "All checks passed."

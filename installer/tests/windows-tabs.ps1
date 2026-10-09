# Deepslate Works 3.6.1: the Play tab and the Test tab in the app's own window, on a real Windows desktop (GitHub's
# windows runner, .github/workflows/installer.yml, job app). Every run is a test run (-Root, its own folders) against a
# stand-in site on 127.0.0.1: the real site is never asked and the Minecraft Launcher is never opened (Env.StandIn).
#
# Opened four ways: from the desktop, as the site's Play link opens it (-AsLink, only in such a run), with the live
# server switched off, and signed in as a member who is not an admin. In each: the Play tab and the Test tab side by
# side in one picture (tabs/<way>-play-and-test.png), and the checks below. Each kind of run lists both game folders
# with file hashes before and after (tabs/<way>-<when>-<folder>.txt): a test run writes nothing into the live folder and
# a live run nothing into the test folder. Exit 1 when a check fails.
param([Parameter(Mandatory = $true)][string]$Exe, [string]$Out = "shots")
$ErrorActionPreference = "Stop"
$Shots = Join-Path $Out "tabs"
[void][IO.Directory]::CreateDirectory($Shots)
$Shots = (Resolve-Path $Shots).Path
$Exe = (Resolve-Path $Exe).Path
$bad = 0
function Check($name, $ok) { if ($ok) { Write-Host "  [OK] $name" } else { Write-Host "  [FAIL] $name"; $script:bad++ } }

Add-Type -AssemblyName System.Windows.Forms, System.Drawing, UIAutomationClient, UIAutomationTypes
Add-Type -Namespace Tabs -Name W -MemberDefinition @"
public delegate bool EnumProc(System.IntPtr h, System.IntPtr l);
[DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, System.IntPtr l);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(System.IntPtr h);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr h, out uint pid);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(System.IntPtr h, System.Text.StringBuilder s, int n);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(System.IntPtr h, System.Text.StringBuilder s, int n);
[StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
[DllImport("user32.dll")] public static extern bool GetWindowRect(System.IntPtr h, out RECT r);
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr h);
"@
function Get-Windows {
  $list = New-Object System.Collections.Generic.List[object]
  $cb = [Tabs.W+EnumProc]{ param($h, $l)
    if ([Tabs.W]::IsWindowVisible($h)) {
      $c = New-Object Text.StringBuilder 256; $t = New-Object Text.StringBuilder 512; $p = [uint32]0
      [void][Tabs.W]::GetClassName($h, $c, 256); [void][Tabs.W]::GetWindowText($h, $t, 512); [void][Tabs.W]::GetWindowThreadProcessId($h, [ref]$p)
      $list.Add([pscustomobject]@{ handle = $h; class = $c.ToString(); title = $t.ToString(); pid = [int]$p })
    }
    return $true }
  [void][Tabs.W]::EnumWindows($cb, [IntPtr]::Zero)
  return $list
}
function Get-Ours { @(Get-Process DeepslateWorks -ErrorAction SilentlyContinue) }
function Stop-Ours { Get-Ours | ForEach-Object { try { $_.Kill(); $_.WaitForExit(5000) | Out-Null } catch {} } }
function Main-Window { @(Get-Windows | Where-Object { $_.title -match '^Deepslate Works \d' -and (Get-Ours | ForEach-Object { $_.Id }) -contains $_.pid }) | Select-Object -First 1 }
function Ui-Root { $w = Main-Window; if ($w) { return [Windows.Automation.AutomationElement]::FromHandle($w.handle) } return $null }
function Find-Id($el, [string]$id) { if (-not $el) { return $null } return $el.FindFirst([Windows.Automation.TreeScope]::Descendants, (New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::AutomationIdProperty, $id))) }
function Find-Named($el, [string]$name) { if (-not $el) { return $null } return $el.FindFirst([Windows.Automation.TreeScope]::Descendants, (New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::NameProperty, $name))) }
function Texts($el) {
  if (-not $el) { return @() }
  $all = $el.FindAll([Windows.Automation.TreeScope]::Descendants, (New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ControlTypeProperty, [Windows.Automation.ControlType]::Text)))
  return @($all | ForEach-Object { $_.Current.Name } | Where-Object { $_ })
}
function Save-Crop([IntPtr]$h, [string]$path) {
  $r = New-Object Tabs.W+RECT; [void][Tabs.W]::GetWindowRect($h, [ref]$r)
  $w = $r.Right - $r.Left; $hh = $r.Bottom - $r.Top
  if ($w -le 0 -or $hh -le 0) { return $false }
  $bmp = New-Object Drawing.Bitmap $w, $hh
  $g = [Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($r.Left, $r.Top, 0, 0, $bmp.Size); $g.Dispose()
  $bmp.Save($path, [Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
  return $true
}
# The two tabs of one window in one picture: Play on the left, Test on the right (or a grey panel saying it is not there)
function Save-Pair([string]$way) {
  $w = Main-Window
  if (-not $w) { Write-Host "  (no window to picture)"; return }
  [void][Tabs.W]::SetForegroundWindow($w.handle)
  $left = Join-Path $env:TEMP "tabs-left.png"; $right = Join-Path $env:TEMP "tabs-right.png"
  $root = Ui-Root
  Select-Tab $root "PlayTab" | Out-Null; Start-Sleep -Milliseconds 900
  [void](Save-Crop $w.handle $left)
  $hasTest = Select-Tab $root "TestTab"; Start-Sleep -Milliseconds 900
  if ($hasTest) { [void](Save-Crop $w.handle $right) }
  $a = [Drawing.Image]::FromFile($left)
  $b = $(if ($hasTest -and (Test-Path $right)) { [Drawing.Image]::FromFile($right) } else { $null })
  $pair = New-Object Drawing.Bitmap ($a.Width * 2 + 16), $a.Height
  $g = [Drawing.Graphics]::FromImage($pair); $g.Clear([Drawing.Color]::FromArgb(40, 40, 40))
  $g.DrawImage($a, 0, 0, $a.Width, $a.Height)
  if ($b) { $g.DrawImage($b, $a.Width + 16, 0, $b.Width, $b.Height) }
  else { $g.DrawString("No Test tab in this window", (New-Object Drawing.Font("Segoe UI", 16)), [Drawing.Brushes]::White, ($a.Width + 40), 40) }
  $g.Dispose(); $a.Dispose(); if ($b) { $b.Dispose() }
  $name = "$way-play-and-test.png"
  $pair.Save((Join-Path $Shots $name), [Drawing.Imaging.ImageFormat]::Png); $pair.Dispose()
  Remove-Item $left, $right -Force -ErrorAction SilentlyContinue
  Select-Tab $root "PlayTab" | Out-Null
  Write-Host "  picture: tabs/$name"
}
function Select-Tab($root, [string]$id) {
  $t = Find-Id $root $id
  if (-not $t) { return $false }
  try { $t.GetCurrentPattern([Windows.Automation.SelectionItemPattern]::Pattern).Select(); Start-Sleep -Milliseconds 500; return $true } catch { return $false }
}
function Tab($root, [string]$id) { if (Select-Tab $root $id) { return Find-Id $root $id } return $null }
function Press($el) { if (-not $el) { return $false } try { $el.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke(); Start-Sleep -Milliseconds 800; return $true } catch { return $false } }

# ---- the log --------------------------------------------------------------------------------------------------------
$log = Join-Path $env:TEMP "deepslate-works.log"
$script:logFrom = 0
function Log-Mark { $script:logFrom = $(if (Test-Path $log) { (Get-Item $log).Length } else { 0 }) }
function Log-Text {
  if (-not (Test-Path $log)) { return "" }
  $fs = [IO.File]::Open($log, 'Open', 'Read', 'ReadWrite'); [void]$fs.Seek($script:logFrom, 'Begin'); $t = (New-Object IO.StreamReader($fs)).ReadToEnd(); $fs.Close(); return $t
}
function Count-In([string]$text, [string]$pattern) { return ([regex]::Matches($text, $pattern)).Count }
function Wait-Log([string]$pattern, [int]$times = 1, [int]$sec = 120) {
  for ($i = 0; $i -lt $sec; $i++) { if ((Count-In (Log-Text) $pattern) -ge $times) { return $true }; Start-Sleep -Seconds 1 }
  return $false
}
$Ready = 'ready: waiting for the window to start the game'

# ---- folders: every file with its hash ------------------------------------------------------------------------------
function Snap([string]$dir) {
  $h = [ordered]@{}
  if (Test-Path $dir) {
    Get-ChildItem $dir -Recurse -File -Force | Sort-Object FullName | ForEach-Object {
      $rel = $_.FullName.Substring($dir.Length).TrimStart('\')
      if ($rel -notmatch '^logs\\') { $h[$rel] = (Get-FileHash $_.FullName -Algorithm SHA256).Hash.Substring(0, 16) }
    }
  }
  return $h
}
function Save-Snap($snap, [string]$name) { ($snap.Keys | ForEach-Object { "{0}  {1}" -f $snap[$_], $_ }) -join "`r`n" | Set-Content -Path (Join-Path $Shots $name) -Encoding ASCII }
function Diff-Snap($a, $b) {
  $d = @()
  foreach ($k in $a.Keys) { if (-not $b.Contains($k)) { $d += "removed $k" } elseif ($a[$k] -ne $b[$k]) { $d += "changed $k" } }
  foreach ($k in $b.Keys) { if (-not $a.Contains($k)) { $d += "added $k" } }
  return ,$d
}
function Profiles($root) { try { return Get-Content -Raw (Join-Path $root ".minecraft\launcher_profiles.json") | ConvertFrom-Json } catch { return $null } }
function Live-Profile($root) { $p = Profiles $root; if ($p -and $p.profiles.'deepslate-works') { return ($p.profiles.'deepslate-works' | ConvertTo-Json -Depth 6 -Compress) } return "" }
function Option([string]$file, [string]$key) {
  if (-not (Test-Path $file)) { return $null }
  $l = @(Get-Content $file | Where-Object { $_ -match ('^' + [regex]::Escape($key) + ':') })[0]
  if ($l) { return $l.Substring($key.Length + 1) } return $null
}

# ---- the stand-in site ----------------------------------------------------------------------------------------------
# What it answers follows control.json, read on every request: live and test (online, asleep, off, down for the test
# stack, or a state the app does not know). Two sign-ins: admin-token (an admin) and member-token (a member). Every
# request is written to requests.txt as "METHOD /path token"; reports to reports.txt.
$work = Join-Path $env:TEMP "tabs-site"
Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
[void][IO.Directory]::CreateDirectory($work)
$control = Join-Path $work "control.json"
$requests = Join-Path $work "requests.txt"
$reports = Join-Path $work "reports.txt"
$jar = Join-Path $work "leaves-1.0.jar"
[IO.File]::WriteAllBytes($jar, [Text.Encoding]::ASCII.GetBytes("a stand-in extra: falling leaves 1.0"))
$jarSha512 = (Get-FileHash $jar -Algorithm SHA512).Hash.ToLower()
$port = 47000 + (Get-Random -Maximum 2000)
$site = "http://127.0.0.1:$port"
function Set-Site([string]$live, [string]$test) { [IO.File]::WriteAllText($control, (ConvertTo-Json @{ live = $live; test = $test })) }
Set-Site "online" "online"
$siteJob = Start-Job -ArgumentList "$site/", $control, $requests, $reports, $jar, $jarSha512 -ScriptBlock {
  param($prefix, $control, $requests, $reports, $jar, $jarSha512)
  $base = $prefix.TrimEnd('/')
  function Words([string]$state, [bool]$admin) {
    $t = @{
      online = @("Online, nobody on", "Online", "good", "The server is up.")
      asleep = @("Asleep, join to wake it", "Asleep", "neutral", "Nobody is on, so it is asleep. Press Play or join and it wakes up in about 30 seconds.")
      waking = @("Waking up...", "Waking up", "warn", "Somebody pressed Play; it is waking up.")
      off = @("Switched off", "Switched off", "neutral", $(if ($admin) { "The server is switched off, so joining won't wake it. Start it here." } else { "The server is switched off. Ask Alex in Discord." }))
      upkeep = @("Closed for upkeep", "Upkeep", "neutral", "Back soon.")
    }[$state]
    if (-not $t) { $t = @("Can't reach the server", "Can't reach the server", "bad", "") }
    return [ordered]@{ state = $state; line = $t[0]; label = $t[1]; tone = $t[2]; hint = $t[3]; wake = [ordered]@{ phase = "idle"; leftS = $null; line = $null }; canStart = ($admin -and ($state -eq "off" -or $state -eq "crashed")) }
  }
  function Manifest([bool]$test) {
    $m = [ordered]@{
      name = "Deepslate Works"; version = "0.1.0+smoke"; hash = "smoke"; minecraft = "1.21.1"; neoforge = "21.1.252"; server_address = "mc.dsw.test"
      profile = [ordered]@{ id = "deepslate-works"; dir = ".minecraft-deepslate-works"; icon = "Furnace" }
      ram = [ordered]@{ min_gb = 3; max_gb = 6; user_max_gb = 12 }; render_distance = 10; simulation_distance = 8; server_view_distance = 12; tier = "MID"
      config_url = $null; files = @(); configs = @(); installer = $null; branding = $null }
    if ($test) {
      $m.test = $true; $m.name = "Deepslate Works TEST"; $m.version = "0.1.0+test"; $m.hash = "test"; $m.server_address = "lab.dsw.test"
      $m.profile = [ordered]@{ id = "deepslate-works-test"; dir = ".minecraft-deepslate-works-test"; icon = "Furnace"; name = "Deepslate Works TEST" }
    }
    return $m
  }
  $missing = '{"error":{"code":"unauthorized","message":"Sign in first"}}'
  $l = New-Object Net.HttpListener; $l.Prefixes.Add($prefix); $l.Start()
  while ($true) {
    $c = $l.GetContext(); $req = $c.Request; $p = $req.Url.AbsolutePath; $m = $req.HttpMethod
    $auth = [string]$req.Headers["Authorization"]; $token = $(if ($auth -match '^Bearer (.+)$') { $matches[1] } else { "-" })
    [IO.File]::AppendAllText($requests, "$m $p $token`n")
    $admin = $token -eq "admin-token"; $member = $admin -or $token -eq "member-token"
    $ctl = Get-Content -Raw $control | ConvertFrom-Json
    $code = 404; $body = '{"error":{"code":"not_here"}}'; $bytes = $null; $type = "application/json"
    switch -regex ($p) {
      '^/api/app/home$' {
        $code = 200
        $h = [ordered]@{ signedIn = $member; site = $base; server = (Words $ctl.live $admin) }
        if ($member) { $h.name = $(if ($admin) { "Bramble09" } else { "m1_owl" }); $h.admin = $admin; $h.online = @(); $h.players = @(); $h.news = $null; $h.votes = [ordered]@{ polls = @(); ballot = $null; order = @(); button = "Vote first, it takes ten seconds" } }
        $body = ConvertTo-Json -Depth 6 -InputObject $h
      }
      '^/api/version$' { $code = 200; $body = ConvertTo-Json @{ pack = "0.1.0+smoke"; status = $ctl.live } }
      '^/api/modpack/manifest$' { if ($member) { $code = 200; $body = ConvertTo-Json -Depth 6 -InputObject (Manifest $false) } else { $code = 401; $body = $missing } }
      '^/api/app/test$' {
        if (-not $admin) { $code = 401; $body = $missing }
        elseif ($ctl.test -eq "down") { $code = 200; $body = '{"available":false,"reason":"The site can''t reach the test server right now."}' }
        else { $code = 200; $body = ConvertTo-Json -Depth 6 -InputObject ([ordered]@{ available = $true; state = $ctl.test; players = 0; address = "lab.dsw.test"; pack = "0.1.0+test"; serverPack = "0.1.0+test"; server = (Words $ctl.test $true) }) }
      }
      '^/api/app/test/manifest$' {
        if (-not $admin) { $code = 401; $body = $missing }
        elseif ($ctl.test -eq "down") { $code = 503; $body = '{"error":{"code":"test_unreachable","message":"The site can''t reach the test server right now."}}' }
        else { $code = 200; $body = ConvertTo-Json -Depth 6 -InputObject (Manifest $true) }
      }
      '^/api/(play|app/test)/wake$' {
        $test = $p -match 'test'
        $state = $(if ($test) { $ctl.test } else { $ctl.live })
        if ($test -and -not $admin) { $code = 401; $body = $missing }
        elseif ($test -and $state -eq "down") { $code = 503; $body = '{"error":{"code":"test_unreachable","message":"The site can''t reach the test server right now."}}' }
        elseif ($m -eq "GET") { $code = 200; $body = ConvertTo-Json -Depth 4 @{ wake = @{ phase = $(if ($state -eq "online") { "ready" } else { "waking" }) } } }
        elseif ($state -eq "online") { $code = 200; $body = '{"result":"awake"}' }
        elseif ($state -eq "asleep") { $code = 202; $body = '{"result":"started"}' }
        else { $code = 409; $body = '{"error":{"code":"' + $state + '","message":"Not started."}}' }
      }
      '^/api/modpack/extras$' {
        $code = 200
        $body = ConvertTo-Json -Depth 6 -InputObject ([ordered]@{ extras = @([ordered]@{ id = "leaves"; name = "Falling Leaves"; description = "Leaves drift down from trees."; fps = "low"; files = @([ordered]@{ filename = "leaves-1.0.jar"; kind = "mods"; url = "$base/files/leaves-1.0.jar"; sha512 = $jarSha512; size = (Get-Item $jar).Length }) }) })
      }
      '^/files/leaves-1\.0\.jar$' { $code = 200; $bytes = [IO.File]::ReadAllBytes($jar); $type = "application/java-archive" }
      '^/api/installer/report$' {
        $r = New-Object IO.StreamReader($req.InputStream, [Text.Encoding]::UTF8); [IO.File]::AppendAllText($reports, $r.ReadToEnd() + "`n"); $code = 200; $body = '{"ok":true}'
      }
      '^/api/app/start$' { $code = 200; $body = '{"ok":true}' }
    }
    if (-not $bytes) { $bytes = [Text.Encoding]::UTF8.GetBytes($body) }
    $c.Response.StatusCode = $code; $c.Response.ContentType = $type; $c.Response.OutputStream.Write($bytes, 0, $bytes.Length); $c.Response.Close()
  }
}
Start-Sleep -Seconds 3

# ---- a PC, in a folder of its own -----------------------------------------------------------------------------------
# Every permission answered, Java 21 on PATH (the runner's), NeoForge in place, the Minecraft Launcher's file (never the
# launcher itself), the extra Falling Leaves switched on and in the live game, render distance 12 in the live game.
function New-Pc([string]$name, [string]$token) {
  $root = Join-Path $env:TEMP "tabs-$name"
  Remove-Item $root -Recurse -Force -ErrorAction SilentlyContinue
  $homeDir = Join-Path $root "LocalAppData\DeepslateWorks"
  $live = Join-Path $root ".minecraft-deepslate-works"
  $mc = Join-Path $root ".minecraft"
  foreach ($d in @($homeDir, (Join-Path $live "mods"), (Join-Path $mc "versions\neoforge-21.1.252"))) { [void][IO.Directory]::CreateDirectory($d) }
  [IO.File]::WriteAllText((Join-Path $mc "launcher_profiles.json"), '{"profiles":{},"settings":{"profileSorting":"ByLastPlayed"},"version":3}')
  [IO.File]::WriteAllText((Join-Path $live "launcher.json"), ('{{"token":"{0}","savedAt":"2026-10-09T12:00:00"}}' -f $token))
  [IO.File]::WriteAllText((Join-Path $live "options.txt"), "version:3955`r`nrenderDistance:12`r`nsimulationDistance:8`r`nguiScale:2`r`nresourcePacks:[`"vanilla`"]`r`n")
  Copy-Item $jar (Join-Path $live "mods\leaves-1.0.jar")
  $steps = [ordered]@{}; foreach ($s in @("signin", "launcher", "java", "neoforge", "mods", "profile", "shortcuts", "reports", "extras")) { $steps[$s] = [ordered]@{ answer = "allow"; level = 2; at = "2026-10-09T12:00:00" } }
  [IO.File]::WriteAllText((Join-Path $homeDir "consent.json"), (ConvertTo-Json -InputObject ([ordered]@{ version = 1; steps = $steps }) -Depth 4))
  [IO.File]::WriteAllText((Join-Path $homeDir "extras.json"), '{"version":2,"choices":{"leaves":true},"shader":"none","applied":{"mods":["leaves-1.0.jar"],"resourcepacks":[],"shaderpacks":[]},"seen":["leaves"],"downloaded":true,"queued":null,"lastApply":null,"installedAt":"2026-10-09T12:00:00"}')
  [IO.File]::WriteAllText((Join-Path $homeDir "settings.json"), '{"version":2,"websitePlay":"countdown"}')
  return [pscustomobject]@{ Root = $root; Home = $homeDir; Live = $live; Test = (Join-Path $root ".minecraft-deepslate-works-test") }
}
function Open-App($pc, [switch]$AsLink) {
  Stop-Ours
  Log-Mark
  $up = New-Object Threading.EventWaitHandle($false, [Threading.EventResetMode]::ManualReset, "Local\DeepslateWorks.App.Up")
  [void]$up.Reset()
  $a = @("-Root", ('"{0}"' -f $pc.Root), "-From", "desktop")
  if ($AsLink) { $a += "-AsLink" }
  Start-Process -FilePath $Exe -ArgumentList $a | Out-Null
  $ok = $up.WaitOne(60000)
  Start-Sleep -Seconds 3
  return $ok
}
function Requests-For([string]$path, [string]$token) { return @(Get-Content $requests -ErrorAction SilentlyContinue | Where-Object { $_ -match ('^\w+ ' + [regex]::Escape($path) + ' ' + [regex]::Escape($token) + '$') }).Count }
# The card of a tab: its words, and whether it names its own server
function Card-Says($tabEl, [string]$what) { return @(Texts $tabEl | Where-Object { $_ -like "$what*" }).Count -gt 0 }
function Play-Button($tabEl) { $b = Find-Id $tabEl "PlayButton"; if (-not $b) { $b = Find-Id $tabEl "TestPlayButton" }; return $b }

# One way of opening: an error counts as a failed check and the next way still runs
function Scenario([string]$name, [scriptblock]$body) {
  Write-Host $name
  try { & $body } catch { Check ("it ran to the end without an error: " + $_.Exception.Message) $false } finally { Stop-Ours }
}

$savedPath = $env:PATH
$java21 = $env:JAVA_HOME_21_X64
if ($java21) { $env:PATH = (Join-Path $java21 "bin") + ";" + $env:PATH }
$env:DEEPSLATE_PORTAL_URL = $site
try {
  Scenario "1. Opened from the desktop (an admin; live and test online)" {
  Set-Site "online" "online"
  $pc = New-Pc "desktop" "admin-token"
  Check "the window opened" (Open-App $pc)
  Check "the run at open got the live game ready" (Wait-Log $Ready 1 150)
  Start-Sleep -Seconds 2
  $root = Ui-Root
  $play = Tab $root "PlayTab"
  Check "the Play tab's card says 'Live server'" (Card-Says $play "Live server")
  Check "the footer shows the live pack on the Play tab" ((Find-Id $root "FooterPack").Current.Name -match '0\.1\.0\+smoke')
  $test = Tab $root "TestTab"
  Check "an admin has a Test tab" ($null -ne $test)
  Check "the Test tab's card says 'Test server'" (Card-Says $test "Test server")
  Check "the Test tab has the Play tab's card: the server line" ($null -ne (Find-Id $test "ServerLine"))
  Check "the Test tab has the Play tab's steps: the title and status" (($null -ne (Find-Id $test "PlayTitle")) -and ($null -ne (Find-Id $test "PlayStatus")))
  Check "the Test tab has no Start button (test starts stay on the test site)" ($null -eq (Find-Id $test "StartButton"))
  Check "the footer shows the test pack on the Test tab" ((Find-Id $root "FooterPack").Current.Name -match '0\.1\.0\+test')
  $tb = Play-Button $test
  Check "item 1: Play test can be pressed while the live run waits for Play" ($tb -and $tb.Current.IsEnabled)
  Save-Pair "1-desktop"
  $live0 = Snap $pc.Live; Save-Snap $live0 "1-desktop-before-test-run-live.txt"
  $prof0 = Live-Profile $pc.Root
  # A change made in the Settings tab while the live run waits: render distance 14, not yet in either game
  [IO.File]::WriteAllText((Join-Path $pc.Home "settings.json"), '{"version":2,"websitePlay":"countdown","pending":{"options":{"renderDistance":"14"},"villagers":false}}')
  $test = Tab (Ui-Root) "TestTab"
  $pressed = Press (Play-Button $test)
  Check "Play test pressed" $pressed
  $testReady = $pressed -and (Wait-Log $Ready 2 150)
  Check "the test run got the test game ready" $testReady
  Start-Sleep -Seconds 2
  $live1 = Snap $pc.Live; Save-Snap $live1 "1-desktop-after-test-run-live.txt"
  $test1 = Snap $pc.Test; Save-Snap $test1 "1-desktop-after-test-run-test.txt"
  $d = Diff-Snap $live0 $live1
  Check ("the test run wrote nothing into the live folder" + $(if ($d.Count) { ": " + ($d -join ", ") } else { "" })) ($testReady -and $d.Count -eq 0)
  Check "the test run left the live launcher profile as it was" ($testReady -and (Live-Profile $pc.Root) -eq $prof0)
  Check "item 5: the test game has the extra that is switched on" ($testReady -and (Test-Path (Join-Path $pc.Test "mods\leaves-1.0.jar")))
  Check "item 6: the test game starts from the live game's options (gui scale 2)" ((Option (Join-Path $pc.Test "options.txt") "guiScale") -eq "2")
  Check "item 6: the Settings change reached the test game (render distance 14)" ((Option (Join-Path $pc.Test "options.txt") "renderDistance") -eq "14")
  Check "the test run's report is a test report" (@(Get-Content $reports -ErrorAction SilentlyContinue | Where-Object { $_ -match '"mode":"test_play"' }).Count -ge 1)
  Check "item 1: the live run that only waited sent no 'cancelled' report" (@(Get-Content $reports -ErrorAction SilentlyContinue | Where-Object { $_ -match '"outcome":"cancelled"' }).Count -eq 0)
  Save-Pair "1-desktop-test-ready"
  # Back to the Play tab: Play there ends the test run that only waits and gets the live game ready
  $testBefore = Snap $pc.Test
  $play = Tab (Ui-Root) "PlayTab"
  $pb = Find-Id $play "PlayButton"
  Check "live Play can be pressed while the test run waits" ($pb -and $pb.Current.IsEnabled)
  $livePressed = Press $pb
  $liveAgain = $livePressed -and (Wait-Log $Ready 3 150)
  Check "live Play got the live game ready again" $liveAgain
  Start-Sleep -Seconds 2
  $testAfter = Snap $pc.Test; Save-Snap $testAfter "1-desktop-after-live-run-test.txt"
  Save-Snap (Snap $pc.Live) "1-desktop-after-live-run-live.txt"
  $d = Diff-Snap $testBefore $testAfter
  Check ("the live run wrote nothing into the test folder" + $(if ($d.Count) { ": " + ($d -join ", ") } else { "" })) ($liveAgain -and $d.Count -eq 0)
  Check "item 6: the Settings change reached the live game too (render distance 14)" ((Option (Join-Path $pc.Live "options.txt") "renderDistance") -eq "14")
  $pj = Profiles $pc.Root
  Check "after the live run the Minecraft Launcher would open on the live profile" ($pj -and $pj.selectedProfile -eq "deepslate-works")
  }

  Scenario "2. Opened as the site's Play link opens it (an admin; live and test online)" {
  Set-Site "online" "online"
  $pc = New-Pc "link" "admin-token"
  Check "the window opened" (Open-App $pc -AsLink)
  Check "it was opened as the Play link opens it" (Wait-Log 'opened as the Play link opens it' 1 30)
  Check "the live game got ready and the countdown started" ((Wait-Log $Ready 1 150) -and (Wait-Log 'starting the game in \d+ s unless stopped' 1 20))
  $root = Ui-Root
  $test = Tab $root "TestTab"   # a tab switch stops the countdown, as Alex did
  Check "switching to the Test tab stopped the countdown" (Wait-Log 'the countdown was stopped' 1 10)
  $tb = Play-Button $test
  Check "item 1: Play test can be pressed while the live run from the link waits" ($tb -and $tb.Current.IsEnabled)
  Save-Pair "2-play-link"
  $live0 = Snap $pc.Live; Save-Snap $live0 "2-play-link-before-test-run-live.txt"
  $pressed = Press (Play-Button (Tab (Ui-Root) "TestTab"))
  $testReady = $pressed -and (Wait-Log $Ready 2 150)
  Check "Play test ended the waiting live run and got the test game ready, no workaround" $testReady
  $live1 = Snap $pc.Live; Save-Snap $live1 "2-play-link-after-test-run-live.txt"
  Save-Snap (Snap $pc.Test) "2-play-link-after-test-run-test.txt"
  $d = Diff-Snap $live0 $live1
  Check ("the test run wrote nothing into the live folder" + $(if ($d.Count) { ": " + ($d -join ", ") } else { "" })) ($testReady -and $d.Count -eq 0)
  Check "no 'cancelled' report for the live run that was switched" (@(Get-Content $reports -ErrorAction SilentlyContinue | Where-Object { $_ -match '"outcome":"cancelled"' }).Count -eq 0)
  }

  Scenario "3. Opened with the live server switched off (an admin; the test server in a state this app does not know)" {
  Set-Site "off" "upkeep"
  $pc = New-Pc "live-off" "admin-token"
  Check "the window opened" (Open-App $pc)
  Start-Sleep -Seconds 12   # the home and the Test section asked at least once
  $root = Ui-Root
  $play = Tab $root "PlayTab"
  Check "the Play tab's card says 'Live server' and that it is switched off" ((Card-Says $play "Live server") -and @(Texts $play | Where-Object { $_ -match 'Switched off' }).Count -gt 0)
  $sb = Find-Id $play "StartButton"
  Check ("item 10: the Start button names the live server: '" + $(if ($sb) { $sb.Current.Name } else { "" }) + "'") ($sb -and $sb.Current.Name -eq "Start live server")
  $test = Tab $root "TestTab"
  Check "the Test tab's card says 'Test server'" (Card-Says $test "Test server")
  Check "the Test tab shows a state this app does not know in the site's own words" (@(Texts $test | Where-Object { $_ -match 'Closed for upkeep' }).Count -gt 0)
  Save-Pair "3-live-off"
  # Start asks first and names the live server; answered No, nothing is sent
  $play = Tab (Ui-Root) "PlayTab"
  $sb = Find-Id $play "StartButton"
  $asked = $null
  if ($sb) {
    $t0 = Requests-For "/api/app/start" "admin-token"
    try { $sb.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke() } catch {}
    for ($i = 0; $i -lt 10 -and -not $asked; $i++) {
      Start-Sleep -Milliseconds 500
      $asked = @(Get-Windows | Where-Object { $_.class -eq '#32770' -and (Get-Ours | ForEach-Object { $_.Id }) -contains $_.pid })[0]
    }
    if ($asked) {
      $q = [Windows.Automation.AutomationElement]::FromHandle($asked.handle)
      $words = (Texts $q) -join " "
      [void](Save-Crop $asked.handle (Join-Path $Shots "3-live-off-start-question.png"))
      Check ("item 10: Start asks first and names the live server: '" + $words + "'") ($words -match 'live server')
      [void](Press (Find-Named $q "No"))
      Start-Sleep -Seconds 1
      Check "answered No: no start was sent" ((Requests-For "/api/app/start" "admin-token") -eq $t0)
    } else { Check "item 10: Start asks first" $false }
  }
  }

  Scenario "4. Opened by a member who is not an admin" {
  Set-Site "online" "online"
  $pc = New-Pc "member" "member-token"
  Check "the window opened" (Open-App $pc)
  Check "the run at open got the live game ready" (Wait-Log $Ready 1 150)
  Start-Sleep -Seconds 25   # long enough for the window's 10 s home timer to have run twice
  $root = Ui-Root
  Check "no Test tab in the window" ($null -eq (Find-Id $root "TestTab"))
  Check "nothing named Test among the tabs" (@($root.FindAll([Windows.Automation.TreeScope]::Descendants, (New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ControlTypeProperty, [Windows.Automation.ControlType]::TabItem))) | Where-Object { $_.Current.Name -match 'Test' }).Count -eq 0)
  Check ("the app never asked for the Test section (asked " + (Requests-For "/api/app/test" "member-token") + " times)") ((Requests-For "/api/app/test" "member-token") -eq 0)
  Check "the log says nothing about a Test section" (-not ((Log-Text) -match 'Test section|Play test|test run'))
  Save-Pair "4-member"
  }
} finally {
  $env:PATH = $savedPath
  Remove-Item Env:\DEEPSLATE_PORTAL_URL -ErrorAction SilentlyContinue
  Stop-Job $siteJob -ErrorAction SilentlyContinue; Remove-Job $siteJob -Force -ErrorAction SilentlyContinue
  Stop-Ours
  Copy-Item $requests (Join-Path $Shots "requests.txt") -ErrorAction SilentlyContinue
  Copy-Item $reports (Join-Path $Shots "reports.txt") -ErrorAction SilentlyContinue
  Copy-Item $log (Join-Path $Shots "deepslate-works.log") -ErrorAction SilentlyContinue
}

# The artifact is public: the real site's address (the secret, given to this step as PORTAL_URL) must be in none of the
# files kept. Every run here is against the stand-in site, so it never should be; a file that has it is not uploaded.
if ($env:PORTAL_URL) {
  $realHost = ""
  try { $realHost = ([Uri]$env:PORTAL_URL).Host } catch {}
  if ($realHost) {
    $hits = @(Get-ChildItem $Shots -File | Where-Object { $_.Extension -ne ".png" -and (Select-String -Path $_.FullName -SimpleMatch $realHost -Quiet) })
    foreach ($f in $hits) { Remove-Item $f.FullName -Force }
    Check ("no kept file names the real site (" + $hits.Count + " removed)") ($hits.Count -eq 0)
  }
}

if ($bad -gt 0) { Write-Host "$bad check(s) failed"; exit 1 }
Write-Host "All checks passed."

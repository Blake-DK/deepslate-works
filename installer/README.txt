Deepslate Works - one-click install

First time:
1. Install the normal Minecraft Launcher from minecraft.net and open it once.
2. CLOSE the Minecraft Launcher completely before you start. Closing the window is not enough if its
   icon is still next to the clock: right-click that icon and choose Quit.
   (If it is open, the launcher throws the new profile away. The installer checks and tells you.)
3. Unzip this somewhere you'll keep (your Desktop is fine) and double-click Setup.bat.
   Your browser opens to sign you in with Discord and asks "is this you?": press Yes.
   The black window shows green ticks, says Done, and offers to open the launcher for you.
4. In the Minecraft Launcher, choose "Deepslate Works" next to Play, press Play.

Every time after that:
   Press Play on https://deepslate.dsw.test (Home, or the Install page). Your browser asks whether it may open
   Windows PowerShell: say yes. It checks you're still signed in (once a week it asks again), downloads any
   mod updates, opens the launcher on the Deepslate Works profile and closes itself.
   "Update and Play.bat" in this folder does the same without the browser.

   The Play button works because Setup.bat keeps a copy of install.ps1 in
   %LOCALAPPDATA%\DeepslateWorks and tells Windows to run it for deepslate:// links (for your user only,
   no admin rights). It accepts the link deepslate://play and no other.

It never touches your normal Minecraft. The installer owns the mods folder of its own profile:
anything you drop in there is removed on the next run.
To remove: delete the "Deepslate Works" profile in the launcher, the .minecraft-deepslate-works folder in %APPDATA%
and the DeepslateWorks folder in %LOCALAPPDATA%. The Play button's entry in the registry is
HKEY_CURRENT_USER\Software\Classes\deepslate; delete that key too (regedit), or leave it, it does nothing without the folder.

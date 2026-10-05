Deepslate Works

Once:
1. Install the normal Minecraft Launcher from minecraft.net, open it once, then close it completely
   (if its icon is next to the clock: right-click it and choose Quit).
2. Unzip this anywhere and double-click Setup.bat.
   Your browser opens to sign you in with Discord and asks "is this you?": press Yes.
   Everything is installed, and the Minecraft Launcher opens on the "Deepslate Works" profile. Press Play there.

After that, just press Play on {PORTAL_URL}, or open "Deepslate Works" from your desktop or the
Start Menu. It keeps itself and the mods up to date, then opens the launcher. You can delete this folder.

What Setup.bat puts on your PC (for your Windows user only, no admin rights):
  %LOCALAPPDATA%\DeepslateWorks\DeepslateWorks.ps1   the one script that does everything
  %LOCALAPPDATA%\DeepslateWorks\DeepslateWorks.vbs   starts it without a console window (and its icon, .ico)
  "Deepslate Works" shortcuts on the desktop and in the Start Menu
  the deepslate:// link for the Play button (HKEY_CURRENT_USER\Software\Classes\deepslate)
The game itself goes in %APPDATA%\.minecraft-deepslate-works, with a "Deepslate Works" profile in the launcher.
It never touches your normal Minecraft. Anything you drop into its mods folder is removed on the next run.

To remove it: close the Minecraft Launcher, then Settings -> Apps -> "Deepslate Works" -> Uninstall, or
"Uninstall Deepslate Works" in the Start Menu. It removes all of the above and keeps your screenshots (moved to
Pictures), Java, the launcher and your other profiles.

The app's titles use Pixelify Sans by The Pixelify Sans Project Authors, under the SIL Open Font Licence 1.1.
The licence comes with it: %LOCALAPPDATA%\DeepslateWorks\assets\OFL-PixelifySans.txt.

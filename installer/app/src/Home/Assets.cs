using System;
using System.IO;
using System.Reflection;

namespace DeepslateWorks
{
    /// <summary>
    /// 3.4.0 (docs/21 §5): the banner, the deepslate tile and the display face with its licence travel inside the exe
    /// (EmbeddedResource "assets/&lt;file&gt;", from branding/launcher/) and are written to &lt;home&gt;\assets\ when the folder
    /// is missing or was written by another version, so an update refreshes them and an unchanged version costs one file
    /// read. The window loads them from there (a font needs a file to load from without the WPF build targets). The
    /// uninstaller takes the folder with the rest of the home folder.
    /// </summary>
    public static class Assets
    {
        public const string Hero = "hero.png", Tile = "deepslate-tile@3x.png", FontBold = "PixelifySans-Bold.ttf", FontRegular = "PixelifySans-Regular.ttf", Licence = "OFL-PixelifySans.txt";
        public static readonly string[] Files = { Hero, Tile, FontBold, FontRegular, Licence };
        public const string VersionFile = "version.txt";
        public const string FontName = "Pixelify Sans";
        public const string FontsLogLine = "Fonts: Pixelify Sans, SIL Open Font Licence (see licences in the app folder)";

        public static string Dir(string home) => Path.Combine(home, "assets");
        public static string PathOf(string home, string file) => Path.Combine(Dir(home), file);

        /// <summary>What Ensure did: Ready when every file is there to load (written now or before); Wrote when it wrote
        /// them; Why when it could not.</summary>
        public sealed class Outcome { public bool Ready, Wrote; public string Why; }

        /// <summary>Writes the files when the folder is missing or version.txt is not this version. A folder that cannot be
        /// written (read-only, antivirus) is not an error: Ready says whether the files from before can still be used.</summary>
        public static Outcome Ensure(string home, string version)
        {
            var o = new Outcome();
            var dir = Dir(home);
            try
            {
                var vf = Path.Combine(dir, VersionFile);
                if (File.Exists(vf) && File.ReadAllText(vf).Trim() == (version ?? "").Trim() && AllThere(home)) { o.Ready = true; return o; }
                Directory.CreateDirectory(dir);
                var asm = Assembly.GetExecutingAssembly();
                foreach (var f in Files)
                {
                    using (var s = asm.GetManifestResourceStream("assets/" + f))
                    {
                        if (s == null) throw new FileNotFoundException("the exe has no " + f);
                        var tmp = Path.Combine(dir, f + ".new");
                        using (var fs = File.Create(tmp)) s.CopyTo(fs);
                        var to = Path.Combine(dir, f);
                        if (File.Exists(to)) File.Delete(to);
                        File.Move(tmp, to);
                    }
                }
                File.WriteAllText(vf, version ?? "");
                o.Wrote = true; o.Ready = true;
            }
            catch (Exception e)
            {
                o.Why = e.Message;
                o.Ready = AllThere(home);   // written by an earlier version and still readable: better than none
            }
            return o;
        }

        static bool AllThere(string home)
        {
            try { foreach (var f in Files) if (!File.Exists(PathOf(home, f))) return false; return true; }
            catch { return false; }
        }
    }
}

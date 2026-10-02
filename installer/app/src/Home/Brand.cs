using System;
using System.IO;
using System.Text.RegularExpressions;

namespace DeepslateWorks
{
    // ---- the logo (planner, 2026-10-01; 2.1.1, ported to 3.0) ------------------------------------------------------
    // The mod list's `branding` block {hash, name, tagline, pixel, icon128} names the chosen logo by a hash. Its .ico is
    // fetched from this app's own site (the address is made here from the hash, never taken from the list) into the home
    // folder as logo.ico, which then wins over the built-in icon for the window, the shortcuts and Settings -> Apps;
    // logo.png (128 px, from the list) goes in the window's header. A new hash is a new logo: fetched at the next Play,
    // shortcuts and Apps made again. Docs: docs/07 "Installer 2.1.1".
    public static class Brand
    {
        public const string LogoIconName = "logo.ico";
        public const string LogoPngName = "logo.png";
        public const string MarkerName = "branding.json";

        public static string LogoIconPath(string dir) => Path.Combine(dir ?? "", LogoIconName);

        /// <summary>An .ico: 00 00 01 00, at least one image, at least a header and one entry.</summary>
        public static bool IsIcoBytes(byte[] b) => b != null && b.Length >= 22 && b[0] == 0 && b[1] == 0 && b[2] == 1 && b[3] == 0 && (b[4] + 256 * b[5]) >= 1;

        /// <summary>Base64 of a PNG, under 400 KB of text.</summary>
        public static bool IsPngBase64(string s) => !string.IsNullOrEmpty(s) && s.Length < 400000 && Regex.IsMatch(s, "^[A-Za-z0-9+/]+={0,2}$") && s.StartsWith("iVBORw0KGgo", StringComparison.Ordinal);

        /// <summary>The launcher profile's picture: the logo as a data: PNG when the list has one, else the list's block icon.</summary>
        public static object ProfileIcon(object branding, object fallback)
        {
            var png = J.Str(branding, "icon128");
            return branding != null && IsPngBase64(png) ? "data:image/png;base64," + png : fallback;
        }

        public static object ReadMarker(string dir)
        {
            try { var f = Path.Combine(dir, MarkerName); return File.Exists(f) ? Json.ReadFile(f) : null; } catch { return null; }
        }

        /// <summary>"none" (no logo picked), "same", "saved" (a new logo is in place) or "failed: &lt;why&gt;". fetch: url -&gt; bytes.
        /// Never fails the run.</summary>
        public static string Save(object branding, string dir, Func<string, byte[]> fetch)
        {
            var hash = J.Str(branding, "hash") ?? "";
            if (branding == null || !Regex.IsMatch(hash, "^[0-9a-f]{12}$")) return "none";
            var was = ReadMarker(dir);
            var ico = LogoIconPath(dir);
            var marker = J.O("hash", hash, "name", J.Str(branding, "name") ?? "", "tagline", J.Str(branding, "tagline") ?? "", "pixel", J.Bool(branding, "pixel"));
            try
            {
                Directory.CreateDirectory(dir);
                if (was != null && J.Str(was, "hash") == hash && File.Exists(ico))
                {
                    if ((J.Str(was, "tagline") ?? "") != (string)marker["tagline"] || (J.Str(was, "name") ?? "") != (string)marker["name"]) Json.WriteFile(Path.Combine(dir, MarkerName), marker);
                    return "same";
                }
                var bytes = fetch(string.Format("{0}/brand/logo.ico?v={1}", Env.PortalUrl, hash));
                if (!IsIcoBytes(bytes)) return "failed: what came back is not an icon";
                File.WriteAllBytes(ico + ".new", bytes);
                if (File.Exists(ico)) File.Delete(ico);
                File.Move(ico + ".new", ico);
                var png = J.Str(branding, "icon128");
                if (IsPngBase64(png)) File.WriteAllBytes(Path.Combine(dir, LogoPngName), Convert.FromBase64String(png));
                Json.WriteFile(Path.Combine(dir, MarkerName), marker);
                return "saved";
            }
            catch (Exception e) { return "failed: " + e.Message; }
        }

        /// <summary>The icon file for the shortcuts and Settings -&gt; Apps: logo.ico next to the exe when there is one, else the exe's own.</summary>
        public static string IconFile(string exe)
        {
            try
            {
                var dir = Path.GetDirectoryName(exe ?? "");
                if (!string.IsNullOrEmpty(dir) && File.Exists(LogoIconPath(dir))) return LogoIconPath(dir);
            }
            catch { }
            return exe;
        }
    }

    // ---- the footer (versions) (planner, 2026-10-01; 2.1.2, ported to 3.0) ---------------------------------------------
    // "App <v> · Pack <v> · Server: <state>". No number is written here: the app's own version is the engine's (after a
    // self-update, the new exe's), the pack on this PC is installed.json's, the current pack and the server's state come
    // from <site>/api/version and the mod list.
    public sealed class FooterParts { public string App, Pack, PackTone, Server; }

    public static class Footer
    {
        public static FooterParts Parts(string app, string local, string current, string server)
        {
            var f = new FooterParts { App = string.IsNullOrEmpty(app) ? "App" : "App " + app, Pack = "Pack not installed yet", PackTone = "Dim" };
            if (!string.IsNullOrEmpty(local)) f.Pack = "Pack " + local;
            if (!string.IsNullOrEmpty(current) && current != local) { f.Pack = string.IsNullOrEmpty(local) ? "Pack update available" : f.Pack + "  ·  Pack update available"; f.PackTone = "Copper"; }
            f.Server = string.IsNullOrEmpty(server) ? "Server: ?" : "Server: " + server;
            return f;
        }

        /// <summary>The pack on this PC: installed.json's version, or null.</summary>
        public static string InstalledPack()
        {
            try { return File.Exists(Env.InstalledFile) ? J.Str(Json.ReadFile(Env.InstalledFile), "version") : null; } catch { return null; }
        }
    }
}

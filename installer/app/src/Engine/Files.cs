using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace DeepslateWorks
{
    public static partial class Engine
    {
        public static string Sha512Hex(string file)
        {
            using (var sha = SHA512.Create())
            using (var s = File.OpenRead(file))
                return BitConverter.ToString(sha.ComputeHash(s)).Replace("-", "").ToLowerInvariant();
        }

        // ---- where a mod file may come from (docs/58) ----------------------------------------------------------------
        // The same rule as the site's (packages/modpack mod-url.ts): Modrinth's CDN, and one more place, the site itself,
        // for a jar it hands out behind its gate (a patched mod that is never published): <site>/downloads/mods/<file>,
        // and the test pack's through the live site, <site>/downloads/mods/test/<file>. The site is the one this app was
        // built for, never an address from the mod list. Anything else is refused before it is fetched.
        public const string ModHost = "cdn.modrinth.com";
        static readonly Regex PrivateJar = new Regex(@"^[A-Za-z0-9][A-Za-z0-9._+-]{0,150}\.jar$");

        /// <summary>Why this mod file's address may not be fetched, or null when it may.</summary>
        public static string ModUrlProblem(string url, string site)
        {
            Uri u;
            if (string.IsNullOrEmpty(url) || !Uri.TryCreate(url, UriKind.Absolute, out u)) return "not an address: " + url;
            if (u.Scheme == Uri.UriSchemeHttps && string.Equals(u.Host, ModHost, StringComparison.OrdinalIgnoreCase)) return null;
            Uri s;
            if (!string.IsNullOrEmpty(site) && Uri.TryCreate(site, UriKind.Absolute, out s) && u.Scheme == s.Scheme && string.Equals(u.Host, s.Host, StringComparison.OrdinalIgnoreCase) && u.Port == s.Port
                && u.UserInfo.Length == 0 && u.Query.Length == 0 && u.Fragment.Length == 0)
            {
                const string mods = "/downloads/mods/";
                var p = u.AbsolutePath;
                if (p.StartsWith(mods, StringComparison.Ordinal))
                {
                    var name = p.Substring(mods.Length);
                    if (name.StartsWith("test/", StringComparison.Ordinal)) name = name.Substring(5);
                    if (PrivateJar.IsMatch(name) && !name.Contains("..")) return null;
                }
            }
            return "not on https://" + ModHost + " or this site's /downloads/mods/: " + url;
        }

        // ---- downloads land in a folder of their own first (docs/07 "Downloads") -------------------------------
        // A mod is downloaded into .downloading\ next to mods\, checked, and only then moved into mods\ in one step. A run
        // that is killed half-way leaves a part file in .downloading\ (emptied at the start of the next run), never a
        // half-written jar in mods\.
        /// <summary>"" (in place), "wrong" (the checksum did not match: nothing reached mods\) or "in use" (could not be
        /// put in place). A download that fails throws, and leaves only the part file.</summary>
        public static string SaveModFile(string url, string dest, string sha512, string staging, Action<string, string> fetch)
        {
            var bad = ModUrlProblem(url, Env.PortalUrl);
            if (bad != null) throw new IOException(Path.GetFileName(dest) + ": " + bad);
            Directory.CreateDirectory(staging);
            var part = Path.Combine(staging, Path.GetFileName(dest) + ".part");
            Log.RemoveTemp(part);
            fetch(url, part);
            var hash = Sha512Hex(part);
            if (!string.Equals(hash, sha512 ?? "", StringComparison.OrdinalIgnoreCase)) { Log.RemoveTemp(part); return "wrong"; }
            try { MoveOver(part, dest); }
            catch (Exception e) { Log.Line("could not put " + dest + " in place: " + e.Message); Log.RemoveTemp(part); return "in use"; }
            return "";
        }

        // ---- 3.3.0: Update while the game is running -----------------------------------------------------------------
        // The game holds mods\ open, so nothing there is touched: every file the pack wants that mods\ does not have
        // (right) is downloaded into .waiting\ and checked. When the game has closed, the same run as ever goes again and
        // moves them in (TakeWaiting) instead of downloading them a second time.

        /// <summary>Downloads into waitingDir what mods\ lacks; returns how many files are waiting there now.</summary>
        public static int PrefetchWaiting(string modsDir, string waitingDir, IEnumerable<object> files, Action<string, string> fetch)
        {
            Directory.CreateDirectory(waitingDir);
            int n = 0;
            foreach (var f in files)
            {
                var name = Path.GetFileName(J.Str(f, "filename") ?? "");
                var sha = J.Str(f, "sha512") ?? "";
                if (name.Length == 0) continue;
                var dest = Path.Combine(modsDir, name);
                if (File.Exists(dest) && string.Equals(Sha512Hex(dest), sha, StringComparison.OrdinalIgnoreCase)) continue;
                var ready = Path.Combine(waitingDir, name);
                if (File.Exists(ready) && string.Equals(Sha512Hex(ready), sha, StringComparison.OrdinalIgnoreCase)) { n++; continue; }
                var bad = ModUrlProblem(J.Str(f, "url"), Env.PortalUrl);
                if (bad != null) throw new IOException(name + ": " + bad);
                var part = ready + ".part";
                Log.RemoveTemp(part);
                fetch(J.Str(f, "url"), part);
                if (!string.Equals(Sha512Hex(part), sha, StringComparison.OrdinalIgnoreCase)) { Log.RemoveTemp(part); throw new IOException(name + " downloaded wrong"); }
                MoveOver(part, ready);
                Log.Line("downloaded for later: " + name);
                n++;
            }
            return n;
        }

        /// <summary>A file Update downloaded while the game was running, moved into mods\ when it is the one wanted.</summary>
        public static bool TakeWaiting(string waitingDir, string name, string sha512, string dest)
        {
            var ready = Path.Combine(waitingDir, Path.GetFileName(name));
            if (!File.Exists(ready)) return false;
            if (!string.Equals(Sha512Hex(ready), sha512 ?? "", StringComparison.OrdinalIgnoreCase)) { Log.RemoveTemp(ready); return false; }
            try { MoveOver(ready, dest); return true; }
            catch (Exception e) { Log.Line("could not move " + name + " in from .waiting: " + e.Message); return false; }
        }

        /// <summary>What is left in .waiting\ once mods\ is right (an older pack's file): gone.</summary>
        public static void ClearWaiting(string waitingDir)
        {
            if (!Directory.Exists(waitingDir)) return;
            foreach (var f in Directory.GetFiles(waitingDir)) Log.RemoveTemp(f);
        }

        /// <summary>Leftovers of a run that was stopped: part files in .downloading\ and, from installers before 1.5.0, in mods\.</summary>
        public static void ClearLeftovers(string gameDir)
        {
            var staging = Path.Combine(gameDir, ".downloading");
            if (Directory.Exists(staging)) foreach (var f in Directory.GetFiles(staging)) Log.RemoveTemp(f);
            var mods = Path.Combine(gameDir, "mods");
            if (Directory.Exists(mods))
                foreach (var f in Directory.GetFiles(mods))
                {
                    var name = Path.GetFileName(f);
                    if (!name.EndsWith(".part", StringComparison.OrdinalIgnoreCase)) continue;
                    Log.Line("removing a part file left by an earlier run: " + name);
                    Log.RemoveTemp(f);
                }
        }

        /// <summary>Expand-Archive -Force: every file of the zip under dest, over what is there. Nothing outside dest.</summary>
        public static void ExtractZip(string zip, string dest)
        {
            Directory.CreateDirectory(dest);
            var root = Path.GetFullPath(dest).TrimEnd('\\', '/') + Path.DirectorySeparatorChar;
            using (var z = ZipFile.OpenRead(zip))
                foreach (var e in z.Entries)
                {
                    var target = Path.GetFullPath(Path.Combine(root, e.FullName));
                    if (!target.StartsWith(root, StringComparison.OrdinalIgnoreCase)) throw new IOException("the zip names a file outside its folder: " + e.FullName);
                    if (e.Name.Length == 0) { Directory.CreateDirectory(target); continue; }
                    Directory.CreateDirectory(Path.GetDirectoryName(target));
                    if (File.Exists(target)) File.SetAttributes(target, FileAttributes.Normal);
                    e.ExtractToFile(target, true);
                }
        }

        // ---- render distance (docs/07 "Render distance", 1.5.4) ----------------------------------------------------
        public sealed class RenderResult
        {
            public string Status;   // written | changed | left | same
            public int Ours;        // the value to remember (installed.json's renderDistance)
            public string Text;     // what to say
        }

        static void WriteText(string path, string text) => File.WriteAllText(path, text, new UTF8Encoding(false));

        // options.txt is the game's own file. The first install writes it with the distances for the member's PC tier. Later
        // runs change renderDistance and simulationDistance only while renderDistance is still the value this app wrote
        // last time (ours, kept in installed.json; installs from before 1.5.4 wrote 8), so a value the player chose is never
        // touched. Only those two lines change; every other line and the line endings are kept as they are.
        public static RenderResult SetRenderDistance(string path, object ours, int render, int sim)
        {
            if (!File.Exists(path))
            {
                WriteText(path, string.Format("renderDistance:{0}\r\nsimulationDistance:{1}\r\nfullscreen:false\r\nchatLinks:true\r\nchatLinksPrompt:true\r\n", render, sim));
                return new RenderResult { Status = "written", Ours = render, Text = string.Format("Render distance set to {0}", render) };
            }
            var oursText = ours == null ? null : Convert.ToString(ours, System.Globalization.CultureInfo.InvariantCulture);
            int mine = (oursText == null || !Regex.IsMatch(oursText, @"^\d{1,2}$")) ? 8 : int.Parse(oursText);
            var text = File.ReadAllText(path);
            var m = Regex.Match(text, @"(?m)^renderDistance:(\d+)\r?$");
            if (!m.Success) return new RenderResult { Status = "left", Ours = mine, Text = "Render distance left as it is (not in options.txt)" };
            int now = int.Parse(m.Groups[1].Value);
            // already the tier's value: ours from now on (also after a run that changed it but failed before installed.json)
            if (now == render) return new RenderResult { Status = "same", Ours = render, Text = string.Format("Render distance {0}", render) };
            if (now != mine) return new RenderResult { Status = "left", Ours = mine, Text = string.Format("Render distance left at {0} (set by you)", now) };
            var nw = Regex.Replace(text, @"(?m)^renderDistance:\d+(?=\r?$)", string.Format("renderDistance:{0}", render));
            if (Regex.IsMatch(nw, @"(?m)^simulationDistance:\d+\r?$")) nw = Regex.Replace(nw, @"(?m)^simulationDistance:\d+(?=\r?$)", string.Format("simulationDistance:{0}", sim));
            else
            {
                var nl = text.Contains("\r\n") ? "\r\n" : "\n";
                if (nw.Length > 0 && !nw.EndsWith("\n")) nw += nl;
                nw += string.Format("simulationDistance:{0}{1}", sim, nl);
            }
            var tmp = path + ".new";
            WriteText(tmp, nw);
            MoveOver(tmp, path);
            return new RenderResult { Status = "changed", Ours = render, Text = string.Format("Render distance {0} {1} {2}", now, '→', render) };
        }

        // Chat links (1.5.5, planner): with chatLinks off, the sign-in link in the white room's chat line cannot be clicked. It
        // cannot mend a Microsoft account that has chat switched off (the book in the room is for that), but it rules out the
        // other reason. Only a "chatLinks:false" line is changed, and only that line. null when nothing was changed.
        public static string SetChatLinks(string path)
        {
            if (!File.Exists(path)) return null;
            var text = File.ReadAllText(path);
            if (!Regex.IsMatch(text, @"(?m)^chatLinks:false\r?$")) return null;
            var nw = Regex.Replace(text, @"(?m)^chatLinks:false(?=\r?$)", "chatLinks:true");
            var tmp = path + ".new";
            WriteText(tmp, nw);
            MoveOver(tmp, path);
            return "Chat links switched on (they were off in the game's settings)";
        }

        // The backpack key (Alex, 2026-10-14; 3.6.6): Sophisticated Backpacks opens the worn backpack with B, the key Xaero's
        // Minimap uses for a new waypoint. The pack's key for it is ` (the key left of 1; no mod in the pack uses it, VeinMiner
        // has no key at all). Set once per PC, remembered as installed.json's backpackKey: a missing line is added, the mod's
        // own B is changed, any other key (the player's choice) is kept, and after that the line is never touched again.
        // Name and default read from sophisticatedbackpacks 3.26.7 (KeybindHandler: translKeybind("open_backpack"), GLFW 66).
        public const string BackpackKeyOption = "key_key.sophisticatedbackpacks.open_backpack";
        public const string BackpackKey = "key.keyboard.grave.accent";

        /// <summary>null when nothing was changed (already set once, no options.txt, or a key the player chose).</summary>
        public static string SetBackpackKey(string path, bool doneBefore)
        {
            if (doneBefore || !File.Exists(path)) return null;
            var text = File.ReadAllText(path);
            var line = new Regex(@"(?m)^" + Regex.Escape(BackpackKeyOption) + @":([^\r\n]*)(?=\r?$)");
            var m = line.Match(text);
            string nw;
            if (!m.Success)
            {
                var nl = text.Contains("\r\n") ? "\r\n" : "\n";
                nw = text;
                if (nw.Length > 0 && !nw.EndsWith("\n")) nw += nl;
                nw += BackpackKeyOption + ":" + BackpackKey + nl;
            }
            else if (m.Groups[1].Value == "key.keyboard.b") nw = line.Replace(text, BackpackKeyOption + ":" + BackpackKey, 1);
            else return null;
            var tmp = path + ".new";
            WriteText(tmp, nw);
            MoveOver(tmp, path);
            return "Backpack key set to ` (the key left of 1)";
        }

        /// <summary>The engine's step: SetBackpackKey, ticked. True (installed.json's backpackKey) once options.txt was there
        /// to look at; a run that could not look tries again next time.</summary>
        static bool BackpackKeyStep(Run run, string options, bool doneBefore)
        {
            try
            {
                var said = SetBackpackKey(options, doneBefore);
                if (said != null) run.Tick(said);
                return doneBefore || File.Exists(options);
            }
            catch (Exception e) { run.Note("The backpack key was left as it is: " + e.Message); return doneBefore; }
        }

        // ---- the server list (servers.dat: uncompressed NBT, one entry) ---------------------------------------------
        public static byte[] ServersDat(string name, string ip)
        {
            using (var ms = new MemoryStream())
            using (var w = new BinaryWriter(ms))
            {
                void Str(string s)
                {
                    var b = Encoding.UTF8.GetBytes(s ?? "");
                    w.Write((byte)((b.Length >> 8) & 0xFF)); w.Write((byte)(b.Length & 0xFF)); w.Write(b);
                }
                w.Write((byte)10); Str("");               // TAG_Compound ""
                w.Write((byte)9); Str("servers");         // TAG_List "servers"
                w.Write((byte)10);                        //   of TAG_Compound
                w.Write(new byte[] { 0, 0, 0, 1 });       //   length 1
                w.Write((byte)8); Str("name"); Str(name);
                w.Write((byte)8); Str("ip"); Str(ip);
                w.Write((byte)0);                         //   TAG_End (entry)
                w.Write((byte)0);                         // TAG_End (root)
                w.Flush();
                return ms.ToArray();
            }
        }
    }
}

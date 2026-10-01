using System;
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

        // ---- downloads land in a folder of their own first (docs/07 "Downloads") -------------------------------
        // A mod is downloaded into .downloading\ next to mods\, checked, and only then moved into mods\ in one step. A run
        // that is killed half-way leaves a part file in .downloading\ (emptied at the start of the next run), never a
        // half-written jar in mods\.
        /// <summary>"" (in place), "wrong" (the checksum did not match: nothing reached mods\) or "in use" (could not be
        /// put in place). A download that fails throws, and leaves only the part file.</summary>
        public static string SaveModFile(string url, string dest, string sha512, string staging, Action<string, string> fetch)
        {
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

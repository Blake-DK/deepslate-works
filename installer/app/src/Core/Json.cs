using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using System.Web.Script.Serialization;

namespace DeepslateWorks
{
    /// <summary>An object whose keys keep the order they were added in (what ConvertTo-Json of an [ordered] gave).</summary>
    public class JObj : Dictionary<string, object>
    {
        readonly List<string> order = new List<string>();
        public JObj() : base(StringComparer.Ordinal) { }
        public new object this[string key]
        {
            get { return TryGetValue(key, out var v) ? v : null; }
            set { if (!ContainsKey(key)) order.Add(key); base[key] = value; }
        }
        public new void Add(string key, object value) { this[key] = value; }
        public new bool Remove(string key) { order.Remove(key); return base.Remove(key); }
        /// <summary>Keys in the order they were added; keys set through IDictionary (which skips the order) come last.</summary>
        public IEnumerable<string> OrderedKeys
        {
            get
            {
                var seen = new HashSet<string>(StringComparer.Ordinal);
                var r = new List<string>();
                foreach (var k in order) if (ContainsKey(k) && seen.Add(k)) r.Add(k);
                foreach (var k in Keys) if (seen.Add(k)) r.Add(k);
                return r;
            }
        }
    }

    /// <summary>
    /// JSON in and out with only what .NET Framework 4.8 has. Parse gives JObj for objects, List&lt;object&gt; for arrays,
    /// string, bool, long or double for values, null for null. Dates stay strings (pwsh 7 turned ISO strings into
    /// DateTime, 2.0.1 had to normalise that; here nothing is converted).
    /// </summary>
    public static class Json
    {
        public static object Parse(string text)
        {
            var ser = new JavaScriptSerializer { MaxJsonLength = int.MaxValue, RecursionLimit = 256 };
            return Convert(ser.DeserializeObject(text));
        }

        public static object ReadFile(string path)
        {
            if (string.IsNullOrEmpty(path) || !File.Exists(path)) return null;
            try { return Parse(File.ReadAllText(path)); }
            catch (Exception e) { Log.Line("could not read " + path + ": " + e.Message); return null; }
        }

        /// <summary>Written to .new, then moved over: a run killed half-way never leaves half a file (Write-JsonFile).</summary>
        public static void WriteFile(string path, object value, bool indented = true)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            var tmp = path + ".new";
            File.WriteAllText(tmp, Write(value, indented), new UTF8Encoding(false));
            if (File.Exists(path)) File.Delete(path);
            File.Move(tmp, path);
        }

        static object Convert(object v)
        {
            if (v is IDictionary<string, object> d)
            {
                var o = new JObj();
                foreach (var kv in d) o[kv.Key] = Convert(kv.Value);
                return o;
            }
            if (v is string) return v;
            if (v is IEnumerable e && !(v is string))
            {
                var l = new List<object>();
                foreach (var x in e) l.Add(Convert(x));
                return l;
            }
            if (v is int i) return (long)i;
            if (v is long) return v;
            if (v is decimal m) { if (m == Math.Floor(m) && m >= long.MinValue && m <= long.MaxValue) return (long)m; return (double)m; }
            if (v is double) return v;
            return v;
        }

        public static string Write(object value, bool indented = false)
        {
            var sb = new StringBuilder();
            WriteValue(sb, value, indented, 0);
            return sb.ToString();
        }

        static void Indent(StringBuilder sb, bool on, int level) { if (on) { sb.Append('\n'); sb.Append(' ', level * 2); } }

        static void WriteValue(StringBuilder sb, object v, bool ind, int level)
        {
            switch (v)
            {
                case null: sb.Append("null"); return;
                case string s: WriteString(sb, s); return;
                case bool b: sb.Append(b ? "true" : "false"); return;
                case DateTime dt: WriteString(sb, dt.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ", CultureInfo.InvariantCulture)); return;
                case double dd: sb.Append(double.IsNaN(dd) || double.IsInfinity(dd) ? "null" : dd.ToString("R", CultureInfo.InvariantCulture)); return;
                case float ff: sb.Append(((double)ff).ToString("R", CultureInfo.InvariantCulture)); return;
                case decimal dm: sb.Append(dm.ToString(CultureInfo.InvariantCulture)); return;
                case int _: case long _: case short _: case byte _: case uint _: case ulong _:
                    sb.Append(System.Convert.ToString(v, CultureInfo.InvariantCulture)); return;
                case JObj jo: WriteObject(sb, jo.OrderedKeys, k => jo[k], ind, level); return;
                case IDictionary<string, object> d: WriteObject(sb, d.Keys, k => d[k], ind, level); return;
                case IDictionary id:
                    {
                        var keys = new List<string>(); foreach (var k in id.Keys) keys.Add(System.Convert.ToString(k, CultureInfo.InvariantCulture));
                        WriteObject(sb, keys, k => id[k], ind, level); return;
                    }
                case IEnumerable e:
                    {
                        var items = new List<object>(); foreach (var x in e) items.Add(x);
                        if (items.Count == 0) { sb.Append("[]"); return; }
                        sb.Append('[');
                        for (int i = 0; i < items.Count; i++) { if (i > 0) sb.Append(','); Indent(sb, ind, level + 1); WriteValue(sb, items[i], ind, level + 1); }
                        Indent(sb, ind, level); sb.Append(']');
                        return;
                    }
                default: WriteString(sb, System.Convert.ToString(v, CultureInfo.InvariantCulture)); return;
            }
        }

        static void WriteObject(StringBuilder sb, IEnumerable<string> keys, Func<string, object> get, bool ind, int level)
        {
            var list = new List<string>(keys);
            if (list.Count == 0) { sb.Append("{}"); return; }
            sb.Append('{');
            for (int i = 0; i < list.Count; i++)
            {
                if (i > 0) sb.Append(',');
                Indent(sb, ind, level + 1);
                WriteString(sb, list[i]); sb.Append(ind ? ": " : ":");
                WriteValue(sb, get(list[i]), ind, level + 1);
            }
            Indent(sb, ind, level); sb.Append('}');
        }

        static void WriteString(StringBuilder sb, string s)
        {
            sb.Append('"');
            foreach (var c in s)
            {
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    case '\b': sb.Append("\\b"); break;
                    case '\f': sb.Append("\\f"); break;
                    default:
                        if (c < 0x20 || c == '\u2028' || c == '\u2029') sb.Append("\\u").Append(((int)c).ToString("x4"));
                        else sb.Append(c);
                        break;
                }
            }
            sb.Append('"');
        }
    }

    /// <summary>Reading parsed JSON without casts everywhere. A path is "a.b.c"; anything missing is null / the default.</summary>
    public static class J
    {
        public static object Get(object o, string path)
        {
            object cur = o;
            foreach (var part in path.Split('.'))
            {
                if (cur is IDictionary<string, object> d) { if (!d.TryGetValue(part, out cur)) return null; }
                else return null;
            }
            return cur;
        }
        public static bool Has(object o, string key) => o is IDictionary<string, object> d && d.ContainsKey(key);
        public static string Str(object o, string path, string dflt = null)
        {
            var v = Get(o, path);
            if (v == null) return dflt;
            if (v is bool b) return b ? "true" : "false";
            if (v is double d) return d.ToString("R", CultureInfo.InvariantCulture);
            return System.Convert.ToString(v, CultureInfo.InvariantCulture);
        }
        public static long? Long(object o, string path)
        {
            var v = Get(o, path);
            try
            {
                if (v == null) return null;
                if (v is string s) return long.TryParse(s, NumberStyles.Integer, CultureInfo.InvariantCulture, out var l) ? l : (long?)null;
                return System.Convert.ToInt64(v, CultureInfo.InvariantCulture);
            }
            catch { return null; }
        }
        public static int Int(object o, string path, int dflt = 0) { var l = Long(o, path); return l.HasValue ? (int)l.Value : dflt; }
        public static double? Num(object o, string path)
        {
            var v = Get(o, path);
            try { return v == null ? (double?)null : System.Convert.ToDouble(v, CultureInfo.InvariantCulture); } catch { return null; }
        }
        public static bool Bool(object o, string path, bool dflt = false)
        {
            var v = Get(o, path);
            if (v is bool b) return b;
            if (v is string s) return s == "true" || s == "True";
            return dflt;
        }
        public static JObj Obj(object o, string path) => Get(o, path) as JObj;
        public static List<object> Arr(object o, string path) => Get(o, path) as List<object> ?? new List<object>();
        public static List<string> Strs(object o, string path)
        {
            var r = new List<string>();
            foreach (var x in Arr(o, path)) if (x != null) r.Add(System.Convert.ToString(x, CultureInfo.InvariantCulture));
            return r;
        }
        /// <summary>A new ordered object from name/value pairs: J.O("a", 1, "b", "x").</summary>
        public static JObj O(params object[] kv)
        {
            var o = new JObj();
            for (int i = 0; i + 1 < kv.Length; i += 2) o[(string)kv[i]] = kv[i + 1];
            return o;
        }
    }
}

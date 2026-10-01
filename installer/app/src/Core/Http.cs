using System;
using System.IO;
using System.Net;
using System.Text;

namespace DeepslateWorks
{
    /// <summary>The site said no, or could not be reached: the status (0 when there was no answer) and the body.</summary>
    public class HttpError : Exception
    {
        public int Status { get; }
        public string Body { get; }
        public HttpError(int status, string body, string message) : base(message) { Status = status; Body = body ?? ""; }
    }

    /// <summary>
    /// HTTP with what .NET Framework 4.8 has. The launcher token goes ONLY to the site's own address (never to Modrinth,
    /// Adoptium or NeoForged). Every call is synchronous: the install steps run on their own thread.
    /// </summary>
    public static class Http
    {
        static Http()
        {
            try { ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12 | (SecurityProtocolType)12288; }   // TLS 1.2, and 1.3 where Windows has it
            catch { ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12; }
        }

        /// <summary>The launcher token (launcher.json), sent as Bearer to the site.</summary>
        public static string Token { get; set; }
        /// <summary>Tests: answers in place of the network. (method, url, body) -> (status, body); null = go to the network.</summary>
        public static Func<string, string, string, Tuple<int, string>> Fake { get; set; }
        /// <summary>Tests: downloads in place of the network. (url, outFile) -> true when handled.</summary>
        public static Func<string, string, bool> FakeDownload { get; set; }

        static bool ToSite(string url) => url.StartsWith(Env.PortalUrl + "/", StringComparison.OrdinalIgnoreCase) || url.Equals(Env.PortalUrl, StringComparison.OrdinalIgnoreCase);

        static HttpWebRequest Make(string method, string url, int timeoutSec)
        {
            var r = (HttpWebRequest)WebRequest.Create(url);
            r.Method = method;
            r.Timeout = timeoutSec * 1000;
            r.ReadWriteTimeout = timeoutSec * 1000;
            r.UserAgent = "DeepslateWorks/" + Env.Version + " (Windows)";
            r.AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate;
            if (ToSite(url) && !string.IsNullOrEmpty(Token)) r.Headers[HttpRequestHeader.Authorization] = "Bearer " + Token;
            return r;
        }

        static string Send(string method, string url, string body, int timeoutSec)
        {
            if (Fake != null)
            {
                var f = Fake(method, url, body);
                if (f != null)
                {
                    if (f.Item1 >= 200 && f.Item1 < 300) return f.Item2;
                    throw new HttpError(f.Item1, f.Item2, "The remote server returned an error: (" + f.Item1 + ").");
                }
            }
            var r = Make(method, url, timeoutSec);
            try
            {
                if (body != null)
                {
                    var bytes = Encoding.UTF8.GetBytes(body);
                    r.ContentType = "application/json; charset=utf-8";
                    r.ContentLength = bytes.Length;
                    using (var s = r.GetRequestStream()) s.Write(bytes, 0, bytes.Length);
                }
                using (var resp = (HttpWebResponse)r.GetResponse())
                using (var rd = new StreamReader(resp.GetResponseStream(), Encoding.UTF8))
                    return rd.ReadToEnd();
            }
            catch (WebException e)
            {
                if (e.Response is HttpWebResponse hr)
                {
                    string b = "";
                    try { using (var rd = new StreamReader(hr.GetResponseStream(), Encoding.UTF8)) b = rd.ReadToEnd(); } catch { }
                    throw new HttpError((int)hr.StatusCode, b, e.Message);
                }
                throw new HttpError(0, "", e.Message);
            }
        }

        public static object GetJson(string url, int timeoutSec = 60)
        {
            var t = Send("GET", url, null, timeoutSec);
            return string.IsNullOrWhiteSpace(t) ? null : Json.Parse(t);
        }
        public static object PostJson(string url, object body, int timeoutSec = 30)
        {
            var t = Send("POST", url, body == null ? "{}" : Json.Write(body), timeoutSec);
            return string.IsNullOrWhiteSpace(t) ? null : Json.Parse(t);
        }
        public static object Call(string method, string url, int timeoutSec = 15)
        {
            var t = Send(method, url, method == "GET" ? null : "{}", timeoutSec);
            return string.IsNullOrWhiteSpace(t) ? null : Json.Parse(t);
        }

        /// <summary>To outFile (overwritten). progress(done, total or -1) now and then.</summary>
        public static void Download(string url, string outFile, int timeoutSec = 300, Action<long, long> progress = null)
        {
            if (FakeDownload != null && FakeDownload(url, outFile)) return;
            var r = Make("GET", url, timeoutSec);
            try
            {
                using (var resp = (HttpWebResponse)r.GetResponse())
                using (var src = resp.GetResponseStream())
                using (var dst = new FileStream(outFile, FileMode.Create, FileAccess.Write, FileShare.None))
                {
                    long total = resp.ContentLength, done = 0;
                    var buf = new byte[81920];
                    int n; var last = DateTime.MinValue;
                    while ((n = src.Read(buf, 0, buf.Length)) > 0)
                    {
                        dst.Write(buf, 0, n); done += n;
                        if (progress != null && (DateTime.UtcNow - last).TotalMilliseconds > 250) { last = DateTime.UtcNow; progress(done, total); }
                    }
                    progress?.Invoke(done, total);
                }
            }
            catch (WebException e)
            {
                if (e.Response is HttpWebResponse hr) throw new HttpError((int)hr.StatusCode, "", e.Message);
                throw new HttpError(0, "", e.Message);
            }
        }
    }
}

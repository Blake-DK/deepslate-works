using System.Collections.Generic;
using Xunit;

namespace DeepslateWorks.Tests
{
    [Collection("env")]
    public class CoreTests
    {
        [Fact] public void Json_keeps_key_order_and_round_trips()
        {
            var o = J.O("b", 1, "a", "x", "c", new List<object> { true, null, 2.5 });
            var text = Json.Write(o);
            Assert.Equal("{\"b\":1,\"a\":\"x\",\"c\":[true,null,2.5]}", text);
            var back = Json.Parse(text);
            Assert.Equal(1L, J.Long(back, "b"));
            Assert.Equal("x", J.Str(back, "a"));
            Assert.Equal(new List<string> { "b", "a", "c" }, new List<string>(((JObj)back).OrderedKeys));
        }
        [Fact] public void Json_leaves_iso_dates_as_text() => Assert.Equal("2026-10-01T17:47:22.575Z", J.Str(Json.Parse("{\"at\":\"2026-10-01T17:47:22.575Z\"}"), "at"));
        [Fact] public void Versions()
        {
            Assert.True(Ver.IsNewer("3.0.0", "2.0.4"));
            Assert.True(Ver.IsNewer("3.0.10", "3.0.9"));
            Assert.False(Ver.IsNewer("3.0.0", "3.0.0"));
            Assert.False(Ver.IsNewer("3.0.0-beta", "2.0.0"));
            Assert.False(Ver.IsNewer("", "1.0"));
        }
        [Fact] public void Redaction_blanks_the_person_and_keeps_versions()
        {
            Report.SetPersonal(new[] { "player", "DESKTOP-42" });
            Assert.Equal(@"C:\Users\~\AppData", Report.Redact(@"C:\Users\player\AppData"));
            Assert.Equal("on ~ by ~", Report.Redact("on DESKTOP-42 by player"));
            Assert.Equal("Bearer ~", Report.Redact("Bearer abcdefgh123"));
            Assert.Equal("~@~", Report.Redact("me@example.com"));
            Assert.Equal("host ~ip~", Report.Redact("host 10.77.0.2", true));
            Assert.Equal("NeoForge 21.1.252 on Windows 10.0.26100, driver 32.0.15.6094", Report.Redact("NeoForge 21.1.252 on Windows 10.0.26100, driver 32.0.15.6094", true));
        }
        [Fact] public void Consent_decisions()
        {
            var c = new Dictionary<string, ConsentAnswer>();
            Assert.Equal("ask", Consents.Decision(c, "java"));
            Consents.SetAnswer(c, "java", "allow", 1);
            Assert.Equal("allow", Consents.Decision(c, "java", 1));
            Assert.Equal("ask", Consents.Decision(c, "java", 2));   // bigger than before
            Consents.SetAnswer(c, "reports", "decline", 1);
            Assert.Equal("decline", Consents.Decision(c, "reports"));
            Assert.Equal(9, Consents.Unanswered(new Dictionary<string, ConsentAnswer>()).Count);
        }
        [Fact] public void Consent_file_is_the_2_0_shape()
        {
            using (var s = new Scratch())
            {
                var c = new Dictionary<string, ConsentAnswer>();
                Consents.SetAnswer(c, "signin", "allow", 1);
                Consents.Save(Env.ConsentPath, c);
                var j = Json.ReadFile(Env.ConsentPath);
                Assert.Equal(1L, J.Long(j, "version"));
                Assert.Equal("allow", J.Str(j, "steps.signin.answer"));
                Assert.Equal("allow", Consents.Read(Env.ConsentPath)["signin"].Answer);
            }
        }
        [Fact] public void A_needed_step_that_needs_asking_stops_the_run()
        {
            var run = new Run();
            var lines = new List<JObj>();
            run.Sink = lines.Add;
            var e = Assert.Throws<NeedAnswer>(() => run.RequestConsent("java", 2));
            Assert.Equal("java", e.StepId);
            Assert.Equal("ask", J.Str(lines[0], "t"));
            Consents.SetAnswer(run.Consent, "reports", "decline", 1);
            Assert.False(run.RequestConsent("reports"));
            Consents.SetAnswer(run.Consent, "mods", "decline", 1);
            Assert.Throws<StepDeclined>(() => run.RequestConsent("mods"));
        }
    }
}

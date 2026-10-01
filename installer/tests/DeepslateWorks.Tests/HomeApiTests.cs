using System;
using System.Collections.Generic;
using Xunit;

namespace DeepslateWorks.Tests
{
    /// <summary>Every signature of stubs/Home.cs exists as the other modules call it (a compile-time check).</summary>
    public class HomeApiTests
    {
        [Fact] public void The_stub_signatures_are_all_there()
        {
            Func<bool> isHome = Home.IsHomeCopy;
            Func<List<JObj>, bool> fromDownload = Home.InstallFromDownload;
            Func<Run, bool, HomeResult> repair = Home.RepairHere;
            Action cleanOld = SelfUpdate.CleanOld;
            Func<Run, object, string[], string> check = SelfUpdate.Check;
            Func<bool, int> uninstall = Uninstaller.Run;
            var r = new HomeResult();
            string exe = r.Exe; bool linked = r.Linked; bool fixd = r.Fixed;
            List<JObj> problems = r.Problems;
            List<KeyValuePair<string, string>> said = r.Said;
            Assert.NotNull(isHome); Assert.NotNull(fromDownload); Assert.NotNull(repair); Assert.NotNull(cleanOld); Assert.NotNull(check); Assert.NotNull(uninstall);
            Assert.Null(exe); Assert.False(linked || fixd); Assert.Empty(problems); Assert.Empty(said);
        }
    }
}

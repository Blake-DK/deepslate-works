namespace DeepslateWorks
{
    public static partial class AppWindow
    {
        // The window's layout, verbatim from 2.0.x (DeepslateWorks.ps1 $AppXaml / $AskXaml), loaded at run time with
        // XamlReader.Parse (no XAML compilation), so the look stays exactly as it was.

        /// <summary>The main window: Play, Extras and Log tabs.</summary>
        public const string AppXaml = @"<Window xmlns=""http://schemas.microsoft.com/winfx/2006/xaml/presentation"" xmlns:x=""http://schemas.microsoft.com/winfx/2006/xaml""
        Title=""Deepslate Works"" Width=""600"" Height=""740"" MinWidth=""500"" MinHeight=""560"" WindowStartupLocation=""CenterScreen""
        FontFamily=""Segoe UI"" FontSize=""13"" Background=""#F6F7F8"">
  <Window.Resources>
    <Style TargetType=""Button"" x:Key=""Primary"">
      <Setter Property=""Background"" Value=""#2E7D5B""/><Setter Property=""Foreground"" Value=""White""/><Setter Property=""BorderThickness"" Value=""0""/>
      <Setter Property=""Padding"" Value=""18,8""/><Setter Property=""FontWeight"" Value=""SemiBold""/><Setter Property=""Cursor"" Value=""Hand""/>
    </Style>
    <Style TargetType=""Button"" x:Key=""Plain"">
      <Setter Property=""Padding"" Value=""14,7""/><Setter Property=""Margin"" Value=""0,0,8,0""/><Setter Property=""Cursor"" Value=""Hand""/>
    </Style>
  </Window.Resources>
  <DockPanel>
  <StackPanel x:Name=""Footer"" DockPanel.Dock=""Bottom"" Orientation=""Horizontal"" Margin=""14,0,14,8"">
    <TextBlock x:Name=""FooterApp"" Foreground=""#666""/>
    <TextBlock Text=""  ·  "" Foreground=""#999""/>
    <TextBlock x:Name=""FooterPack"" Foreground=""#666""/>
    <TextBlock Text=""  ·  "" Foreground=""#999""/>
    <TextBlock x:Name=""FooterServer"" Foreground=""#666""/>
  </StackPanel>
  <TabControl x:Name=""Tabs"" Margin=""8"" Background=""White"">
    <TabItem Header=""  Play  "" x:Name=""PlayTab"">
      <DockPanel Margin=""14"">
        <StackPanel DockPanel.Dock=""Top"" Margin=""0,0,0,10"">
          <StackPanel x:Name=""BrandBar"" Orientation=""Horizontal"" Margin=""0,0,0,8"" Visibility=""Collapsed"">
            <Image x:Name=""BrandLogo"" Width=""40"" Height=""40"" Margin=""0,0,10,0"" VerticalAlignment=""Center""/>
            <StackPanel VerticalAlignment=""Center"">
              <TextBlock x:Name=""BrandName"" FontWeight=""SemiBold"" Text=""Deepslate Works""/>
              <TextBlock x:Name=""BrandTagline"" Foreground=""#C0661F""/>
            </StackPanel>
          </StackPanel>
          <TextBlock x:Name=""PlayTitle"" FontSize=""20"" FontWeight=""SemiBold"" Text=""Deepslate Works""/>
          <TextBlock x:Name=""PlayStatus"" TextWrapping=""Wrap"" Margin=""0,4,0,0"" Foreground=""#444""/>
          <TextBlock x:Name=""PlayChanged"" TextWrapping=""Wrap"" Margin=""0,4,0,0"" Foreground=""#2E7D5B"" FontWeight=""SemiBold"" Visibility=""Collapsed""/>
        </StackPanel>
        <DockPanel DockPanel.Dock=""Bottom"" Margin=""0,10,0,0"">
          <TextBlock DockPanel.Dock=""Left"" VerticalAlignment=""Center""><Hyperlink x:Name=""ReviewLink"">Review permissions</Hyperlink></TextBlock>
          <StackPanel DockPanel.Dock=""Right"" Orientation=""Horizontal"" HorizontalAlignment=""Right"">
            <Button x:Name=""ResetButton"" Style=""{StaticResource Plain}"" Content=""Reset all"" Visibility=""Collapsed""/>
            <Button x:Name=""AllowAllButton"" Style=""{StaticResource Plain}"" Content=""Allow all"" Visibility=""Collapsed""/>
            <Button x:Name=""PlayButton"" Style=""{StaticResource Primary}"" Content=""Play"" MinWidth=""150""/>
          </StackPanel>
        </DockPanel>
        <ScrollViewer VerticalScrollBarVisibility=""Auto""><StackPanel x:Name=""PlayBody""/></ScrollViewer>
      </DockPanel>
    </TabItem>
    <TabItem Header=""  Extras  "" x:Name=""ExtrasTab"">
      <DockPanel Margin=""14"">
        <StackPanel DockPanel.Dock=""Top"" Margin=""0,0,0,8"">
          <TextBlock FontSize=""20"" FontWeight=""SemiBold"" Text=""Extras""/>
          <TextBlock TextWrapping=""Wrap"" Margin=""0,2,0,8"" Foreground=""#555"" Text=""Only on this PC, never voted on. Other players don't need them: you can play together either way.""/>
          <Border x:Name=""HeadlineBox"" Background=""#EEF4F8"" CornerRadius=""6"" Padding=""10,8"">
            <DockPanel>
              <Button x:Name=""HeadlineButton"" DockPanel.Dock=""Right"" Style=""{StaticResource Primary}"" Padding=""12,5"" Visibility=""Collapsed""/>
              <TextBlock x:Name=""HeadlineText"" TextWrapping=""Wrap"" VerticalAlignment=""Center"" FontWeight=""SemiBold"" Margin=""0,0,10,0""/>
            </DockPanel>
          </Border>
          <TextBlock x:Name=""ErrorLine"" TextWrapping=""Wrap"" Margin=""0,8,0,0"" Foreground=""#B3261E"" FontWeight=""SemiBold"" Visibility=""Collapsed"">
            <Run x:Name=""ErrorText""/> <Hyperlink x:Name=""DetailsLink"">Show details</Hyperlink>
          </TextBlock>
          <StackPanel x:Name=""ProgressBox"" Margin=""0,8,0,0"" Visibility=""Collapsed""/>
        </StackPanel>
        <DockPanel DockPanel.Dock=""Bottom"" Margin=""0,10,0,0"">
          <Button x:Name=""CheckButton"" DockPanel.Dock=""Left"" Style=""{StaticResource Plain}"" Content=""Check extras""/>
          <Button x:Name=""ApplyButton"" DockPanel.Dock=""Right"" Style=""{StaticResource Primary}"" Content=""Apply"" MinWidth=""120""/>
          <TextBlock x:Name=""ExtrasStatus"" TextWrapping=""Wrap"" VerticalAlignment=""Center"" Margin=""4,0,12,0"" Foreground=""#444""/>
        </DockPanel>
        <ScrollViewer VerticalScrollBarVisibility=""Auto"">
          <StackPanel>
            <StackPanel x:Name=""ExtrasBody""/>
            <TextBlock x:Name=""ChecksTitle"" Text=""Checks"" FontSize=""15"" FontWeight=""SemiBold"" Margin=""0,10,0,4"" Visibility=""Collapsed""/>
            <StackPanel x:Name=""ChecksBody""/>
          </StackPanel>
        </ScrollViewer>
      </DockPanel>
    </TabItem>
    <TabItem Header=""  Log  "" x:Name=""LogTab"">
      <ListBox x:Name=""LogList"" Margin=""10"" FontFamily=""Consolas"" FontSize=""12"" BorderThickness=""0""/>
    </TabItem>
  </TabControl>
  </DockPanel>
</Window>";

        /// <summary>One question with up to three answers (Yes / Later / Allow all). The text says what will happen; Allow all
        /// says what it will remember, so nothing is hidden behind it.</summary>
        public const string AskXaml = @"<Window xmlns=""http://schemas.microsoft.com/winfx/2006/xaml/presentation"" xmlns:x=""http://schemas.microsoft.com/winfx/2006/xaml""
        Title=""Deepslate Works"" Width=""440"" SizeToContent=""Height"" ResizeMode=""NoResize"" WindowStartupLocation=""CenterOwner""
        FontFamily=""Segoe UI"" FontSize=""13"" Background=""White"">
  <StackPanel Margin=""18"">
    <TextBlock x:Name=""Q"" FontSize=""16"" FontWeight=""SemiBold"" TextWrapping=""Wrap""/>
    <TextBlock x:Name=""Why"" TextWrapping=""Wrap"" Margin=""0,8,0,6"" Foreground=""#444""/>
    <TextBlock x:Name=""AllNote"" TextWrapping=""Wrap"" Margin=""0,0,0,14"" Foreground=""#666"" FontSize=""12""/>
    <StackPanel Orientation=""Horizontal"" HorizontalAlignment=""Right"">
      <Button x:Name=""Later"" Content=""Later"" Padding=""16,6"" Margin=""0,0,8,0""/>
      <Button x:Name=""All"" Content=""Allow all"" Padding=""16,6"" Margin=""0,0,8,0""/>
      <Button x:Name=""Yes"" Content=""Yes"" Padding=""16,6"" Background=""#2E7D5B"" Foreground=""White"" BorderThickness=""0"" FontWeight=""SemiBold""/>
    </StackPanel>
  </StackPanel>
</Window>";

        /// <summary>The restart question uses the same window (the self test and the screenshots refer to it).</summary>
        public const string RestartXaml = AskXaml;

        /// <summary>Every name the window looks up in AppXaml.</summary>
        public static readonly string[] Names =
        {
            "Tabs", "PlayTab", "ExtrasTab", "LogTab", "PlayTitle", "PlayStatus", "PlayChanged", "ReviewLink", "ResetButton", "AllowAllButton", "PlayButton", "PlayBody",
            "HeadlineBox", "HeadlineText", "HeadlineButton", "ErrorLine", "ErrorText", "DetailsLink", "ProgressBox", "CheckButton", "ApplyButton", "ExtrasStatus", "ExtrasBody", "ChecksTitle", "ChecksBody", "LogList",
            "BrandBar", "BrandLogo", "BrandName", "BrandTagline", "Footer", "FooterApp", "FooterPack", "FooterServer",
        };

        /// <summary>Every name the question window looks up in AskXaml.</summary>
        public static readonly string[] AskNames = { "Q", "Why", "AllNote", "Later", "All", "Yes" };
    }
}

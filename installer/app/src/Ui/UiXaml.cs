namespace DeepslateWorks
{
    public static partial class AppWindow
    {
        // The windows' layout, loaded at run time with XamlReader.Parse (no XAML compilation; AppWindow.Load). 3.4.0
        // (docs/21): the dark look. No colour is written here: every brush is a {DynamicResource Key} from Theme, which
        // Load puts into the window's resources; the shared styles (ThemeXaml) go into all three windows.

        // A block (docs/21 §4): a black outline with a 3 px drop under it, the face, a 2 px highlight top and left, a 2 px
        // shade right and bottom. Pressed: highlight and shade swap and the text moves 1,1. Disabled: a grey face. No
        // effect classes: everything is a Border, so it costs nothing on a weak PC.
        static string Block(string face, string hi, string lo, string shadow)
        {
            var text = shadow == null ? "" :
                @"<TextBlock x:Name=""Shade"" Text=""{Binding Content, RelativeSource={RelativeSource TemplatedParent}}"" Foreground=""{DynamicResource " + shadow + @"}"" Margin=""2,2,-2,-2""/>";
            return @"
      <ControlTemplate TargetType=""Button"">
        <Border Background=""{DynamicResource Black}"" BorderBrush=""{DynamicResource Black}"" BorderThickness=""2,2,2,5"" SnapsToDevicePixels=""True"">
          <Grid>
            <Border x:Name=""Face"" Background=""{DynamicResource " + face + @"}""/>
            <Border x:Name=""Glow"" Background=""{DynamicResource " + hi + @"}"" Opacity=""0""/>
            <Border x:Name=""Hi"" BorderBrush=""{DynamicResource " + hi + @"}"" BorderThickness=""2,2,0,0""/>
            <Border x:Name=""Lo"" BorderBrush=""{DynamicResource " + lo + @"}"" BorderThickness=""0,0,2,3""/>
            <Grid x:Name=""Inner"" Margin=""{TemplateBinding Padding}"" HorizontalAlignment=""Center"" VerticalAlignment=""Center"">
              " + text + @"
              <ContentPresenter RecognizesAccessKey=""False""/>
            </Grid>
          </Grid>
        </Border>
        <ControlTemplate.Triggers>
          <Trigger Property=""IsMouseOver"" Value=""True""><Setter TargetName=""Glow"" Property=""Opacity"" Value=""0.5""/></Trigger>
          <Trigger Property=""IsPressed"" Value=""True"">
            <Setter TargetName=""Hi"" Property=""BorderBrush"" Value=""{DynamicResource " + lo + @"}""/>
            <Setter TargetName=""Lo"" Property=""BorderBrush"" Value=""{DynamicResource " + hi + @"}""/>
            <Setter TargetName=""Inner"" Property=""RenderTransform""><Setter.Value><TranslateTransform X=""1"" Y=""1""/></Setter.Value></Setter>
          </Trigger>
          <Trigger Property=""IsEnabled"" Value=""False"">
            <Setter TargetName=""Face"" Property=""Background"" Value=""{DynamicResource Disabled}""/>
            <Setter TargetName=""Glow"" Property=""Opacity"" Value=""0""/>
            <Setter TargetName=""Hi"" Property=""BorderBrush"" Value=""{DynamicResource Line}""/>
            <Setter TargetName=""Lo"" Property=""BorderBrush"" Value=""{DynamicResource Line}""/>
            <Setter Property=""Foreground"" Value=""{DynamicResource DisabledText}""/>" + (shadow == null ? "" : @"
            <Setter TargetName=""Shade"" Property=""Visibility"" Value=""Collapsed""/>") + @"
          </Trigger>
        </ControlTemplate.Triggers>
      </ControlTemplate>";
        }

        static string BlockStyle(string key, string face, string hi, string lo, string fg, string shadow, string extra)
            => @"
    <Style TargetType=""Button"" x:Key=""" + key + @""">
      <Setter Property=""Foreground"" Value=""{DynamicResource " + fg + @"}""/>
      <Setter Property=""FontWeight"" Value=""SemiBold""/><Setter Property=""Cursor"" Value=""Hand""/><Setter Property=""SnapsToDevicePixels"" Value=""True""/>
      <Setter Property=""Padding"" Value=""16,6,16,7""/>" + extra + @"
      <Setter Property=""Template""><Setter.Value>" + Block(face, hi, lo, shadow) + @"
      </Setter.Value></Setter>
    </Style>";

        /// <summary>The styles every window shares (docs/21 §4): the blocks (Primary green for Start, Apply, Yes, Done,
        /// Continue; PlayBlock and VoteBlock with the display face and a drawn shadow; Plain for Update, Allow all, Reset
        /// all, Check extras, Later), the tab strip, links in Blue.</summary>
        public static readonly string ThemeXaml =
            BlockStyle("Primary", "Green", "GreenHi", "GreenLo", "White", null, "")
          + BlockStyle("PlayBlock", "Green", "GreenHi", "GreenLo", "White", "GreenLo",
                @"<Setter Property=""FontFamily"" Value=""{DynamicResource PixelFont}""/><Setter Property=""FontSize"" Value=""24""/><Setter Property=""FontWeight"" Value=""Bold""/><Setter Property=""Padding"" Value=""20,5,20,7""/>")
          + BlockStyle("VoteBlock", "Copper", "CopperHi", "CopperLo", "OnCopper", "CopperHi",
                @"<Setter Property=""FontFamily"" Value=""{DynamicResource PixelFont}""/><Setter Property=""FontSize"" Value=""20""/><Setter Property=""FontWeight"" Value=""Bold""/><Setter Property=""Padding"" Value=""20,5,20,7""/>")
          + BlockStyle("Plain", "Card2", "Disabled", "Panel", "Fg", null, @"<Setter Property=""Margin"" Value=""0,0,8,0""/>")
          + @"
    <Style TargetType=""Hyperlink""><Setter Property=""Foreground"" Value=""{DynamicResource Blue}""/></Style>
    <Style TargetType=""ToggleButton"" x:Key=""PickBox"">
      <Setter Property=""Cursor"" Value=""Hand""/>
      <Setter Property=""Template""><Setter.Value>
        <ControlTemplate TargetType=""ToggleButton"">
          <Border Width=""16"" Height=""16"" Background=""{DynamicResource Shadow}"" BorderBrush=""{DynamicResource BoxLine}"" BorderThickness=""2"" SnapsToDevicePixels=""True"">
            <TextBlock x:Name=""Tick"" Text=""✓"" FontSize=""11"" FontWeight=""Bold"" Foreground=""{DynamicResource CopperHi}"" HorizontalAlignment=""Center"" VerticalAlignment=""Center"" Margin=""0,-2,0,0"" Visibility=""Hidden""/>
          </Border>
          <ControlTemplate.Triggers>
            <Trigger Property=""IsChecked"" Value=""True""><Setter TargetName=""Tick"" Property=""Visibility"" Value=""Visible""/></Trigger>
          </ControlTemplate.Triggers>
        </ControlTemplate>
      </Setter.Value></Setter>
    </Style>
    <Style TargetType=""TabControl"" x:Key=""Strip"">
      <Setter Property=""Template""><Setter.Value>
        <ControlTemplate TargetType=""TabControl"">
          <DockPanel>
            <Border DockPanel.Dock=""Top"" Background=""{DynamicResource Panel}"" BorderBrush=""{DynamicResource Line}"" BorderThickness=""0,0,0,1"" Padding=""14,0,14,0"">
              <TabPanel x:Name=""HeaderPanel"" IsItemsHost=""True""/>
            </Border>
            <!-- the name matters: WPF shows a tab's content to UI Automation (screen readers, the smoke test) only
                 through the part called PART_SelectedContentHost -->
            <ContentPresenter x:Name=""PART_SelectedContentHost"" ContentSource=""SelectedContent""/>
          </DockPanel>
        </ControlTemplate>
      </Setter.Value></Setter>
    </Style>
    <Style TargetType=""TabItem"">
      <Setter Property=""FocusVisualStyle"" Value=""{x:Null}""/><Setter Property=""Cursor"" Value=""Hand""/>
      <Setter Property=""Template""><Setter.Value>
        <ControlTemplate TargetType=""TabItem"">
          <Border x:Name=""Under"" Background=""Transparent"" BorderBrush=""Transparent"" BorderThickness=""0,0,0,3"" Padding=""14,10,14,8"" Margin=""0,0,2,0"">
            <ContentPresenter x:Name=""Head"" ContentSource=""Header"" RecognizesAccessKey=""False"" TextElement.FontFamily=""{DynamicResource PixelFont}"" TextElement.FontSize=""16"" TextElement.FontWeight=""Bold"" TextElement.Foreground=""{DynamicResource Muted}""/>
          </Border>
          <ControlTemplate.Triggers>
            <Trigger Property=""IsSelected"" Value=""True"">
              <Setter TargetName=""Head"" Property=""TextElement.Foreground"" Value=""{DynamicResource White}""/>
              <Setter TargetName=""Under"" Property=""BorderBrush"" Value=""{DynamicResource Copper}""/>
            </Trigger>
            <Trigger Property=""IsEnabled"" Value=""False""><Setter TargetName=""Head"" Property=""TextElement.Foreground"" Value=""{DynamicResource Dim}""/></Trigger>
          </ControlTemplate.Triggers>
        </ControlTemplate>
      </Setter.Value></Setter>
    </Style>";

        const string Ns = @"xmlns=""http://schemas.microsoft.com/winfx/2006/xaml/presentation"" xmlns:x=""http://schemas.microsoft.com/winfx/2006/xaml"" xmlns:dw=""clr-namespace:DeepslateWorks;assembly=DeepslateWorks""";

        /// <summary>The main window: the banner, then the Play, (Vote,) Extras and Log tabs, then the footer.</summary>
        public static readonly string AppXaml = @"<Window " + Ns + @"
        Title=""Deepslate Works"" Width=""600"" Height=""740"" MinWidth=""560"" MinHeight=""560"" WindowStartupLocation=""CenterScreen""
        FontFamily=""Segoe UI"" FontSize=""13"" Background=""{DynamicResource Ground}"" Foreground=""{DynamicResource Fg}"">
  <Window.Resources>" + ThemeXaml + @"
    <dw:MarkSplit x:Key=""MarkSplit""/>
    <DataTemplate x:Key=""MarkedLabel"">
      <TextBlock><Run Text=""{Binding Converter={StaticResource MarkSplit}, ConverterParameter=mark, Mode=OneWay}"" Foreground=""{DynamicResource Copper}""/><Run Text=""{Binding Converter={StaticResource MarkSplit}, ConverterParameter=rest, Mode=OneWay}""/></TextBlock>
    </DataTemplate>
  </Window.Resources>
  <Grid>
  <Rectangle x:Name=""GroundTile"" Opacity=""0.35"" RenderOptions.BitmapScalingMode=""NearestNeighbor""/>
  <DockPanel>
  <Grid x:Name=""Hero"" DockPanel.Dock=""Top"" Height=""160"" ClipToBounds=""True"">
    <Rectangle Fill=""{DynamicResource Panel}""/>
    <Image x:Name=""HeroImage"" Stretch=""UniformToFill"" StretchDirection=""Both"" VerticalAlignment=""Bottom"" HorizontalAlignment=""Center"" RenderOptions.BitmapScalingMode=""NearestNeighbor""/>
    <Rectangle x:Name=""HeroShade""/>
    <Border BorderBrush=""{DynamicResource Copper}"" BorderThickness=""0,0,0,3""/>
    <StackPanel x:Name=""BrandBar"" Orientation=""Horizontal"" HorizontalAlignment=""Left"" VerticalAlignment=""Bottom"" Margin=""18,0,0,14"">
      <Grid Width=""48"" Height=""48"" Margin=""0,0,12,0"" VerticalAlignment=""Bottom"">
        <Border x:Name=""LogoFallback"" BorderBrush=""{DynamicResource BoxLine}"" BorderThickness=""2"">
          <TextBlock Text=""D"" FontFamily=""{DynamicResource PixelFont}"" FontWeight=""Bold"" FontSize=""22"" Foreground=""{DynamicResource Copper}"" HorizontalAlignment=""Center"" VerticalAlignment=""Center""/>
        </Border>
        <Image x:Name=""BrandLogo"" Width=""48"" Height=""48"" Visibility=""Collapsed""/>
      </Grid>
      <StackPanel VerticalAlignment=""Bottom"">
        <Grid>
          <TextBlock Text=""{Binding Text, ElementName=BrandName}"" Margin=""3,3,-3,-3"" FontFamily=""{DynamicResource PixelFont}"" FontWeight=""Bold"" FontSize=""30"" Foreground=""{DynamicResource Shadow}""/>
          <TextBlock x:Name=""BrandName"" Text=""Deepslate Works"" FontFamily=""{DynamicResource PixelFont}"" FontWeight=""Bold"" FontSize=""30"" Foreground=""{DynamicResource White}""/>
        </Grid>
        <TextBlock x:Name=""BrandTagline"" FontSize=""12.5"" Margin=""0,5,0,0"" Foreground=""{DynamicResource CopperHi}""/>
      </StackPanel>
    </StackPanel>
    <Border x:Name=""HeroStatus"" HorizontalAlignment=""Right"" VerticalAlignment=""Top"" Margin=""0,14,16,0"" CornerRadius=""999"" Padding=""9,5,11,5""
            Background=""{DynamicResource Pill}"" BorderBrush=""{DynamicResource Line}"" BorderThickness=""1"">
      <StackPanel Orientation=""Horizontal"">
        <Ellipse x:Name=""HeroDot"" Width=""9"" Height=""9"" Margin=""0,0,7,0"" VerticalAlignment=""Center"" Fill=""{DynamicResource Dim}""/>
        <TextBlock x:Name=""HeroLine"" FontSize=""12"" FontWeight=""SemiBold"" Text=""Asking the site...""/>
      </StackPanel>
    </Border>
  </Grid>
  <Border DockPanel.Dock=""Bottom"" Background=""{DynamicResource Panel}"" BorderBrush=""{DynamicResource Line}"" BorderThickness=""0,1,0,0"" Padding=""16,8,16,10"">
    <StackPanel x:Name=""Footer"" Orientation=""Horizontal"" TextElement.FontSize=""11.5"" TextElement.Foreground=""{DynamicResource Dim}"">
      <TextBlock x:Name=""FooterApp""/>
      <TextBlock Text=""  ·  ""/>
      <TextBlock x:Name=""FooterPack""/>
      <TextBlock Text=""  ·  ""/>
      <TextBlock x:Name=""FooterServer""/>
    </StackPanel>
  </Border>
  <TabControl x:Name=""Tabs"" Style=""{StaticResource Strip}"" Background=""Transparent"" BorderThickness=""0"" Padding=""0"" Margin=""0"">
    <TabItem Header=""Play"" x:Name=""PlayTab"">
      <DockPanel Margin=""16,14,16,12"">
        <StackPanel DockPanel.Dock=""Top"" Margin=""0,0,0,10"">
          <TextBlock x:Name=""StepLabel"" Foreground=""{DynamicResource Blue}"" FontWeight=""SemiBold"" Margin=""0,0,0,2"" Visibility=""Collapsed""/>
          <TextBlock x:Name=""PlayTitle"" FontSize=""20"" FontWeight=""SemiBold"" Text=""Deepslate Works""/>
          <TextBlock x:Name=""PlayStatus"" TextWrapping=""Wrap"" Margin=""0,4,0,0"" Foreground=""{DynamicResource Muted}""/>
          <Border x:Name=""ServerBox"" Background=""{DynamicResource Card}"" BorderBrush=""{DynamicResource Line}"" BorderThickness=""1"" CornerRadius=""4"" Padding=""12,10"" Margin=""0,10,0,0"">
            <StackPanel>
              <DockPanel>
                <Button x:Name=""StartButton"" DockPanel.Dock=""Right"" Style=""{StaticResource Primary}"" Padding=""12,3,12,4"" Content=""Start"" Visibility=""Collapsed""/>
                <TextBlock x:Name=""SiteLinkLine"" DockPanel.Dock=""Right"" VerticalAlignment=""Center"" Margin=""10,0,10,0""><Hyperlink x:Name=""SiteLink"">Open the site</Hyperlink></TextBlock>
                <StackPanel Orientation=""Horizontal"" VerticalAlignment=""Center"">
                  <Ellipse x:Name=""ServerDot"" Width=""9"" Height=""9"" Fill=""{DynamicResource Dim}"" Margin=""0,0,7,0"" VerticalAlignment=""Center""/>
                  <TextBlock x:Name=""ServerLine"" FontWeight=""SemiBold"" TextWrapping=""Wrap"" Text=""Asking the site how the server is...""/>
                </StackPanel>
              </DockPanel>
              <TextBlock x:Name=""ServerHint"" TextWrapping=""Wrap"" Margin=""16,2,0,0"" Foreground=""{DynamicResource Muted}"" FontSize=""12"" Visibility=""Collapsed""/>
              <TextBlock x:Name=""ServerOnline"" TextWrapping=""Wrap"" Margin=""16,2,0,0"" Foreground=""{DynamicResource Muted}"" FontSize=""12"" Visibility=""Collapsed""/>
              <Border x:Name=""NewsBox"" BorderBrush=""{DynamicResource Line}"" BorderThickness=""0,1,0,0"" Margin=""0,8,0,0"" Padding=""0,7,0,0"" Visibility=""Collapsed"">
                <StackPanel>
                  <TextBlock x:Name=""NewsText"" TextWrapping=""Wrap"" FontSize=""12.5""/>
                  <TextBlock x:Name=""NewsMeta"" Foreground=""{DynamicResource Dim}"" FontSize=""11"" Margin=""0,3,0,0""/>
                </StackPanel>
              </Border>
            </StackPanel>
          </Border>
          <Border x:Name=""ChangedBox"" Background=""{DynamicResource Card}"" BorderBrush=""{DynamicResource Line}"" BorderThickness=""1"" CornerRadius=""4"" Padding=""12,8"" Margin=""0,10,0,0""
                  Visibility=""{Binding Visibility, ElementName=PlayChanged}"">
            <StackPanel>
              <TextBlock x:Name=""PlayChanged"" TextWrapping=""Wrap"" Foreground=""{DynamicResource GreenText}"" FontWeight=""SemiBold"" Visibility=""Collapsed""/>
              <TextBlock x:Name=""PlayChangedDetail"" TextWrapping=""Wrap"" Foreground=""{DynamicResource Muted}"" FontSize=""12"" Margin=""0,3,0,0"" Visibility=""Collapsed""/>
            </StackPanel>
          </Border>
        </StackPanel>
        <DockPanel DockPanel.Dock=""Bottom"" Margin=""0,10,0,0"">
          <StackPanel DockPanel.Dock=""Left"" VerticalAlignment=""Center"" TextElement.FontSize=""12.5"">
            <TextBlock><Hyperlink x:Name=""ReviewLink"">Review permissions</Hyperlink></TextBlock>
            <TextBlock Margin=""0,5,0,0""><Hyperlink x:Name=""SettingsLink"">Play settings</Hyperlink></TextBlock>
          </StackPanel>
          <StackPanel DockPanel.Dock=""Right"" HorizontalAlignment=""Right"">
            <StackPanel Orientation=""Horizontal"" HorizontalAlignment=""Right"">
              <Button x:Name=""AllowAllButton"" Style=""{StaticResource Plain}"" Content=""Allow all"" Visibility=""Collapsed""/>
              <Button x:Name=""ResetButton"" Style=""{StaticResource Plain}"" Content=""Reset all"" Visibility=""Collapsed""/>
              <Button x:Name=""PlayButton"" Style=""{StaticResource PlayBlock}"" Content=""Play"" MinWidth=""190""/>
              <Button x:Name=""UpdateButton"" Style=""{StaticResource Plain}"" ContentTemplate=""{StaticResource MarkedLabel}"" Content=""Update"" MinWidth=""118"" Margin=""8,0,0,0"" Padding=""12,6,12,7""/>
            </StackPanel>
            <TextBlock x:Name=""PlayHint"" HorizontalAlignment=""Right"" Margin=""0,5,0,0"" Foreground=""{DynamicResource Muted}"" FontSize=""12"" Visibility=""Collapsed""/>
            <TextBlock x:Name=""UpdateLine"" HorizontalAlignment=""Right"" TextAlignment=""Right"" TextWrapping=""Wrap"" MaxWidth=""380"" Margin=""0,4,0,0"" Foreground=""{DynamicResource Muted}"" FontSize=""12"" Visibility=""Collapsed""/>
          </StackPanel>
        </DockPanel>
        <ScrollViewer VerticalScrollBarVisibility=""Auto""><StackPanel x:Name=""PlayBody""/></ScrollViewer>
      </DockPanel>
    </TabItem>
    <TabItem x:Name=""VoteTab"" Visibility=""Collapsed"">
      <TabItem.Header>
        <StackPanel Orientation=""Horizontal"">
          <TextBlock Text=""Vote""/>
          <Border x:Name=""VoteBadge"" Background=""{DynamicResource Copper}"" CornerRadius=""3"" Padding=""5,0"" Margin=""6,0,0,0"" VerticalAlignment=""Center"" Visibility=""Collapsed"">
            <TextBlock x:Name=""VoteBadgeText"" FontFamily=""Segoe UI"" FontSize=""12"" FontWeight=""SemiBold"" Foreground=""{DynamicResource OnCopper}""/>
          </Border>
        </StackPanel>
      </TabItem.Header>
      <DockPanel Margin=""16,14,16,12"">
        <StackPanel DockPanel.Dock=""Top"" Margin=""0,0,0,10"">
          <TextBlock x:Name=""VoteStep"" Foreground=""{DynamicResource Blue}"" FontWeight=""SemiBold"" FontSize=""12"" Margin=""0,0,0,2""/>
          <TextBlock x:Name=""VoteTitle"" FontSize=""20"" FontWeight=""SemiBold"" TextWrapping=""Wrap""/>
          <TextBlock x:Name=""VoteNote"" TextWrapping=""Wrap"" Margin=""0,4,0,0"" Foreground=""{DynamicResource Muted}""/>
        </StackPanel>
        <DockPanel DockPanel.Dock=""Bottom"" Margin=""0,10,0,0"">
          <Button x:Name=""VoteButton"" DockPanel.Dock=""Right"" Style=""{StaticResource VoteBlock}"" Content=""Vote"" MinWidth=""150""/>
          <TextBlock x:Name=""VoteError"" TextWrapping=""Wrap"" VerticalAlignment=""Center"" Margin=""0,0,12,0"" Foreground=""{DynamicResource Red}"" FontWeight=""SemiBold""/>
        </DockPanel>
        <ScrollViewer VerticalScrollBarVisibility=""Auto""><StackPanel x:Name=""VoteBody""/></ScrollViewer>
      </DockPanel>
    </TabItem>
    <TabItem Header=""Extras"" x:Name=""ExtrasTab"">
      <DockPanel Margin=""16,14,16,12"">
        <StackPanel DockPanel.Dock=""Top"" Margin=""0,0,0,8"">
          <TextBlock FontSize=""20"" FontFamily=""{DynamicResource PixelFont}"" FontWeight=""Bold"" Text=""Extras""/>
          <TextBlock TextWrapping=""Wrap"" Margin=""0,2,0,8"" Foreground=""{DynamicResource Muted}"" Text=""Only on this PC, never voted on. Other players don't need them: you can play together either way.""/>
          <Border x:Name=""HeadlineBox"" Background=""{DynamicResource Card2}"" BorderBrush=""{DynamicResource Line}"" BorderThickness=""1"" CornerRadius=""4"" Padding=""12,10"">
            <DockPanel>
              <Button x:Name=""HeadlineButton"" DockPanel.Dock=""Right"" Style=""{StaticResource Primary}"" Padding=""12,4,12,5"" Visibility=""Collapsed""/>
              <TextBlock x:Name=""HeadlineText"" TextWrapping=""Wrap"" VerticalAlignment=""Center"" FontWeight=""SemiBold"" Margin=""0,0,10,0""/>
            </DockPanel>
          </Border>
          <TextBlock x:Name=""ErrorLine"" TextWrapping=""Wrap"" Margin=""0,8,0,0"" Foreground=""{DynamicResource Red}"" FontWeight=""SemiBold"" Visibility=""Collapsed"">
            <Run x:Name=""ErrorText""/> <Hyperlink x:Name=""DetailsLink"">Show details</Hyperlink>
          </TextBlock>
          <StackPanel x:Name=""ProgressBox"" Margin=""0,8,0,0"" Visibility=""Collapsed""/>
        </StackPanel>
        <DockPanel DockPanel.Dock=""Bottom"" Margin=""0,10,0,0"">
          <Button x:Name=""CheckButton"" DockPanel.Dock=""Left"" Style=""{StaticResource Plain}"" Content=""Check extras""/>
          <Button x:Name=""ApplyButton"" DockPanel.Dock=""Right"" Style=""{StaticResource Primary}"" Content=""Apply"" MinWidth=""120""/>
          <TextBlock x:Name=""ExtrasStatus"" TextWrapping=""Wrap"" VerticalAlignment=""Center"" Margin=""4,0,12,0"" Foreground=""{DynamicResource Muted}""/>
        </DockPanel>
        <ScrollViewer VerticalScrollBarVisibility=""Auto"">
          <StackPanel>
            <StackPanel x:Name=""ExtrasBody""/>
            <TextBlock x:Name=""ChecksTitle"" Text=""Checks"" FontSize=""15"" FontFamily=""{DynamicResource PixelFont}"" FontWeight=""Bold"" Margin=""0,10,0,4"" Visibility=""Collapsed""/>
            <StackPanel x:Name=""ChecksBody""/>
          </StackPanel>
        </ScrollViewer>
      </DockPanel>
    </TabItem>
    <TabItem Header=""Log"" x:Name=""LogTab"">
      <ListBox x:Name=""LogList"" Margin=""0"" Padding=""10,6"" FontFamily=""Consolas"" FontSize=""12"" BorderThickness=""0"" Background=""{DynamicResource Panel}"" Foreground=""{DynamicResource Muted}""/>
    </TabItem>
  </TabControl>
  </DockPanel>
  </Grid>
</Window>";

        /// <summary>One question with up to three answers (Yes / Later / Allow all). The text says what will happen; Allow all
        /// says what it will remember, so nothing is hidden behind it.</summary>
        public static readonly string AskXaml = @"<Window " + Ns + @"
        Title=""Deepslate Works"" Width=""440"" SizeToContent=""Height"" ResizeMode=""NoResize"" WindowStartupLocation=""CenterOwner""
        FontFamily=""Segoe UI"" FontSize=""13"" Background=""{DynamicResource Card}"" Foreground=""{DynamicResource Fg}"">
  <Window.Resources>" + ThemeXaml + @"
  </Window.Resources>
  <StackPanel Margin=""18"">
    <TextBlock x:Name=""Q"" FontSize=""16"" FontWeight=""SemiBold"" TextWrapping=""Wrap""/>
    <TextBlock x:Name=""Why"" TextWrapping=""Wrap"" Margin=""0,8,0,6"" Foreground=""{DynamicResource Muted}""/>
    <TextBlock x:Name=""AllNote"" TextWrapping=""Wrap"" Margin=""0,0,0,14"" Foreground=""{DynamicResource Muted}"" FontSize=""12""/>
    <StackPanel Orientation=""Horizontal"" HorizontalAlignment=""Right"">
      <Button x:Name=""Later"" Style=""{StaticResource Plain}"" Content=""Later""/>
      <Button x:Name=""All"" Style=""{StaticResource Plain}"" Content=""Allow all""/>
      <Button x:Name=""Yes"" Style=""{StaticResource Primary}"" Content=""Yes""/>
    </StackPanel>
  </StackPanel>
</Window>";

        /// <summary>3.1.0: the cog on the Play tab, "When I press Play on the website". A change is saved at once.</summary>
        public static readonly string SettingsXaml = @"<Window " + Ns + @"
        Title=""Play settings"" Width=""400"" SizeToContent=""Height"" ResizeMode=""NoResize"" WindowStartupLocation=""CenterOwner""
        FontFamily=""Segoe UI"" FontSize=""13"" Background=""{DynamicResource Card}"" Foreground=""{DynamicResource Fg}"">
  <Window.Resources>" + ThemeXaml + @"
  </Window.Resources>
  <StackPanel Margin=""18"">
    <TextBlock x:Name=""SQ"" FontSize=""16"" FontWeight=""SemiBold"" TextWrapping=""Wrap"" Margin=""0,0,0,10""/>
    <StackPanel x:Name=""SChoices""/>
    <TextBlock x:Name=""SNote"" TextWrapping=""Wrap"" Margin=""0,10,0,14"" Foreground=""{DynamicResource Muted}"" FontSize=""12""/>
    <Button x:Name=""SDone"" Style=""{StaticResource Primary}"" Content=""Done"" HorizontalAlignment=""Right""/>
  </StackPanel>
</Window>";

        /// <summary>The restart question uses the same window (the self test and the screenshots refer to it).</summary>
        public static readonly string RestartXaml = AskXaml;

        /// <summary>Every name the window looks up in AppXaml.</summary>
        public static readonly string[] Names =
        {
            "Tabs", "PlayTab", "ExtrasTab", "LogTab", "PlayTitle", "PlayStatus", "PlayChanged", "ReviewLink", "ResetButton", "AllowAllButton", "PlayButton", "PlayBody",
            "HeadlineBox", "HeadlineText", "HeadlineButton", "ErrorLine", "ErrorText", "DetailsLink", "ProgressBox", "CheckButton", "ApplyButton", "ExtrasStatus", "ExtrasBody", "ChecksTitle", "ChecksBody", "LogList",
            "BrandBar", "BrandLogo", "BrandName", "BrandTagline", "Footer", "FooterApp", "FooterPack", "FooterServer",
            "StepLabel", "SettingsLink", "PlayHint",
            // 3.2.0 (planner 2026-10-02): the server on the Play tab, and the Vote tab
            "ServerBox", "ServerDot", "ServerLine", "ServerHint", "ServerOnline", "StartButton", "SiteLink", "NewsBox", "NewsText", "NewsMeta",
            "VoteTab", "VoteStep", "VoteTitle", "VoteNote", "VoteBody", "VoteButton", "VoteError",
            "UpdateButton", "UpdateLine",   // 3.3.0
            // 3.4.0 (docs/21): the ground, the banner with the server pill, the drawn logo, the Vote tab's badge, the card
            // round "Since last time"
            "ChangedBox", "PlayChangedDetail", "GroundTile", "Hero", "HeroImage", "HeroShade", "HeroStatus", "HeroDot", "HeroLine", "LogoFallback", "VoteBadge", "VoteBadgeText",
        };

        /// <summary>Every name the settings window looks up in SettingsXaml.</summary>
        public static readonly string[] SettingsNames = { "SQ", "SChoices", "SNote", "SDone" };

        /// <summary>Every name the question window looks up in AskXaml.</summary>
        public static readonly string[] AskNames = { "Q", "Why", "AllNote", "Later", "All", "Yes" };
    }
}

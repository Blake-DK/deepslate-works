namespace DeepslateWorks
{
    public static partial class AppWindow
    {
        // The windows' layout, loaded at run time with XamlReader.Parse (no XAML compilation; AppWindow.Load). 3.4.0
        // (docs/21): the dark look; 3.4.1 (§11): landscape, crisp text, the pixel face only in the name, Play and Vote. No colour is written here: every brush is a {DynamicResource Key} from Theme, which
        // Load puts into the window's resources; the shared styles (ThemeXaml) go into both windows (3.5.0: the settings window went).

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
                @"<Setter Property=""FontFamily"" Value=""{DynamicResource PixelFont}""/><Setter Property=""TextOptions.TextRenderingMode"" Value=""Aliased""/><Setter Property=""FontSize"" Value=""24""/><Setter Property=""FontWeight"" Value=""Bold""/><Setter Property=""Padding"" Value=""20,5,20,7""/>")
          + BlockStyle("VoteBlock", "Copper", "CopperHi", "CopperLo", "OnCopper", "CopperHi",
                @"<Setter Property=""FontFamily"" Value=""{DynamicResource PixelFont}""/><Setter Property=""TextOptions.TextRenderingMode"" Value=""Aliased""/><Setter Property=""FontSize"" Value=""22""/><Setter Property=""FontWeight"" Value=""Bold""/><Setter Property=""Padding"" Value=""20,5,20,7""/>")
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
    <!-- 3.5.0 (docs/30): the Settings tab's controls in the window's look: a slider with a copper block, a switch that
         is the vote's check box, a choice that is a round one -->
    <Style TargetType=""RepeatButton"" x:Key=""SliderFill"">
      <Setter Property=""Focusable"" Value=""False""/><Setter Property=""IsTabStop"" Value=""False""/>
      <Setter Property=""Template""><Setter.Value>
        <ControlTemplate TargetType=""RepeatButton""><Grid Background=""Transparent""><Border x:Name=""Bar"" Height=""4"" VerticalAlignment=""Center"" Background=""{DynamicResource Copper}""/></Grid>
          <ControlTemplate.Triggers><Trigger Property=""IsEnabled"" Value=""False""><Setter TargetName=""Bar"" Property=""Background"" Value=""{DynamicResource Disabled}""/></Trigger></ControlTemplate.Triggers>
        </ControlTemplate>
      </Setter.Value></Setter>
    </Style>
    <Style TargetType=""RepeatButton"" x:Key=""SliderGap"">
      <Setter Property=""Focusable"" Value=""False""/><Setter Property=""IsTabStop"" Value=""False""/>
      <Setter Property=""Template""><Setter.Value>
        <ControlTemplate TargetType=""RepeatButton""><Grid Background=""Transparent""><Border Height=""4"" VerticalAlignment=""Center"" Background=""{DynamicResource Line}""/></Grid></ControlTemplate>
      </Setter.Value></Setter>
    </Style>
    <Style TargetType=""Thumb"" x:Key=""SliderThumb"">
      <Setter Property=""Template""><Setter.Value>
        <ControlTemplate TargetType=""Thumb"">
          <Border x:Name=""Knob"" Width=""12"" Height=""20"" Background=""{DynamicResource Copper}"" BorderBrush=""{DynamicResource Black}"" BorderThickness=""2"" SnapsToDevicePixels=""True""/>
          <ControlTemplate.Triggers>
            <Trigger Property=""IsMouseOver"" Value=""True""><Setter TargetName=""Knob"" Property=""Background"" Value=""{DynamicResource CopperHi}""/></Trigger>
            <Trigger Property=""IsEnabled"" Value=""False""><Setter TargetName=""Knob"" Property=""Background"" Value=""{DynamicResource Disabled}""/></Trigger>
          </ControlTemplate.Triggers>
        </ControlTemplate>
      </Setter.Value></Setter>
    </Style>
    <Style TargetType=""Slider"">
      <Setter Property=""Cursor"" Value=""Hand""/><Setter Property=""IsMoveToPointEnabled"" Value=""True""/><Setter Property=""IsSnapToTickEnabled"" Value=""True""/><Setter Property=""VerticalAlignment"" Value=""Center""/>
      <Setter Property=""Template""><Setter.Value>
        <ControlTemplate TargetType=""Slider"">
          <Grid Height=""24"" Background=""Transparent"">
            <Track x:Name=""PART_Track"">
              <Track.DecreaseRepeatButton><RepeatButton Style=""{StaticResource SliderFill}"" Command=""{x:Static Slider.DecreaseLarge}""/></Track.DecreaseRepeatButton>
              <Track.IncreaseRepeatButton><RepeatButton Style=""{StaticResource SliderGap}"" Command=""{x:Static Slider.IncreaseLarge}""/></Track.IncreaseRepeatButton>
              <Track.Thumb><Thumb Style=""{StaticResource SliderThumb}""/></Track.Thumb>
            </Track>
          </Grid>
        </ControlTemplate>
      </Setter.Value></Setter>
    </Style>
    <Style TargetType=""CheckBox"" x:Key=""Switch"">
      <Setter Property=""Cursor"" Value=""Hand""/><Setter Property=""Foreground"" Value=""{DynamicResource Fg}""/><Setter Property=""FocusVisualStyle"" Value=""{x:Null}""/>
      <Setter Property=""Template""><Setter.Value>
        <ControlTemplate TargetType=""CheckBox"">
          <DockPanel Background=""Transparent"">
            <Border x:Name=""Box"" DockPanel.Dock=""Left"" Width=""16"" Height=""16"" Margin=""0,2,0,0"" VerticalAlignment=""Top"" Background=""{DynamicResource Shadow}"" BorderBrush=""{DynamicResource BoxLine}"" BorderThickness=""2"" SnapsToDevicePixels=""True"">
              <TextBlock x:Name=""Tick"" Text=""✓"" FontSize=""11"" FontWeight=""Bold"" Foreground=""{DynamicResource CopperHi}"" HorizontalAlignment=""Center"" VerticalAlignment=""Center"" Margin=""0,-2,0,0"" Visibility=""Hidden""/>
            </Border>
            <ContentPresenter Margin=""8,0,0,0"" VerticalAlignment=""Center"" RecognizesAccessKey=""False""/>
          </DockPanel>
          <ControlTemplate.Triggers>
            <Trigger Property=""IsChecked"" Value=""True""><Setter TargetName=""Tick"" Property=""Visibility"" Value=""Visible""/></Trigger>
            <Trigger Property=""IsMouseOver"" Value=""True""><Setter TargetName=""Box"" Property=""BorderBrush"" Value=""{DynamicResource Copper}""/></Trigger>
            <Trigger Property=""IsEnabled"" Value=""False""><Setter Property=""Foreground"" Value=""{DynamicResource Dim}""/><Setter TargetName=""Box"" Property=""BorderBrush"" Value=""{DynamicResource Line}""/><Setter TargetName=""Tick"" Property=""Foreground"" Value=""{DynamicResource Dim}""/></Trigger>
          </ControlTemplate.Triggers>
        </ControlTemplate>
      </Setter.Value></Setter>
    </Style>
    <Style TargetType=""RadioButton"" x:Key=""Choice"">
      <Setter Property=""Cursor"" Value=""Hand""/><Setter Property=""Foreground"" Value=""{DynamicResource Fg}""/><Setter Property=""FocusVisualStyle"" Value=""{x:Null}""/><Setter Property=""Margin"" Value=""0,0,14,0""/>
      <Setter Property=""Template""><Setter.Value>
        <ControlTemplate TargetType=""RadioButton"">
          <StackPanel Orientation=""Horizontal"" Background=""Transparent"">
            <Grid Width=""16"" Height=""16"" VerticalAlignment=""Center"">
              <Ellipse x:Name=""Ring"" Fill=""{DynamicResource Shadow}"" Stroke=""{DynamicResource BoxLine}"" StrokeThickness=""2""/>
              <Ellipse x:Name=""Dot"" Width=""6"" Height=""6"" Fill=""{DynamicResource CopperHi}"" Visibility=""Hidden""/>
            </Grid>
            <ContentPresenter Margin=""6,0,0,0"" VerticalAlignment=""Center"" RecognizesAccessKey=""False""/>
          </StackPanel>
          <ControlTemplate.Triggers>
            <Trigger Property=""IsChecked"" Value=""True""><Setter TargetName=""Dot"" Property=""Visibility"" Value=""Visible""/></Trigger>
            <Trigger Property=""IsMouseOver"" Value=""True""><Setter TargetName=""Ring"" Property=""Stroke"" Value=""{DynamicResource Copper}""/></Trigger>
            <Trigger Property=""IsEnabled"" Value=""False""><Setter Property=""Foreground"" Value=""{DynamicResource Dim}""/><Setter TargetName=""Ring"" Property=""Stroke"" Value=""{DynamicResource Line}""/></Trigger>
          </ControlTemplate.Triggers>
        </ControlTemplate>
      </Setter.Value></Setter>
    </Style>
    <Style TargetType=""TabControl"" x:Key=""Strip"">
      <Setter Property=""Foreground"" Value=""{DynamicResource Fg}""/>
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
      <!-- 3.5.4 (Alex, 2026-10-06): a tab's content takes its text colour from its TabItem, whose default is Windows'
           control text colour, black: every TextBlock with no colour of its own (the server line, the pinned news,
           the titles) was black on the dark cards. LookTests reads every text on every tab against its background. -->
      <Setter Property=""Foreground"" Value=""{DynamicResource Fg}""/>
      <Setter Property=""FocusVisualStyle"" Value=""{x:Null}""/><Setter Property=""Cursor"" Value=""Hand""/>
      <Setter Property=""Template""><Setter.Value>
        <ControlTemplate TargetType=""TabItem"">
          <Border x:Name=""Under"" Background=""Transparent"" BorderBrush=""Transparent"" BorderThickness=""0,0,0,3"" Padding=""14,10,14,8"" Margin=""0,0,2,0"">
            <ContentPresenter x:Name=""Head"" ContentSource=""Header"" RecognizesAccessKey=""False"" TextElement.FontFamily=""Segoe UI"" TextElement.FontSize=""14"" TextElement.FontWeight=""SemiBold"" TextElement.Foreground=""{DynamicResource Muted}""/>
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

        /// <summary>The main window: the banner, then the Play, (Vote,) Extras, Settings and Log tabs, then the footer.</summary>
        public static readonly string AppXaml = @"<Window " + Ns + @"
        Title=""Deepslate Works"" Width=""980"" Height=""720"" MinWidth=""900"" MinHeight=""560"" WindowStartupLocation=""CenterScreen""
        FontFamily=""Segoe UI"" FontSize=""14"" TextOptions.TextFormattingMode=""Display"" TextOptions.TextRenderingMode=""ClearType"" UseLayoutRounding=""True"" SnapsToDevicePixels=""True"" Background=""{DynamicResource Ground}"" Foreground=""{DynamicResource Fg}"">
  <Window.Resources>" + ThemeXaml + @"
    <dw:MarkSplit x:Key=""MarkSplit""/>
    <DataTemplate x:Key=""MarkedLabel"">
      <TextBlock><Run Text=""{Binding Converter={StaticResource MarkSplit}, ConverterParameter=mark, Mode=OneWay}"" Foreground=""{DynamicResource Copper}""/><Run Text=""{Binding Converter={StaticResource MarkSplit}, ConverterParameter=rest, Mode=OneWay}""/></TextBlock>
    </DataTemplate>
  </Window.Resources>
  <Grid>
  <Rectangle x:Name=""GroundTile"" Opacity=""0.35"" RenderOptions.BitmapScalingMode=""NearestNeighbor""/>
  <DockPanel>
  <Grid x:Name=""Hero"" DockPanel.Dock=""Top"" Height=""128"" ClipToBounds=""True"">
    <Rectangle Fill=""{DynamicResource Panel}""/>
    <Image x:Name=""HeroImage"" Stretch=""UniformToFill"" StretchDirection=""Both"" VerticalAlignment=""Bottom"" HorizontalAlignment=""Center"" RenderOptions.BitmapScalingMode=""NearestNeighbor""/>
    <Rectangle x:Name=""HeroShade""/>
    <Border BorderBrush=""{DynamicResource Copper}"" BorderThickness=""0,0,0,3""/>
    <StackPanel x:Name=""BrandBar"" Orientation=""Horizontal"" HorizontalAlignment=""Left"" VerticalAlignment=""Bottom"" Margin=""18,0,0,14"">
      <Grid Width=""48"" Height=""48"" Margin=""0,0,12,0"" VerticalAlignment=""Bottom"">
        <Border x:Name=""LogoFallback"" BorderBrush=""{DynamicResource BoxLine}"" BorderThickness=""2"">
          <TextBlock Text=""D"" FontFamily=""Segoe UI"" FontWeight=""Bold"" FontSize=""24"" Foreground=""{DynamicResource Copper}"" HorizontalAlignment=""Center"" VerticalAlignment=""Center""/>
        </Border>
        <Image x:Name=""BrandLogo"" Width=""48"" Height=""48"" Visibility=""Collapsed""/>
      </Grid>
      <StackPanel VerticalAlignment=""Bottom"">
        <Grid>
          <TextBlock x:Name=""BrandShade"" Text=""{Binding Text, ElementName=BrandName}"" Margin=""3,3,-3,-3"" FontFamily=""{DynamicResource PixelFont}"" TextOptions.TextRenderingMode=""Aliased"" FontWeight=""Bold"" FontSize=""32"" Foreground=""{DynamicResource Shadow}""/>
          <TextBlock x:Name=""BrandName"" Text=""Deepslate Works"" FontFamily=""{DynamicResource PixelFont}"" TextOptions.TextRenderingMode=""Aliased"" FontWeight=""Bold"" FontSize=""32"" Foreground=""{DynamicResource White}""/>
        </Grid>
        <TextBlock x:Name=""BrandTagline"" FontSize=""13"" Margin=""0,5,0,0"" Foreground=""{DynamicResource CopperHi}""/>
      </StackPanel>
    </StackPanel>
    <Border x:Name=""HeroStatus"" HorizontalAlignment=""Right"" VerticalAlignment=""Top"" Margin=""0,14,16,0"" CornerRadius=""999"" Padding=""9,5,11,5""
            Background=""{DynamicResource Pill}"" BorderBrush=""{DynamicResource Line}"" BorderThickness=""1"">
      <StackPanel Orientation=""Horizontal"">
        <Ellipse x:Name=""HeroDot"" Width=""9"" Height=""9"" Margin=""0,0,7,0"" VerticalAlignment=""Center"" Fill=""{DynamicResource Dim}""/>
        <TextBlock x:Name=""HeroLine"" FontSize=""13"" FontWeight=""SemiBold"" Foreground=""{DynamicResource Fg}"" Text=""Asking the site...""/>
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
      <!-- 3.4.1 (docs/21 §11): two columns, the server on the left, the run on the right, the buttons along the bottom -->
      <Grid x:Name=""PlayGrid"" Margin=""16,14,16,12"">
        <Grid.ColumnDefinitions><ColumnDefinition Width=""340""/><ColumnDefinition Width=""16""/><ColumnDefinition Width=""*""/></Grid.ColumnDefinitions>
        <Grid.RowDefinitions><RowDefinition Height=""*""/><RowDefinition Height=""12""/><RowDefinition Height=""Auto""/></Grid.RowDefinitions>
        <!-- 3.5.4: the cards keep their width; the news card takes the room that is left, and only its text scrolls when it is longer -->
        <DockPanel x:Name=""PlayLeft"" Grid.Column=""0"" Grid.Row=""0"" LastChildFill=""True"" ClipToBounds=""True"">
          <Border x:Name=""ServerBox"" DockPanel.Dock=""Top"" Background=""{DynamicResource Card}"" BorderBrush=""{DynamicResource Line}"" BorderThickness=""1"" CornerRadius=""4"" Padding=""12,10"">
            <StackPanel>
              <DockPanel>
                <Button x:Name=""StartButton"" DockPanel.Dock=""Right"" Style=""{StaticResource Primary}"" Padding=""12,3,12,4"" Margin=""10,0,0,0"" VerticalAlignment=""Top"" Content=""Start"" Visibility=""Collapsed""/>
                <Ellipse x:Name=""ServerDot"" DockPanel.Dock=""Left"" Width=""9"" Height=""9"" Fill=""{DynamicResource Dim}"" Margin=""0,6,7,0"" VerticalAlignment=""Top""/>
                <TextBlock x:Name=""ServerLine"" FontSize=""14"" FontWeight=""SemiBold"" TextWrapping=""Wrap"" Text=""Asking the site how the server is...""/>
              </DockPanel>
              <TextBlock x:Name=""SiteLinkLine"" Margin=""16,3,0,0""><Hyperlink x:Name=""SiteLink"">Open the site</Hyperlink></TextBlock>
              <TextBlock x:Name=""ServerHint"" TextWrapping=""Wrap"" Margin=""16,2,0,0"" Foreground=""{DynamicResource Muted}"" FontSize=""12"" Visibility=""Collapsed""/>
              <DockPanel Margin=""16,4,0,0"">
                <StackPanel x:Name=""OnlineHeads"" DockPanel.Dock=""Left"" Orientation=""Horizontal"" VerticalAlignment=""Center"" Visibility=""Collapsed""/>
                <TextBlock x:Name=""ServerOnline"" TextWrapping=""Wrap"" VerticalAlignment=""Center"" Foreground=""{DynamicResource Muted}"" FontSize=""12"" Visibility=""Collapsed""/>
              </DockPanel>
            </StackPanel>
          </Border>
          <Border x:Name=""ChangedBox"" DockPanel.Dock=""Top"" Background=""{DynamicResource Card}"" BorderBrush=""{DynamicResource Line}"" BorderThickness=""1"" CornerRadius=""4"" Padding=""12,8"" Margin=""0,10,0,0""
                  Visibility=""{Binding Visibility, ElementName=PlayChanged}"">
            <StackPanel>
              <TextBlock x:Name=""PlayChanged"" TextWrapping=""Wrap"" Foreground=""{DynamicResource GreenText}"" FontWeight=""SemiBold"" Visibility=""Collapsed""/>
              <TextBlock x:Name=""PlayChangedDetail"" TextWrapping=""Wrap"" Foreground=""{DynamicResource Muted}"" FontSize=""12"" Margin=""0,3,0,0"" Visibility=""Collapsed""/>
            </StackPanel>
          </Border>
          <!-- 3.5.3 (Alex, 2026-10-06): the pinned news in a card of its own, larger, and the whole card opens it on the site -->
          <Border x:Name=""NewsBox"" VerticalAlignment=""Top"" Margin=""0,10,0,0"" CornerRadius=""4"" Padding=""12,10"" Cursor=""Hand"" Visibility=""Collapsed"">
            <Border.Style>
              <Style TargetType=""Border"">
                <Setter Property=""Background"" Value=""{DynamicResource Card}""/>
                <Setter Property=""BorderBrush"" Value=""{DynamicResource Line}""/>
                <Setter Property=""BorderThickness"" Value=""1""/>
                <Style.Triggers><Trigger Property=""IsMouseOver"" Value=""True""><Setter Property=""BorderBrush"" Value=""{DynamicResource Copper}""/></Trigger></Style.Triggers>
              </Style>
            </Border.Style>
            <DockPanel>
              <DockPanel DockPanel.Dock=""Top"">
                <TextBlock x:Name=""NewsOpen"" DockPanel.Dock=""Right"" Foreground=""{DynamicResource Blue}"" FontSize=""12"" Text=""Read it on the site ›""/>
                <TextBlock Text=""PINNED NEWS"" Foreground=""{DynamicResource Copper}"" FontSize=""11.5"" FontWeight=""SemiBold""/>
              </DockPanel>
              <TextBlock x:Name=""NewsMeta"" DockPanel.Dock=""Bottom"" Foreground=""{DynamicResource Muted}"" FontSize=""12"" Margin=""0,6,0,0""/>
              <ScrollViewer x:Name=""NewsScroll"" VerticalScrollBarVisibility=""Auto"" HorizontalScrollBarVisibility=""Disabled"" Margin=""0,6,0,0"" Focusable=""False"">
                <ScrollViewer.Resources>
                  <Style TargetType=""ScrollBar"">
                    <Setter Property=""Width"" Value=""8""/><Setter Property=""MinWidth"" Value=""8""/><Setter Property=""Margin"" Value=""6,0,0,0""/><Setter Property=""Cursor"" Value=""Arrow""/>
                    <Setter Property=""Template""><Setter.Value>
                      <ControlTemplate TargetType=""ScrollBar"">
                        <Border Background=""{DynamicResource Line}"" CornerRadius=""4"">
                          <Track x:Name=""PART_Track"" Orientation=""Vertical"" IsDirectionReversed=""True"">
                            <Track.Thumb><Thumb><Thumb.Template><ControlTemplate TargetType=""Thumb""><Border Background=""{DynamicResource BoxLine}"" CornerRadius=""4""/></ControlTemplate></Thumb.Template></Thumb></Track.Thumb>
                          </Track>
                        </Border>
                      </ControlTemplate>
                    </Setter.Value></Setter>
                  </Style>
                </ScrollViewer.Resources>
                <TextBlock x:Name=""NewsText"" TextWrapping=""Wrap"" Foreground=""{DynamicResource Fg}"" FontSize=""14"" LineHeight=""21"" LineStackingStrategy=""BlockLineHeight""/>
              </ScrollViewer>
            </DockPanel>
          </Border>
        </DockPanel>
        <DockPanel x:Name=""PlayRight"" Grid.Column=""2"" Grid.Row=""0"">
          <StackPanel DockPanel.Dock=""Top"" Margin=""0,0,0,10"">
            <TextBlock x:Name=""StepLabel"" Foreground=""{DynamicResource Blue}"" FontWeight=""SemiBold"" Margin=""0,0,0,2"" Visibility=""Collapsed""/>
            <TextBlock x:Name=""PlayTitle"" FontSize=""20"" FontWeight=""SemiBold"" Text=""Deepslate Works""/>
            <TextBlock x:Name=""PlayStatus"" TextWrapping=""Wrap"" Margin=""0,4,0,0"" Foreground=""{DynamicResource Muted}""/>
          </StackPanel>
          <Border x:Name=""PlayCard"" Background=""{DynamicResource Card}"" BorderBrush=""{DynamicResource Line}"" BorderThickness=""1"" CornerRadius=""4"" Padding=""12,10"">
            <ScrollViewer VerticalScrollBarVisibility=""Auto""><StackPanel x:Name=""PlayBody""/></ScrollViewer>
          </Border>
        </DockPanel>
        <DockPanel x:Name=""PlayRow"" Grid.Column=""0"" Grid.ColumnSpan=""3"" Grid.Row=""2"">
          <StackPanel DockPanel.Dock=""Left"" Orientation=""Horizontal"" VerticalAlignment=""Center"" TextElement.FontSize=""12.5"">
            <TextBlock><Hyperlink x:Name=""ReviewLink"">Review permissions</Hyperlink></TextBlock>
            <TextBlock Margin=""18,0,0,0""><Hyperlink x:Name=""SettingsLink"">Settings</Hyperlink></TextBlock>
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
      </Grid>
    </TabItem>
    <TabItem x:Name=""VoteTab"" Visibility=""Collapsed"">
      <TabItem.Header>
        <StackPanel Orientation=""Horizontal"">
          <TextBlock Text=""Vote"" Foreground=""{Binding Path=(TextElement.Foreground), RelativeSource={RelativeSource AncestorType=ContentPresenter}}""/>
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
          <TextBlock FontSize=""20"" FontWeight=""SemiBold"" Text=""Extras""/>
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
            <TextBlock x:Name=""ChecksTitle"" Text=""Checks"" FontSize=""15"" FontWeight=""SemiBold"" Margin=""0,10,0,4"" Visibility=""Collapsed""/>
            <StackPanel x:Name=""ChecksBody""/>
          </StackPanel>
        </ScrollViewer>
      </DockPanel>
    </TabItem>
    <TabItem Header=""Settings"" x:Name=""SettingsTab"" ToolTipService.ShowOnDisabled=""True"">
      <!-- 3.5.0 (docs/30 §3): memory, villagers and the website's Play on the left, graphics and sound on the right, the
           status and the buttons along the bottom. Nothing is written until Save, but the website's Play choice. -->
      <DockPanel x:Name=""SettingsPanel"" Margin=""16,14,16,12"">
        <DockPanel x:Name=""SettingsRow"" DockPanel.Dock=""Bottom"" Margin=""0,10,0,0"">
          <Button x:Name=""SettingsSave"" DockPanel.Dock=""Right"" Style=""{StaticResource Primary}"" Content=""Save"" MinWidth=""120"" IsEnabled=""False""/>
          <Button x:Name=""SettingsRecommended"" DockPanel.Dock=""Right"" Style=""{StaticResource Plain}"" Content=""Back to recommended""/>
          <TextBlock x:Name=""SettingsStatus"" TextWrapping=""Wrap"" VerticalAlignment=""Center"" Margin=""0,0,12,0"" FontSize=""12.5"" Foreground=""{DynamicResource Muted}""/>
        </DockPanel>
        <ScrollViewer x:Name=""SettingsScroll"" VerticalScrollBarVisibility=""Auto"" HorizontalScrollBarVisibility=""Disabled"">
          <Grid x:Name=""SettingsGrid"">
            <Grid.ColumnDefinitions><ColumnDefinition Width=""340""/><ColumnDefinition Width=""16""/><ColumnDefinition Width=""*""/></Grid.ColumnDefinitions>
            <StackPanel x:Name=""SettingsLeft"" Grid.Column=""0"">
              <Border x:Name=""MemoryCard"" Background=""{DynamicResource Card}"" BorderBrush=""{DynamicResource Line}"" BorderThickness=""1"" CornerRadius=""4"" Padding=""12,10"" Margin=""0,0,0,10"">
                <StackPanel>
                  <TextBlock x:Name=""MemoryTitle"" FontFamily=""Segoe UI"" FontSize=""15"" FontWeight=""SemiBold"" Text=""Memory"" Margin=""0,0,0,6""/>
                  <CheckBox x:Name=""RamAuto"" Style=""{StaticResource Switch}"" IsChecked=""True""><TextBlock x:Name=""RamAutoText"" TextWrapping=""Wrap"" Text=""Let Deepslate Works choose (recommended)""/></CheckBox>
                  <DockPanel Margin=""0,8,0,0"">
                    <TextBlock x:Name=""RamValue"" DockPanel.Dock=""Right"" FontWeight=""SemiBold"" Width=""52"" TextAlignment=""Right"" VerticalAlignment=""Center"" Text=""6 GB""/>
                    <Slider x:Name=""RamSlider"" Minimum=""3"" Maximum=""8"" TickFrequency=""1"" SmallChange=""1"" LargeChange=""1"" IsEnabled=""False""/>
                  </DockPanel>
                  <TextBlock x:Name=""RamNote"" TextWrapping=""Wrap"" Margin=""0,6,0,0"" FontSize=""12.5"" Foreground=""{DynamicResource Muted}""/>
                  <TextBlock x:Name=""RamWarn"" TextWrapping=""Wrap"" Margin=""0,4,0,0"" FontSize=""12.5"" Foreground=""{DynamicResource Copper}"" Visibility=""Collapsed""/>
                </StackPanel>
              </Border>
              <Border x:Name=""VillagerCard"" Background=""{DynamicResource Card}"" BorderBrush=""{DynamicResource Line}"" BorderThickness=""1"" CornerRadius=""4"" Padding=""12,10"" Margin=""0,0,0,10"">
                <DockPanel>
                  <Image x:Name=""VillagerPreview"" DockPanel.Dock=""Left"" Width=""40"" Height=""50"" Margin=""0,2,12,0"" VerticalAlignment=""Top"" RenderOptions.BitmapScalingMode=""NearestNeighbor"" Visibility=""Collapsed""/>
                  <StackPanel>
                    <TextBlock x:Name=""VillagerTitle"" FontFamily=""Segoe UI"" FontSize=""15"" FontWeight=""SemiBold"" Text=""Villagers"" Margin=""0,0,0,6""/>
                    <CheckBox x:Name=""VillagerSwitch"" Style=""{StaticResource Switch}"" Content=""Prisoner villagers""/>
                    <TextBlock x:Name=""VillagerNote"" TextWrapping=""Wrap"" Margin=""0,6,0,0"" FontSize=""12.5"" Foreground=""{DynamicResource Muted}""/>
                    <TextBlock x:Name=""VillagerMissing"" TextWrapping=""Wrap"" Margin=""0,4,0,0"" FontSize=""12.5"" Foreground=""{DynamicResource Copper}"" Visibility=""Collapsed""/>
                  </StackPanel>
                </DockPanel>
              </Border>
              <Border x:Name=""WebsiteCard"" Background=""{DynamicResource Card}"" BorderBrush=""{DynamicResource Line}"" BorderThickness=""1"" CornerRadius=""4"" Padding=""12,10"">
                <StackPanel>
                  <TextBlock x:Name=""WebsiteTitle"" FontFamily=""Segoe UI"" FontSize=""15"" FontWeight=""SemiBold"" Text=""The Play button on the website"" TextWrapping=""Wrap"" Margin=""0,0,0,6""/>
                  <TextBlock x:Name=""WebsiteQuestion"" TextWrapping=""Wrap"" Margin=""0,0,0,6"" Foreground=""{DynamicResource Muted}""/>
                  <StackPanel x:Name=""WebsiteChoices""/>
                  <TextBlock x:Name=""WebsiteNote"" TextWrapping=""Wrap"" Margin=""0,4,0,0"" FontSize=""12"" Foreground=""{DynamicResource Muted}""/>
                </StackPanel>
              </Border>
            </StackPanel>
            <Border x:Name=""GraphicsCard"" Grid.Column=""2"" Background=""{DynamicResource Card}"" BorderBrush=""{DynamicResource Line}"" BorderThickness=""1"" CornerRadius=""4"" Padding=""12,10"" VerticalAlignment=""Top"">
              <StackPanel>
                <TextBlock x:Name=""GraphicsTitle"" FontFamily=""Segoe UI"" FontSize=""15"" FontWeight=""SemiBold"" Text=""Graphics and sound"" Margin=""0,0,0,6""/>
                <TextBlock x:Name=""GraphicsEmpty"" TextWrapping=""Wrap"" Foreground=""{DynamicResource Muted}"" Visibility=""Collapsed""/>
                <Grid x:Name=""GraphicsBody""/>
              </StackPanel>
            </Border>
          </Grid>
        </ScrollViewer>
      </DockPanel>
    </TabItem>
    <TabItem Header=""Log"" x:Name=""LogTab"">
      <DockPanel>
        <!-- 3.4.2: the logs, made safe, saved to Downloads or sent to Alex (Home/LogBundle.cs) -->
        <Border DockPanel.Dock=""Bottom"" Background=""{DynamicResource Panel}"" BorderBrush=""{DynamicResource Line}"" BorderThickness=""0,1,0,0"" Padding=""16,10,16,8"">
          <DockPanel>
            <Button x:Name=""SendLogButton"" DockPanel.Dock=""Right"" Style=""{StaticResource Primary}"" Content=""Send to Alex"" Margin=""8,0,0,0""/>
            <Button x:Name=""SaveLogButton"" DockPanel.Dock=""Right"" Style=""{StaticResource Plain}"" Content=""Save log"" Margin=""0""/>
            <TextBlock x:Name=""LogStatus"" TextWrapping=""Wrap"" VerticalAlignment=""Center"" Margin=""0,0,12,0"" FontSize=""12.5"" Foreground=""{DynamicResource Muted}""
                       Text=""Save log puts this log and the game's in a zip in Downloads. Send to Alex sends the same to the site. Your username, file paths and chat are taken out first.""/>
          </DockPanel>
        </Border>
        <ListBox x:Name=""LogList"" Margin=""0"" Padding=""10,6"" FontFamily=""Consolas"" FontSize=""12"" BorderThickness=""0"" Background=""{DynamicResource Panel}"" Foreground=""{DynamicResource Muted}""/>
      </DockPanel>
    </TabItem>
  </TabControl>
  </DockPanel>
  </Grid>
</Window>";

        /// <summary>One question with up to three answers (Yes / Later / Allow all). The text says what will happen; Allow all
        /// says what it will remember, so nothing is hidden behind it.</summary>
        public static readonly string AskXaml = @"<Window " + Ns + @"
        Title=""Deepslate Works"" Width=""440"" SizeToContent=""Height"" ResizeMode=""NoResize"" WindowStartupLocation=""CenterOwner""
        FontFamily=""Segoe UI"" FontSize=""14"" TextOptions.TextFormattingMode=""Display"" TextOptions.TextRenderingMode=""ClearType"" UseLayoutRounding=""True"" SnapsToDevicePixels=""True"" Background=""{DynamicResource Card}"" Foreground=""{DynamicResource Fg}"">
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
            "ServerBox", "ServerDot", "ServerLine", "ServerHint", "ServerOnline", "StartButton", "SiteLink", "NewsBox", "NewsText", "NewsMeta", "NewsOpen", "NewsScroll",
            "VoteTab", "VoteStep", "VoteTitle", "VoteNote", "VoteBody", "VoteButton", "VoteError",
            "UpdateButton", "UpdateLine",   // 3.3.0
            // 3.4.0 (docs/21): the ground, the banner with the server pill, the drawn logo, the Vote tab's badge, the card
            // round "Since last time"
            "ChangedBox", "PlayChangedDetail", "OnlineHeads", "GroundTile", "Hero", "HeroImage", "HeroShade", "HeroStatus", "HeroDot", "HeroLine", "LogoFallback", "VoteBadge", "VoteBadgeText",
            // 3.4.1 (docs/21 §11): the landscape Play tab, and the name's shadow (one of the pixel face's three places)
            "PlayGrid", "PlayLeft", "PlayRight", "PlayCard", "PlayRow", "BrandShade",
            // 3.4.2: Save log and Send to Alex on the Log tab
            "SaveLogButton", "SendLogButton", "LogStatus",
            // 3.5.0 (docs/30): the Settings tab
            "SettingsTab", "SettingsPanel", "SettingsRow", "SettingsSave", "SettingsRecommended", "SettingsStatus", "SettingsScroll", "SettingsGrid", "SettingsLeft",
            "MemoryCard", "MemoryTitle", "RamAuto", "RamAutoText", "RamValue", "RamSlider", "RamNote", "RamWarn",
            "VillagerCard", "VillagerPreview", "VillagerTitle", "VillagerSwitch", "VillagerNote", "VillagerMissing",
            "WebsiteCard", "WebsiteTitle", "WebsiteQuestion", "WebsiteChoices", "WebsiteNote",
            "GraphicsCard", "GraphicsTitle", "GraphicsEmpty", "GraphicsBody",
        };

        /// <summary>Every name the question window looks up in AskXaml.</summary>
        public static readonly string[] AskNames = { "Q", "Why", "AllNote", "Later", "All", "Yes" };
    }
}

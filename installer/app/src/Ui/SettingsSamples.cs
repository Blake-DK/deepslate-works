namespace DeepslateWorks
{
    /// <summary>3.5.0: what the Settings tab's screenshots are drawn from (docs/30 §8): an options.txt in the shape the
    /// game writes (the fixture's lines, cut down), Fabulous graphics set in game, and settings.json with a memory chosen
    /// and, for the third picture, changes waiting for the next Play.</summary>
    public static class SettingsSamples
    {
        public const string Options = "version:3955\r\nao:true\r\nbiomeBlendRadius:2\r\nenableVsync:true\r\nentityDistanceScaling:1.25\r\nentityShadows:true\r\n"
            + "fov:0.25\r\nfullscreen:false\r\ngamma:0.6\r\ngraphicsMode:2\r\nguiScale:0\r\nmaxFps:120\r\nparticles:0\r\nrenderClouds:\"fast\"\r\n"
            + "renderDistance:12\r\nsimulationDistance:8\r\nresourcePacks:[\"file/deepslate-textures.zip\"]\r\nincompatibleResourcePacks:[]\r\n"
            + "soundCategory_master:0.8\r\nsoundCategory_music:0.35\r\n";
        public const string Settings = "{\"version\":2,\"websitePlay\":\"countdown\",\"ramGb\":8}";
        public const string SettingsPending = "{\"version\":2,\"websitePlay\":\"countdown\",\"ramGb\":8,\"pending\":{\"options\":{\"renderDistance\":\"14\",\"renderClouds\":\"\\\"false\\\"\"},\"villagers\":false}}";
        public static object PackList => Json.Parse("{\"settings\":{\"tier\":\"MID\",\"renderDistance\":10,\"serverViewDistance\":12,\"ram\":{\"min_gb\":3,\"max_gb\":6,\"user_max_gb\":12}}}");
    }
}

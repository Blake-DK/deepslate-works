using System.Collections.Generic;

namespace DeepslateWorks
{
    /// <summary>3.5.6: what the Extras tab's screenshot is drawn from on a PC with no extras list of its own (CI's): part
    /// of modpack/extras.json's list, Iris with the Light shaders and Falling Leaves chosen. Never written over this PC's
    /// files: the pictures are drawn with the app's home moved into a folder of their own.</summary>
    public static class ExtrasSamples
    {
        static string Extra(string id, string name, string fps, string shader, string requires, string description, string file, string kind)
            => "{\"id\":\"" + id + "\",\"name\":\"" + name + "\",\"fps\":\"" + fps + "\"," + (shader != null ? "\"shader\":\"" + shader + "\"," : "")
             + "\"requires\":[" + (requires != null ? "\"" + requires + "\"" : "") + "],\"description\":\"" + description + "\","
             + "\"files\":[{\"filename\":\"" + file + "\",\"kind\":\"" + kind + "\",\"url\":\"https://example.invalid/" + file + "\",\"sha512\":\"00\",\"size\":1}]}";

        public static readonly string Manifest = "{\"size\":10485760,\"extras\":["
            + Extra("iris", "Iris (shaders)", "High", null, null, "Shader support: real shadows, light and water. Pick a shader pack below.", "iris.jar", "mod") + ","
            + Extra("shader-light", "Light shaders (MakeUp Ultra Fast)", "Medium", "light", "iris", "Soft shadows and nicer water, made for slower PCs.", "makeup.zip", "shader") + ","
            + Extra("shader-full", "Full shaders (Complementary Reimagined)", "High", "full", "iris", "The full look. Needs a proper graphics card.", "comp.zip", "shader") + ","
            + Extra("falling-leaves", "Falling Leaves", "Low", null, null, "Leaves drift down from trees.", "fl.jar", "mod") + ","
            + Extra("sound-physics", "Sound Physics Remastered", "Medium", null, null, "Echo in caves, muffled sound through walls, voice chat too.", "sp.jar", "mod") + ","
            + Extra("fresh-animations", "Fresh Animations", "Medium", null, null, "Mobs blink, breathe and move naturally. Brings EMF and ETF with it.", "fa.zip", "resourcepack")
            + "]}";

        /// <summary>Iris on (Light shaders) and Falling Leaves on; irisOn false leaves the shader choices disabled.</summary>
        public static ExtrasState State(bool irisOn)
        {
            var st = new ExtrasState { Downloaded = true, Shader = "light" };
            st.Choices["iris"] = irisOn; st.Choices["falling-leaves"] = true;
            st.Seen = new List<string> { "iris", "shader-light", "shader-full", "falling-leaves", "sound-physics", "fresh-animations" };
            return st;
        }
    }
}

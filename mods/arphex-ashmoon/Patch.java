import java.io.ByteArrayOutputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Enumeration;
import java.util.Map;
import java.util.TreeMap;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
import java.util.zip.ZipOutputStream;

import org.objectweb.asm.ClassReader;
import org.objectweb.asm.ClassVisitor;
import org.objectweb.asm.ClassWriter;
import org.objectweb.asm.MethodVisitor;
import org.objectweb.asm.Opcodes;
import org.objectweb.asm.tree.AbstractInsnNode;
import org.objectweb.asm.tree.ClassNode;
import org.objectweb.asm.tree.FieldInsnNode;
import org.objectweb.asm.tree.InsnList;
import org.objectweb.asm.tree.JumpInsnNode;
import org.objectweb.asm.tree.LdcInsnNode;
import org.objectweb.asm.tree.MethodInsnNode;
import org.objectweb.asm.tree.MethodNode;

/**
 * ArPhEx 5.0.2 with Ashmoon in place of the main world (mods/arphex-ashmoon/README.md).
 *
 * Five procedures ask "is this the overworld?" before they do their part: the Crawling Compass, the random spawn
 * system, the underground spawn rule, the Tormentor's first appearance and the Spider Moth's random spawn. In each,
 * the one comparison "dimension == Level.OVERWORLD" (a getstatic Level.OVERWORLD followed by if_acmpeq/if_acmpne)
 * gets ResourceKey.create(Registries.DIMENSION, ResourceLocation.parse("deepslate:moon")) instead, the way the mod
 * itself builds the key of its own dimension. The fallback Level.OVERWORLD in "world instanceof Level ? ... :
 * Level.OVERWORLD" is left alone. The compass's "only works in" message is reworded. The version in both mods.toml
 * files gets "-dsw.1". Every other entry of the jar is copied byte for byte, in the same order with the same dates.
 *
 *   java Patch <in.jar> <out.jar>
 */
public final class Patch {
    static final String P = "net/arphex/procedures/";
    /** the classes changed, each with exactly one overworld comparison */
    static final String[] CLASSES = {
        P + "CompassTestRightclickedProcedure.class",
        P + "RandomSpawnConfigProcedure.class",
        P + "ArphexSpawnConfigUndergroundProcedure.class",
        P + "TormentorSpawnConditionProcedure.class",
        P + "RandomArPhExOnEntityTickUpdateProcedure.class",
    };
    static final String MOON = "deepslate:moon";
    static final String LEVEL = "net/minecraft/world/level/Level";
    static final String KEY = "Lnet/minecraft/resources/ResourceKey;";
    static final String MSG_FROM = "Item only works in the overworld and crawling dimensions";
    static final String MSG_TO = "Item only works on Ashmoon and in the Crawling";
    static final String[] TOMLS = { "META-INF/neoforge.mods.toml", "META-INF/mods.toml" };
    static final String VERSION_FROM = "version=\"5.0.2\"";
    static final String VERSION_TO = "version=\"5.0.2-dsw.1\"";

    public static void main(String[] args) throws Exception {
        if (args.length != 2) throw new IllegalArgumentException("usage: Patch <in.jar> <out.jar>");
        Map<String, Boolean> done = new TreeMap<>();
        for (String c : CLASSES) done.put(c, false);
        for (String t : TOMLS) done.put(t, false);
        try (ZipFile in = new ZipFile(args[0]); ZipOutputStream out = new ZipOutputStream(new FileOutputStream(args[1]))) {
            for (Enumeration<? extends ZipEntry> en = in.entries(); en.hasMoreElements(); ) {
                ZipEntry e = en.nextElement();
                byte[] b = read(in.getInputStream(e));
                String n = e.getName();
                if (done.containsKey(n)) {
                    b = n.endsWith(".class") ? patchClass(n, b) : patchToml(n, b);
                    done.put(n, true);
                }
                ZipEntry o = new ZipEntry(n);
                o.setTime(e.getTime());
                out.putNextEntry(o);
                out.write(b);
                out.closeEntry();
            }
        }
        for (Map.Entry<String, Boolean> d : done.entrySet())
            if (!d.getValue()) throw new IllegalStateException("not the ArPhEx 5.0.2 jar: " + d.getKey() + " missing");
        System.out.println("patched " + done.keySet());
    }

    static byte[] patchClass(String name, byte[] b) {
        ClassNode cn = new ClassNode();
        new ClassReader(b).accept(cn, 0);
        int swapped = 0, reworded = 0;
        for (MethodNode m : cn.methods) {
            for (AbstractInsnNode i = m.instructions.getFirst(); i != null; i = i.getNext()) {
                if (i instanceof LdcInsnNode l && MSG_FROM.equals(l.cst)) { l.cst = MSG_TO; reworded++; continue; }
                if (!(i instanceof FieldInsnNode f) || f.getOpcode() != Opcodes.GETSTATIC
                    || !f.owner.equals(LEVEL) || !f.name.equals("OVERWORLD") || !f.desc.equals(KEY)) continue;
                AbstractInsnNode next = i.getNext();
                while (next != null && next.getOpcode() < 0) next = next.getNext(); // labels, line numbers, frames
                if (!(next instanceof JumpInsnNode j) || (j.getOpcode() != Opcodes.IF_ACMPEQ && j.getOpcode() != Opcodes.IF_ACMPNE)) continue;
                InsnList k = new InsnList();
                k.add(new FieldInsnNode(Opcodes.GETSTATIC, "net/minecraft/core/registries/Registries", "DIMENSION", KEY));
                k.add(new LdcInsnNode(MOON));
                k.add(new MethodInsnNode(Opcodes.INVOKESTATIC, "net/minecraft/resources/ResourceLocation", "parse",
                    "(Ljava/lang/String;)Lnet/minecraft/resources/ResourceLocation;", false));
                k.add(new MethodInsnNode(Opcodes.INVOKESTATIC, "net/minecraft/resources/ResourceKey", "create",
                    "(Lnet/minecraft/resources/ResourceKey;Lnet/minecraft/resources/ResourceLocation;)" + KEY, false));
                AbstractInsnNode last = k.getLast();
                m.instructions.insert(i, k);
                m.instructions.remove(i);
                i = last;
                swapped++;
            }
        }
        if (swapped != 1) throw new IllegalStateException(name + ": " + swapped + " overworld comparisons, 5.0.2 has 1");
        boolean compass = name.endsWith("CompassTestRightclickedProcedure.class");
        if (reworded != (compass ? 1 : 0)) throw new IllegalStateException(name + ": the compass message found " + reworded + " times");
        // one key in place of another: the same stack depth at every branch, so the frames stay valid; only max stack grows
        ClassWriter w = new ClassWriter(ClassWriter.COMPUTE_MAXS);
        cn.accept(w);
        return w.toByteArray();
    }

    static byte[] patchToml(String name, byte[] b) {
        String s = new String(b, StandardCharsets.UTF_8);
        int at = s.indexOf(VERSION_FROM);
        if (at < 0 || s.indexOf(VERSION_FROM, at + 1) >= 0) throw new IllegalStateException(name + " has not exactly one line " + VERSION_FROM);
        return s.replace(VERSION_FROM, VERSION_TO).getBytes(StandardCharsets.UTF_8);
    }

    static byte[] read(InputStream in) throws Exception {
        try (in) { ByteArrayOutputStream o = new ByteArrayOutputStream(); in.transferTo(o); return o.toByteArray(); }
    }
}

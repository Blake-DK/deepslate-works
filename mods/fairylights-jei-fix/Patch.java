import java.io.ByteArrayOutputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Enumeration;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
import java.util.zip.ZipOutputStream;

import org.objectweb.asm.ClassReader;
import org.objectweb.asm.ClassVisitor;
import org.objectweb.asm.ClassWriter;
import org.objectweb.asm.Label;
import org.objectweb.asm.MethodVisitor;
import org.objectweb.asm.Opcodes;

/**
 * Fairy Lights 1.2.3's JEI tooltip without the crash (mods/fairylights-jei-fix/README.md).
 *
 * GenericRecipeExtension.setRecipe gives every slot of the hanging lights and pennant bunting recipes a tooltip
 * callback, lambda$setRecipe$1(GenericIngredient, IRecipeSlotView, ITooltipBuilder), which calls
 * ingredient.getTooltip() (line 47). For an empty slot the ingredient is null and the game crashes when the mouse is
 * over it. This puts "if (ingredient == null) return;" in front of the lambda's body and changes nothing else: every
 * other entry of the jar is copied byte for byte, and the version in neoforge.mods.toml gets "-dsw.1".
 *
 *   java Patch <in.jar> <out.jar>
 */
public final class Patch {
    static final String CLASS = "de/lucalabs/fairylights/integrations/jei/GenericRecipeExtension.class";
    static final String LAMBDA = "lambda$setRecipe$1";
    static final String DESC = "(Lde/lucalabs/fairylights/main/items/crafting/GenericIngredient;Lmezz/jei/api/gui/ingredient/IRecipeSlotView;Lmezz/jei/api/gui/builder/ITooltipBuilder;)V";
    static final String TOML = "META-INF/neoforge.mods.toml";
    static final String VERSION_FROM = "version = \"1.2.3\" #mandatory";
    static final String VERSION_TO = "version = \"1.2.3-dsw.1\" #mandatory";

    public static void main(String[] args) throws Exception {
        if (args.length != 2) throw new IllegalArgumentException("usage: Patch <in.jar> <out.jar>");
        boolean patchedClass = false, patchedToml = false;
        try (ZipFile in = new ZipFile(args[0]); ZipOutputStream out = new ZipOutputStream(new FileOutputStream(args[1]))) {
            for (Enumeration<? extends ZipEntry> en = in.entries(); en.hasMoreElements(); ) {
                ZipEntry e = en.nextElement();
                byte[] b = read(in.getInputStream(e));
                if (e.getName().equals(CLASS)) { b = patchClass(b); patchedClass = true; }
                else if (e.getName().equals(TOML)) { b = patchToml(b); patchedToml = true; }
                ZipEntry o = new ZipEntry(e.getName());
                o.setTime(e.getTime());
                out.putNextEntry(o);
                out.write(b);
                out.closeEntry();
            }
        }
        if (!patchedClass || !patchedToml) throw new IllegalStateException("not the Fairy Lights 1.2.3 jar: " + CLASS + " or " + TOML + " missing");
        System.out.println("patched " + CLASS + " (" + LAMBDA + ") and " + TOML);
    }

    static byte[] patchClass(byte[] b) {
        ClassReader r = new ClassReader(b);
        ClassWriter w = new ClassWriter(r, 0);
        int[] found = {0};
        r.accept(new ClassVisitor(Opcodes.ASM9, w) {
            @Override
            public MethodVisitor visitMethod(int access, String name, String desc, String sig, String[] ex) {
                MethodVisitor mv = super.visitMethod(access, name, desc, sig, ex);
                if (!name.equals(LAMBDA)) return mv;
                if (!desc.equals(DESC) || (access & Opcodes.ACC_STATIC) == 0) throw new IllegalStateException(LAMBDA + " is not what 1.2.3 has: " + desc);
                found[0]++;
                return new MethodVisitor(Opcodes.ASM9, mv) {
                    @Override
                    public void visitCode() {
                        super.visitCode();
                        Label go = new Label();
                        super.visitVarInsn(Opcodes.ALOAD, 0);
                        super.visitJumpInsn(Opcodes.IFNONNULL, go);
                        super.visitInsn(Opcodes.RETURN);
                        super.visitLabel(go);
                        // the same locals as on entry, nothing on the stack: the frames after it stay valid
                        super.visitFrame(Opcodes.F_SAME, 0, null, 0, null);
                    }
                    @Override
                    public void visitMaxs(int stack, int locals) { super.visitMaxs(Math.max(stack, 1), locals); }
                };
            }
        }, 0);
        if (found[0] != 1) throw new IllegalStateException(LAMBDA + " found " + found[0] + " times");
        return w.toByteArray();
    }

    static byte[] patchToml(byte[] b) {
        String s = new String(b, StandardCharsets.UTF_8);
        if (!s.contains(VERSION_FROM)) throw new IllegalStateException(TOML + " has no line " + VERSION_FROM);
        return s.replace(VERSION_FROM, VERSION_TO).getBytes(StandardCharsets.UTF_8);
    }

    static byte[] read(InputStream in) throws Exception {
        try (in) { ByteArrayOutputStream o = new ByteArrayOutputStream(); in.transferTo(o); return o.toByteArray(); }
    }
}

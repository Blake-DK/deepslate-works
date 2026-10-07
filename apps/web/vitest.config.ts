import { defineConfig } from "vitest/config";
import { fileURLToPath } from "url";

export default defineConfig({
  // next-auth imports "next/server" without an extension, which only resolves when Vite handles it
  test: { include: ["tests/**/*.test.ts"], environment: "node", server: { deps: { inline: ["next-auth"] } } },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/server-only-stub.ts", import.meta.url)),
    },
  },
});

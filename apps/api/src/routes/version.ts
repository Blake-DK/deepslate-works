import type { FastifyInstance } from "fastify";
import { build, type ServerVersions } from "../status/versions.js";

// What api is (version, commit, build time, start) and what the server runs (Minecraft, NeoForge). Web's
// /api/version puts this together with its own and the pack's (planner, 2026-10-01).
export function versionRoutes(app: FastifyInstance, server: ServerVersions) {
  app.get("/version", async () => ({ api: build(), server: await server.current() }));
}

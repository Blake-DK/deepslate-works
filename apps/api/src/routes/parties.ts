import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { PartyBook } from "../players/parties.js";

// A player's Open Parties and Claims party, for their page (everyone who can see the page sees it). Read only.
export function partyRoutes(app: FastifyInstance, book: PartyBook) {
  app.get("/players/:uuid/party", async (req, reply) => {
    const uuid = z.string().uuid().safeParse((req.params as { uuid: string }).uuid);
    if (!uuid.success) return reply.code(400).send({ error: { code: "validation", message: "uuid" } });
    return { party: await book.forPlayer(uuid.data) };
  });
}

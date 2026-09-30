// Alex's rule for who may download the pack, decided 2026-09-29: players can download while the server is
// available, and a server that is asleep is available (AMP wakes it when someone connects). docs/13 §12: a server
// that is waking (somebody pressed Play) is too, or the Play that woke it could not fetch its mods. Pure, tested.
import { JOINABLE, type ServerState } from "@/shared/server-state";

export function downloadsOpen(server: ServerState | null | undefined): boolean {
  return Boolean(server && JOINABLE.has(server));
}

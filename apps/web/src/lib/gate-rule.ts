// Alex's rule for who may download the pack, decided 2026-09-29: players can download while the server is
// available, and a server that is asleep is available (AMP wakes it when someone connects). Pure, so it is tested.
export type GateAvailability = "online" | "starting" | "sleeping" | "offline" | "unknown";

export function downloadsOpen(availability: GateAvailability | null | undefined): boolean {
  return availability === "online" || availability === "sleeping";
}

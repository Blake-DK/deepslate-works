"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/server/auth/session";
import { apiFetch, ApiError } from "@/server/api-client";
import { forgetMaintenance } from "@/server/settings";
import { forgetStatus } from "@/server/status";

// docs/48 B3: Start and End maintenance on Admin → Overview. api switches it (the door reads it there), kicks whoever
// has no tick when it goes on, and writes the admin action into Activity.
export async function maintenanceAction(which: "on" | "off", formData: FormData) {
  const admin = await requireAdmin();
  const on = which === "on";
  if (on && formData.get("sure") !== "on") redirect("/admin?msg=confirm");
  let r: { kicked: string[]; failed: string[] };
  try {
    r = await apiFetch<{ kicked: string[]; failed: string[] }>("/maintenance", { method: "POST", body: { on }, caller: { id: admin.id, role: "ADMIN" }, timeoutMs: 60_000 });
  } catch (e) {
    if (e instanceof ApiError) redirect(`/admin?msg=error&detail=${encodeURIComponent(e.message)}`);
    throw e;
  }
  forgetMaintenance();
  forgetStatus();
  revalidatePath("/", "layout"); // the pill on every page, Home's banner
  const said = [r.kicked.length ? `kicked ${r.kicked.join(", ")}` : on ? "nobody had to be kicked" : "", r.failed.length ? `not kicked (the server did not take it): ${r.failed.join(", ")}` : ""].filter(Boolean).join("; ");
  redirect(`/admin?msg=${on ? "maintenanceOn" : "maintenanceOff"}${said ? `&detail=${encodeURIComponent(said)}` : ""}`);
}

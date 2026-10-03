import { Alert } from "@/components/ui/alert";

/** docs/13 "Early access". */
export const EARLY_TEXT = "Early access: things may still break. Tell Alex in Discord if they do.";

export function EarlyBanner() {
  return <Alert tone="info" data-testid="early-access" className="mb-4">{EARLY_TEXT}</Alert>;
}

import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/env.js";

// doc 62 §2: api reaches the AMP host over the LAN at home, over the tunnel on the VPS. AMP_HOST names the host for
// the reachability check; where it is not set, the tunnel's far end (AMP_TUNNEL_IP) still does, as before.

const base = { API_SERVICE_TOKEN: "t".repeat(32), DATABASE_URL: "postgresql://x" };

describe("AMP_HOST", () => {
  it("is the LAN address when set (the home stack)", () => {
    expect(loadEnv({ ...base, AMP_HOST: "10.0.10.8" }).AMP_HOST).toBe("10.0.10.8");
  });
  it("falls back to AMP_TUNNEL_IP when not set (the VPS stack)", () => {
    expect(loadEnv({ ...base, AMP_TUNNEL_IP: "10.77.0.9" }).AMP_HOST).toBe("10.77.0.9");
    expect(loadEnv(base).AMP_HOST).toBe("10.77.0.2");
  });
  it("treats an empty AMP_HOST as unset, like every other empty line of deploy/.env", () => {
    expect(loadEnv({ ...base, AMP_HOST: "" }).AMP_HOST).toBe("10.77.0.2");
  });
});

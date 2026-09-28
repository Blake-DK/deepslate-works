// AMP on the homelab: instances bind their API to localhost, so everything goes through the ADS
// and the instance is addressed by the proxy path below (docs/13 §4).

export function adsPath(module: string, method: string): string {
  return `/API/${module}/${method}`;
}

export function instancePath(instanceId: string, module: string, method: string): string {
  if (!/^[A-Za-z0-9-]{8,}$/.test(instanceId)) throw new Error("AMP_INSTANCE_ID looks wrong");
  return `/API/ADSModule/Servers/${instanceId}/API/${module}/${method}`;
}

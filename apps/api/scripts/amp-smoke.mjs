// AMP smoke test through the ADS instance proxy, run inside deepslate-api (the only container with a route).
const { AMP_URL, AMP_USERNAME, AMP_PASSWORD, AMP_INSTANCE_ID } = process.env;
const post = async (path, body) => {
  const res = await fetch(`${AMP_URL}${path}`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text: text.slice(0, 300) };
};
const inst0 = (m, method, p = {}) => post(`/API/ADSModule/Servers/${AMP_INSTANCE_ID}/API/${m}/${method}`, p);
// webapp is an instance-local user: Login goes through the proxy path as well.
const login = await inst0("Core", "Login", { username: AMP_USERNAME, password: AMP_PASSWORD, token: "", rememberMe: false });
console.log("1. Login:", login.status, "success=" + login.json?.success, "reason=" + (login.json?.resultReason ?? ""), "sessionID=" + (login.json?.sessionID ? "yes" : "no"));
const sid = login.json?.sessionID;
if (!sid) process.exit(1);
const inst = (m, method, p = {}) => post(`/API/ADSModule/Servers/${AMP_INSTANCE_ID}/API/${m}/${method}`, { ...p, SESSIONID: sid });
const st = await inst("Core", "GetStatus");
console.log("2. GetStatus:", st.status, "State=" + st.json?.State, "Metrics=" + Object.keys(st.json?.Metrics ?? {}).join(","), "Uptime=" + st.json?.Uptime);
if (st.status !== 200 || st.json?.State === undefined) console.log("   raw:", st.text);
const sc = await inst("Core", "SetConfig", { node: "Meta.Description", value: "smoke-test" });
console.log("3. SetConfig:", sc.status, "body=" + sc.text.replace(/\s+/g, " ").slice(0, 200));
const spec = await inst("Core", "GetAPISpec");
const modules = spec.json && typeof spec.json === "object" ? Object.keys(spec.json) : [];
console.log("4. GetAPISpec:", spec.status, "modules=" + modules.join(","));
const core = spec.json?.Core ? Object.keys(spec.json.Core) : [];
console.log("   Core methods:", core.join(","));
for (const m of ["MinecraftModule", "FileManagerPlugin", "LocalFileBackupPlugin", "EmailSenderPlugin"]) if (spec.json?.[m]) console.log(`   ${m}:`, Object.keys(spec.json[m]).join(","));
const upd = await inst("Core", "GetUpdates");
console.log("5. GetUpdates:", upd.status, "keys=" + Object.keys(upd.json ?? {}).join(","), "consoleLines=" + (upd.json?.ConsoleEntries?.length ?? "?"));

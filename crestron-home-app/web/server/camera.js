// Fetches a camera's JPEG snapshot for the browser, so camera passwords stay on
// the server. Handles no auth, Basic and Digest (Hikvision/Dahua use Digest).
import crypto from "node:crypto";
import http from "node:http";
import https from "node:https";

const insecureAgent = new https.Agent({ rejectUnauthorized: false });

export async function fetchSnapshot(camera) {
  const url = new URL(camera.snapshotURL);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Snapshot URL must start with http:// or https://");
  let res = await get(url, {});
  if (res.status === 401 && camera.username) {
    const challenge = String(res.headers["www-authenticate"] ?? "");
    const auth = /^digest/i.test(challenge)
      ? digestHeader(challenge, camera.username, camera.password ?? "", url)
      : `Basic ${Buffer.from(`${camera.username}:${camera.password ?? ""}`).toString("base64")}`;
    res = await get(url, { Authorization: auth });
  }
  if (res.status === 401) throw new Error("Wrong camera username or password.");
  if (res.status < 200 || res.status >= 300) throw new Error(`The camera answered ${res.status}.`);
  return { body: res.body, type: String(res.headers["content-type"] ?? "image/jpeg") };
}

function get(url, headers) {
  const lib = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.get(url, { headers, timeout: 8000, agent: url.protocol === "https:" ? insecureAgent : undefined }, (res) => {
      const chunks = [];
      let size = 0;
      res.on("data", (c) => {
        size += c.length;
        if (size > 8 * 1024 * 1024) req.destroy(new Error("snapshot too large"));
        else chunks.push(c);
      });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on("timeout", () => req.destroy(new Error("camera timed out")));
    req.on("error", reject);
  });
}

function digestHeader(challenge, user, pass, url) {
  const params = {};
  for (const m of challenge.matchAll(/(\w+)=("([^"]*)"|[^,\s]+)/g)) params[m[1].toLowerCase()] = m[3] ?? m[2];
  const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");
  const uri = url.pathname + url.search;
  const qop = params.qop?.split(",").map((s) => s.trim()).includes("auth") ? "auth" : null;
  const nc = "00000001";
  const cnonce = crypto.randomBytes(8).toString("hex");
  const ha1 = md5(`${user}:${params.realm}:${pass}`);
  const ha2 = md5(`GET:${uri}`);
  const response = qop ? md5(`${ha1}:${params.nonce}:${nc}:${cnonce}:${qop}:${ha2}`) : md5(`${ha1}:${params.nonce}:${ha2}`);
  let header = `Digest username="${user}", realm="${params.realm}", nonce="${params.nonce}", uri="${uri}", response="${response}"`;
  if (params.opaque) header += `, opaque="${params.opaque}"`;
  if (qop) header += `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"`;
  if (params.algorithm) header += `, algorithm=${params.algorithm}`;
  return header;
}

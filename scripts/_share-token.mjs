import { createSign } from "crypto";
import { readFileSync } from "fs";

export function env(name) {
  const txt = readFileSync(new URL("../.env", import.meta.url), "utf8");
  const m = txt.match(new RegExp(`^${name}=(.*)$`, "m"));
  if (!m) throw new Error(`.env 에 ${name} 없음`);
  let v = m[1].trim();
  if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) v = v.slice(1, -1);
  return v;
}

export async function token(scope = "https://www.googleapis.com/auth/spreadsheets") {
  const cred = JSON.parse(env("GOOGLE_SERVICE_ACCOUNT_JSON"));
  const now = Math.floor(Date.now() / 1000);
  const head = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify({ iss: cred.client_email, scope, aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 })).toString("base64url");
  const s = createSign("RSA-SHA256"); s.update(`${head}.${body}`);
  const jwt = `${head}.${body}.${s.sign(cred.private_key.replace(/\n/g, "\n"), "base64url")}`;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(JSON.stringify(j));
  return j.access_token;
}

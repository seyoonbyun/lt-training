/**
 * 신청명단의 발송·처리 기록 열(S~Z) 시각 표기를 한 서식으로 맞춘다.
 *
 *   2026. 8. 24. PM 12:47:05
 *
 * 왜
 *   같은 열에 두 주체가 값을 넣어 서식이 갈려 있었다 — 서버가 실시간으로 적은 값과
 *   솔라피 발송 이력에서 사후에 채운 값. 코드는 shared/stamp.ts 한 벌로 통일했고,
 *   이 스크립트는 **이미 적힌 값**을 같은 서식으로 되쓴다.
 *
 * 건드리지 않는 것
 *   · 시각이 아닌 값 — "이메일 없음" · "연락처 없음" · "문자발송완"
 *   · A열 신청일시 · O열 승인일시 (발송 기록이 아니다)
 *
 *   ⚠ shared/stamp.ts 를 그대로 불러오므로 타입 제거 플래그가 필요하다.
 *
 *   node --experimental-strip-types scripts/normalize-send-stamps.mjs          # 미리보기
 *   node --experimental-strip-types scripts/normalize-send-stamps.mjs --write
 */
import { writeFileSync } from "node:fs";
import { env, token } from "./_share-token.mjs";
import { sendStamp, parseStamp } from "../shared/stamp.ts";

const SID = env("GOOGLE_SPREADSHEET_ID");
const TAB = "2026 LTT 신청명단";
const FROM = "취소";                    // S
const TO = "리마인드2차";                // Z
const write = process.argv.includes("--write");

const H = { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" };
const base = `https://sheets.googleapis.com/v4/spreadsheets/${SID}`;
const enc = (r) => encodeURIComponent(`'${TAB}'!${r}`);
const api = async (path, init) => {
  const res = await fetch(`${base}${path}`, { headers: H, ...init });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
};
const letter = (i) => { let n = i, o = ""; do { o = String.fromCharCode(65 + (n % 26)) + o; n = Math.floor(n / 26) - 1; } while (n >= 0); return o; };

// ── 헤더로 열 구간을 잡는다 (열 문자를 손으로 적지 않는다)
const head = (await api(`/values/${enc("A1:AZ1")}`)).values[0].map((h) => String(h ?? "").trim());
const a = head.indexOf(FROM), b = head.indexOf(TO);
if (a < 0 || b < 0) throw new Error(`헤더에서 열을 못 찾음: ${FROM}(${a}) ${TO}(${b})`);
const range = `${letter(a)}2:${letter(b)}`;
console.log(`대상 ${range}  —  ${head.slice(a, b + 1).join(" · ")}\n`);

// ── 두 벌로 읽는다. 진짜 날짜값(숫자)은 시리얼을 벽시계로 풀어야 한다.
const fmt = (await api(`/values/${enc(range)}?valueRenderOption=FORMATTED_VALUE`)).values || [];
const raw = (await api(`/values/${enc(range)}?valueRenderOption=UNFORMATTED_VALUE`)).values || [];

/** 시트 시리얼(스프레드시트 시간대 기준 벽시계) -> 그 벽시계를 KST 로 본 epoch ms */
const fromSerial = (n) => {
  const ms = Math.round((n - 25569) * 86400000 / 1000) * 1000;   // 초 단위로 반올림
  const d = new Date(ms);                                        // UTC 필드 = 벽시계
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(),
                  d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()) - 9 * 3600 * 1000;
};

const KEEP = new Set(["이메일 없음", "연락처 없음", "문자발송완"]);
const updates = [];
const skipped = [];
const rough = [];   // 초를 모르는 값

for (let r = 0; r < fmt.length; r++) {
  for (let c = 0; c <= b - a; c++) {
    const shown = String(fmt[r]?.[c] ?? "").trim();
    if (!shown) continue;
    const rv = raw[r]?.[c];

    let at;
    if (typeof rv === "number") at = fromSerial(rv);
    else if (KEEP.has(shown)) { skipped.push([r + 2, head[a + c], shown]); continue; }
    else at = parseStamp(shown);

    if (Number.isNaN(at)) { skipped.push([r + 2, head[a + c], shown]); continue; }
    if (/^\d{4}-\d{2}-\d{2}[ T]\d{1,2}:\d{2}$/.test(shown)) rough.push([r + 2, head[a + c], shown]);

    const next = sendStamp(new Date(at));
    if (next === shown && typeof rv !== "number") continue;   // 이미 맞는 값
    updates.push({ range: `'${TAB}'!${letter(a + c)}${r + 2}`, values: [[next]], before: shown, after: next, col: head[a + c] });
  }
}

const byCol = {};
for (const u of updates) (byCol[u.col] ??= []).push(u);
for (const [col, list] of Object.entries(byCol)) {
  console.log(`${col} — ${list.length}건`);
  console.log(`   예: ${JSON.stringify(list[0].before)}  ->  ${JSON.stringify(list[0].after)}`);
}
console.log(`\n손대지 않음 ${skipped.length}건 (${[...new Set(skipped.map((s) => s[2]))].slice(0, 4).join(" · ")})`);
if (rough.length) {
  console.log(`⚠ 원본이 분 단위까지만 있는 값 ${rough.length}건 — 초를 00 으로 채웁니다 (실제 초 아님)`);
  console.log(`   ${rough.slice(0, 3).map((x) => `${x[1]} ${x[2]}`).join(" / ")}`);
}
console.log(`\n합계 ${updates.length}건`);

if (!write) { console.log("\n미리보기입니다. 적용하려면 --write"); process.exit(0); }

// ⛔ 시트는 살아 있다. 읽고 쓰는 사이에 행이 재사용되면(미결제 행은 재신청 때
//   J~R 이 비워진다) 방금 비워진 칸에 옛 시각을 되살려 넣게 된다.
//   쓰기 직전에 다시 읽어, 값이 그대로인 칸만 고친다.
const now = (await api(`/values/${enc(range)}?valueRenderOption=FORMATTED_VALUE`)).values || [];
const cur = (row, col) => String(now[row - 2]?.[col - a] ?? "").trim();
const stale = [];
const safe = updates.filter((u) => {
  const m = u.range.match(/!([A-Z]+)(\d+)$/);
  const ci = m[1].split("").reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  if (cur(parseInt(m[2], 10), ci) === u.before) return true;
  stale.push(`${m[1]}${m[2]} ${JSON.stringify(u.before)} -> 지금 ${JSON.stringify(cur(parseInt(m[2], 10), ci))}`);
  return false;
});
if (stale.length) {
  console.log(`\n⚠ 읽은 뒤 값이 바뀐 칸 ${stale.length}개는 건너뜁니다`);
  stale.slice(0, 5).forEach((x) => console.log("   " + x));
}
if (!safe.length) { console.log("\n고칠 칸이 없습니다."); process.exit(0); }

writeFileSync(`stamp-normalize-backup-${sendStamp().replace(/\D+/g, "")}.json`,
  JSON.stringify({ range, head: head.slice(a, b + 1), formatted: fmt, unformatted: raw }, null, 2), "utf8");
console.log("\n백업 저장 완료");

await api(`/values:batchUpdate`, {
  method: "POST",
  body: JSON.stringify({ valueInputOption: "RAW", data: safe.map(({ range, values }) => ({ range, values })) }),
});
console.log(`${safe.length}건 기록`);

// ── 앞으로도 시트가 날짜값으로 삼키지 않도록 이 구간 서식을 텍스트로 못박는다
const meta = await api(`?fields=sheets.properties`);
const sheetId = meta.sheets.find((s) => s.properties.title === TAB).properties.sheetId;
await api(`:batchUpdate`, {
  method: "POST",
  body: JSON.stringify({ requests: [{ repeatCell: {
    range: { sheetId, startRowIndex: 1, startColumnIndex: a, endColumnIndex: b + 1 },
    cell: { userEnteredFormat: { numberFormat: { type: "TEXT" } } },
    fields: "userEnteredFormat.numberFormat",
  } }] }),
});
console.log("S~Z 열 서식을 텍스트로 고정");

import { env, token } from "./_share-token.mjs";
const H = { Authorization: `Bearer ${await token()}` };
const get = async (id, range) =>
  ((await (await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${range}`, { headers: H })).json()).values) || [];

const src = await get(env("GOOGLE_SPREADSHEET_ID"), encodeURIComponent("'2026 LTT 신청명단'") + "!A1:Z500");
const hdr = src[0].map(h => String(h ?? "").trim());
const at = n => hdr.indexOf(n);
const g = (r, n) => String(r[at(n)] ?? "").trim();
const expect = src.slice(1).filter(r => g(r, "멤버명"))
  .map(r => [g(r,"신청일시"), g(r,"과목명"), g(r,"지역"), g(r,"챕터"), g(r,"멤버명"), g(r,"참여 방식"),
             g(r,"취소") ? "취소완료" : (g(r,"신청현황") === "완료" ? "결제완료" : "결제대기")]);

const got = (await get("1ENi99bJGBtjf1WYG1XXo-aH8eN-Zx6kmeUSU7ZqM_Kg", "A1:G500")).slice(1)
  .map(r => Array.from({ length: 7 }, (_, i) => String(r[i] ?? "").trim()));

let bad = 0;
if (expect.length !== got.length) { console.log(`행 수 불일치: 원본 ${expect.length} / 공유 ${got.length}`); bad++; }
for (let i = 0; i < Math.max(expect.length, got.length); i++) {
  const a = (expect[i] || []).join("|"), b = (got[i] || []).join("|");
  if (a !== b) { if (bad++ < 10) console.log(`행 ${i + 2}\n  원본 ${a}\n  공유 ${b}`); }
}
console.log(bad ? `불일치 ${bad}건` : `전 행 일치 (${expect.length}건)`);

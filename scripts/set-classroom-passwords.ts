/**
 * 세션등록 시트 **M열(강의실 입장 암호)** 을 채운다.
 *
 * 규칙 = **영문약어 + MMDD** (진행일자는 시트 B열에서 읽는다).
 * 줌 회의 암호로 그대로 쓰기 때문에 **영문·숫자만** 쓴다 — 한글은 줌이 받지 않는다.
 *
 *   npx tsx scripts/set-classroom-passwords.ts          # 미리보기만
 *   npx tsx scripts/set-classroom-passwords.ts --write  # 실제 기록
 *
 * 일정이 바뀌면 다시 돌리면 된다(날짜를 시트에서 다시 읽는다).
 * ⛔ 이미 값이 있는 칸은 건드리지 않는다 — 사람이 손으로 바꾼 암호를 덮어쓰면
 *    줌에 걸어 둔 것과 어긋나 아무도 못 들어간다. 덮어쓰려면 --force 를 준다.
 */

import 'dotenv/config';
import { getServiceAccountAccessToken } from "../server/services/google-sheets";

const ID = process.env.GOOGLE_SECONDARY_SPREADSHEET_ID!;
const KEY = process.env.GOOGLE_SHEETS_API_KEY!;
const TAB = "LTT 세션등록";

/** 과목명에 이 조각이 들어 있으면 그 약어를 쓴다. 위에서부터 먼저 맞는 것. */
const ABBR: Array<[string, string]> = [
  ["의장", "CHAIR"],
  ["파운데이션", "FOUND"],
  ["멤버십", "MEMBER"],
  ["PR", "PR"],
  ["교육", "EDU"],
  ["성장", "GROWTH"],
  ["비지터", "VISITOR"],
  ["이벤트", "EVENT"],
  ["멘토링", "MENTOR"],
  ["ST", "ST"],
];

function abbrFor(title: string): string | null {
  for (const [needle, code] of ABBR) {
    if (title.includes(needle)) return code;
  }
  return null;
}

/** "8/27(목)" · "9/1 (화)" 같은 표기에서 MMDD 를 뽑는다 */
function mmdd(dateText: string): string | null {
  const m = String(dateText || "").match(/(\d{1,2})\s*\/\s*(\d{1,2})/);
  if (!m) return null;
  return m[1].padStart(2, "0") + m[2].padStart(2, "0");
}

(async () => {
  const write = process.argv.includes("--write");
  const force = process.argv.includes("--force");

  const range = encodeURIComponent(`'${TAB}'!A1:M20`);
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${ID}/values/${range}?key=${KEY}`);
  const j: any = await res.json();
  if (j.error) throw new Error(j.error.message);
  const rows: string[][] = j.values || [];

  const updates: Array<{ range: string; values: any[][] }> = [];
  const skipped: string[] = [];

  console.log("행 | 과목 | 날짜 | 암호");
  for (let i = 2; i < rows.length; i++) {
    const row = rows[i] || [];
    const title = String(row[3] || "").trim();
    const date = String(row[1] || "").trim();
    if (!title) continue;

    const code = abbrFor(title);
    const dd = mmdd(date);
    if (!code || !dd) {
      skipped.push(`${i + 1}행 ${title} (${!code ? "약어 없음" : "날짜 못 읽음"})`);
      continue;
    }

    const pw = code + dd;
    const current = String(row[12] || "").trim();
    if (current && !force) {
      skipped.push(`${i + 1}행 ${title} — 이미 "${current}" 가 있어 두었습니다`);
      continue;
    }

    console.log(`${i + 1} | ${title} | ${date} | ${pw}${current ? `  (기존 ${current} 덮어씀)` : ""}`);
    updates.push({ range: `'${TAB}'!M${i + 1}`, values: [[pw]] });
  }

  if (skipped.length) {
    console.log("\n건너뛴 것:");
    skipped.forEach((s) => console.log("  - " + s));
  }

  if (!write) {
    console.log(`\n미리보기입니다. 실제로 기록하려면 --write 를 붙이세요. (대상 ${updates.length}건)`);
    return;
  }

  if (!updates.length) {
    console.log("\n기록할 것이 없습니다.");
    return;
  }

  const token = await getServiceAccountAccessToken("https://www.googleapis.com/auth/spreadsheets");
  const put = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${ID}/values:batchUpdate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ valueInputOption: "RAW", data: [
      { range: `'${TAB}'!M2`, values: [["강의실 암호"]] },   // 머리글
      ...updates,
    ] }),
  });
  if (!put.ok) throw new Error(`${put.status} ${await put.text()}`);
  console.log(`\n${updates.length}건 기록 완료.`);

  // 검증 — 시트에서 다시 읽는다
  const after: any = await (await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${ID}/values/${range}?key=${KEY}`)).json();
  console.log("\n=== 시트에서 다시 읽은 값 ===");
  (after.values || []).slice(1).forEach((r: string[], idx: number) => {
    const t = String(r[3] || "").trim();
    if (t || idx === 0) console.log(`  ${String(r[3] || "과목")}  |  ${String(r[1] || "날짜")}  |  ${String(r[12] || "(빈칸)")}`);
  });
})();

/**
 * 신청명단에 `설문 링크 문자 발송` 열(AA)을 추가한다. **배포 전에 먼저 돌려야 한다.**
 *
 *   npx tsx scripts/add-survey-column.ts          # 확인만
 *   npx tsx scripts/add-survey-column.ts --apply  # 실제로 기록
 *
 * ⚠ 배포보다 **먼저** 돌린다. 서버 런타임은 `assertHeader` 를 부르지 않으므로 순서가
 *    뒤바뀌어도 멈추지는 않는다. 다만 헤더 없는 AA열에 발송 시각만 쌓여서, 시트를 여는
 *    사람에게는 정체 모를 값이 된다.
 * ⛔ 맨 끝에만 붙인다. 중간에 넣으면 그 뒤 열이 전부 한 칸씩 밀려
 *    취소·발송 기록이 통째로 어긋난다(2026-08-23 에 실제로 난 사고다).
 */

import "dotenv/config";
import { COLUMNS, colLetter } from "../server/services/sheet-schema";
import { getServiceAccountAccessToken } from "../server/services/google-sheets";

const TAB = "2026 LTT 신청명단";
const NEW_COLUMN = "설문 링크 문자 발송";

const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
const apiKey = process.env.GOOGLE_SHEETS_API_KEY;
const apply = process.argv.includes("--apply");

async function main() {

const res = await fetch(
  `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(`'${TAB}'!A1:BZ1`)}?key=${apiKey}`
);
if (!res.ok) throw new Error(`헤더 읽기 실패 ${res.status}: ${(await res.text()).slice(0, 200)}`);
const header: string[] = ((await res.json()) as any).values?.[0] || [];

const target = COLUMNS.indexOf(NEW_COLUMN as any);
if (target < 0) throw new Error(`스키마에 "${NEW_COLUMN}" 이 없습니다. sheet-schema.ts 를 먼저 고치세요.`);
if (target !== COLUMNS.length - 1) throw new Error(`"${NEW_COLUMN}" 은 스키마의 마지막 열이어야 합니다.`);

// 새 열 앞까지는 시트와 스키마가 **완전히** 같아야 한다. 하나라도 다르면 손대지 않는다.
const problems: string[] = [];
for (let i = 0; i < target; i++) {
  const want = COLUMNS[i];
  const got = String(header[i] ?? "").trim();
  if (want !== got) problems.push(`${colLetter(i)}: 기대 "${want}" / 실제 "${got}"`);
}
const extra = header.slice(target + 1).filter((v) => String(v ?? "").trim());
if (extra.length) problems.push(`새 열 뒤에 값이 있습니다 — ${extra.join(", ")}`);

if (problems.length) {
  console.error("❌ 헤더가 스키마와 달라 중단합니다. 열이 밀렸을 수 있습니다.\n  " + problems.join("\n  "));
  process.exit(1);
}

const cellRef = `${colLetter(target)}1`;
const current = String(header[target] ?? "").trim();
console.log(`시트 헤더 ${header.length}열 / 스키마 ${COLUMNS.length}열`);
console.log(`대상 : '${TAB}'!${cellRef}  현재 "${current || "(빈칸)"}"  →  "${NEW_COLUMN}"`);

if (current === NEW_COLUMN) {
  console.log("✅ 이미 들어가 있습니다. 아무것도 하지 않습니다.");
  return;
}
if (current) {
  console.error(`❌ ${cellRef} 에 다른 값("${current}")이 있습니다. 덮어쓰지 않습니다.`);
  process.exit(1);
}
if (!apply) {
  console.log("\n확인만 했습니다. 실제로 넣으려면 --apply 를 붙이세요.");
  return;
}

const token = await getServiceAccountAccessToken("https://www.googleapis.com/auth/spreadsheets");
const put = await fetch(
  `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(`'${TAB}'!${cellRef}`)}?valueInputOption=RAW`,
  {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ values: [[NEW_COLUMN]] }),
  }
);
if (!put.ok) throw new Error(`기록 실패 ${put.status}: ${(await put.text()).slice(0, 200)}`);
console.log(`✅ '${TAB}'!${cellRef} = "${NEW_COLUMN}"`);
}

await main();

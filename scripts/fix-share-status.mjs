/**
 * 공유 시트('신청자 명단 확인하기')의 신청현황 수식을 고친다.
 *
 * 왜
 *   공유 시트는 신청명단을 IMPORTRANGE 로 끌어와 신청현황을 다시 계산하는데,
 *   그 수식이 **열 번호**로 되어 있었다(A2:R · INDEX(f,,18)=취소).
 *   2026-08-23 신청명단을 재편하면서 취소가 S열로 밀리고 R열은 '결제자 이메일'이 됐다.
 *   그 뒤로 결제자 이메일이 있는 행(=결제한 행) 전부가 '취소완료'로 표시됐다.
 *   실제 취소 5건인데 화면엔 64건.
 *
 * 무엇
 *   열 번호를 걷어내고 **1행 헤더 이름**으로 찾게 바꾼다(sheet-schema.ts 와 같은 규칙).
 *   앞으로 열이 밀려도 표시가 조용히 틀리지 않는다.
 *
 *   node scripts/fix-share-status.mjs           # 미리보기
 *   node scripts/fix-share-status.mjs --write
 */
import { env, token } from "./_share-token.mjs";

const SHARE_ID = "1ENi99bJGBtjf1WYG1XXo-aH8eN-Zx6kmeUSU7ZqM_Kg";
const SRC_ID = env("GOOGLE_SPREADSHEET_ID");
const SRC_TAB = "2026 LTT 신청명단";
const CELL = "A2";

const FORMULA =
  `=IFERROR(LET(` +
  `h, IMPORTRANGE("${SRC_ID}","'${SRC_TAB}'!A1:Z1"),` +
  `d, IMPORTRANGE("${SRC_ID}","'${SRC_TAB}'!A2:Z"),` +
  `c, LAMBDA(n, MATCH(n, h, 0)),` +
  `f, FILTER(d, INDEX(d,,c("멤버명"))<>""),` +
  `{INDEX(f,,c("신청일시")), INDEX(f,,c("과목명")), INDEX(f,,c("지역")), INDEX(f,,c("챕터")), INDEX(f,,c("멤버명")), INDEX(f,,c("참여 방식")), ` +
  `ARRAYFORMULA(IF(INDEX(f,,c("취소"))<>"","취소완료",IF(INDEX(f,,c("신청현황"))="완료","결제완료","결제대기")))}` +
  `), "")`;

const write = process.argv.includes("--write");
const H = { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" };
const base = `https://sheets.googleapis.com/v4/spreadsheets/${SHARE_ID}`;

const tally = (rows) => rows.slice(1).reduce((a, r) => ((a[r[6] || "(빈칸)"] = (a[r[6] || "(빈칸)"] || 0) + 1), a), {});
const read = async (range, extra = "") =>
  ((await (await fetch(`${base}/values/${range}${extra}`, { headers: H })).json()).values) || [];

console.log("── 현재 수식\n" + ((await read(CELL, "?valueRenderOption=FORMULA"))[0]?.[0] ?? "(없음)"));
console.log("── 현재 표시\n", tally(await read("A1:G500")));
console.log("── 새 수식\n" + FORMULA);

if (!write) {
  console.log("\n미리보기입니다. 적용하려면 --write");
} else {
  const res = await fetch(`${base}/values/${CELL}?valueInputOption=USER_ENTERED`, {
    method: "PUT", headers: H, body: JSON.stringify({ values: [[FORMULA]] }),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const after = await read("A1:G500");
  console.log(`\n적용했습니다. 행 ${after.length - 1}건 —`, tally(after));
}

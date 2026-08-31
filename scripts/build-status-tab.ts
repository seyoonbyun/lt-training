/**
 * 신청명단 파일에 담당자용 `신청 현황` 탭을 만든다.
 *
 * 집계는 전부 **수식**이라 신청명단 원본이 바뀌면 자동으로 따라온다.
 * 과목 정보(날짜·형식·단가·마감)는 다른 파일(세션등록)에 있어 IMPORTRANGE 가 필요한데,
 * 권한 허용을 한 번 눌러야 살아나는 값이라 **스냅샷으로 적는다**.
 * 세션이 바뀌면 이 스크립트를 다시 돌리면 된다.
 *
 *   npx tsx scripts/build-status-tab.ts
 *
 * ⛔ 신청명단 원본(A~Q)은 건드리지 않는다. 탭만 새로 쓴다.
 */

import 'dotenv/config';
import { getServiceAccountAccessToken, googleSheetsService } from "../server/services/google-sheets";

const ID = process.env.GOOGLE_SPREADSHEET_ID!;
const KEY = process.env.GOOGLE_SHEETS_API_KEY!;
const SRC = "2026 LTT 신청명단";
const TAB = "신청 현황";

async function api(path: string, init?: RequestInit) {
  const token = await getServiceAccountAccessToken("https://www.googleapis.com/auth/spreadsheets");
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${ID}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

(async () => {
  const programs = (await googleSheetsService.getSecondarySheetPrograms()) as any[];
  if (!programs.length) throw new Error("세션등록에서 과목을 읽지 못했습니다.");
  console.log(`과목 ${programs.length}개를 읽었습니다.`);

  // ── 탭 준비 (있으면 지우고 새로 만든다. 원본 시트는 손대지 않는다)
  const meta: any = await (await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${ID}?key=${KEY}`)).json();
  const existing = (meta.sheets || []).find((s: any) => s.properties.title === TAB);
  if (existing) {
    await api(":batchUpdate", {
      method: "POST",
      body: JSON.stringify({ requests: [{ deleteSheet: { sheetId: existing.properties.sheetId } }] }),
    });
    console.log("기존 탭 삭제");
  }
  const added: any = await api(":batchUpdate", {
    method: "POST",
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title: TAB, gridProperties: { rowCount: 40, columnCount: 13 } } } }] }),
  });
  const sheetId = added.replies[0].addSheet.properties.sheetId;
  console.log("탭 생성");

  // ── 내용
  const q = (col: string) => `'${SRC}'!$${col}$2:$${col}`;
  const rows: any[][] = [];

  rows.push([`LTT 신청 현황  ·  집계는 자동입니다(신청명단이 바뀌면 즉시 반영)`]);
  rows.push([`과목 정보는 ${new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} 기준 스냅샷입니다.`]);
  rows.push([]);
  rows.push(["과목명", "날짜", "시간", "형식", "단가", "신청", "결제완료", "미결제", "취소", "실시간", "VOD", "결제금액", "마감"]);

  const first = 5;                                  // 데이터 시작 행
  programs.forEach((p, i) => {
    const r = first + i;
    rows.push([
      p.title,
      p.date || "",
      p.time || "",
      p.format || "",
      p.price || 0,
      `=COUNTIF(${q("B")},$A${r})`,
      // 결제완료는 **취소되지 않은** 건만 센다(R열이 비어 있어야 한다)
      `=COUNTIFS(${q("B")},$A${r},${q("J")},"완료",${q("R")},"")`,
      `=COUNTIFS(${q("B")},$A${r},${q("J")},"")-COUNTIFS(${q("B")},$A${r},${q("J")},"",${q("R")},"<>")`,
      `=COUNTIFS(${q("B")},$A${r},${q("R")},"<>")`,
      `=COUNTIFS(${q("B")},$A${r},${q("J")},"완료",${q("R")},"",${q("H")},"*실시간*")`,
      `=$G${r}-$J${r}`,
      `=$G${r}*$E${r}`,
      // 전체 마감(K열)과 실시간만 마감(N열)을 갈라서 적는다 — 오피스가 이 탭만 보고
      // "닫혔다"고 답하면 녹화본 신청을 놓친다.
      !p.isAvailable ? "마감" : (p.isLiveAvailable === false ? "실시간 마감" : ""),
    ]);
  });

  const last = first + programs.length - 1;
  rows.push([]);
  rows.push(["합계", "", "", "", "",
    `=SUM(F${first}:F${last})`, `=SUM(G${first}:G${last})`, `=SUM(H${first}:H${last})`,
    `=SUM(I${first}:I${last})`, `=SUM(J${first}:J${last})`, `=SUM(K${first}:K${last})`,
    `=SUM(L${first}:L${last})`, ""]);
  rows.push([]);
  rows.push(["※ 신청 = 접수된 모든 행. 결제완료·미결제·실시간·VOD 는 모두 취소되지 않은 건만 셉니다."]);
  rows.push(["※ 취소 = 담당자가 취소·환불 접수 응답 시트에서 '환불처리 = 완료' 로 처리한 건(신청명단 R열)."]);
  rows.push(["※ 결제금액은 단가 × 결제완료 건수로 계산합니다(신청명단에 금액 열이 없습니다)."]);

  await api(`/values/${encodeURIComponent(`'${TAB}'!A1`)}?valueInputOption=USER_ENTERED`, {
    method: "PUT",
    body: JSON.stringify({ values: rows }),
  });
  console.log(`값 ${rows.length}행 기록`);

  // ── 서식
  const headerRow = 3;                              // 0-based
  const totalRow = last;                            // 0-based 로는 last (합계는 last+1 행)
  await api(":batchUpdate", {
    method: "POST",
    body: JSON.stringify({
      requests: [
        { repeatCell: {
            range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
            cell: { userEnteredFormat: { textFormat: { bold: true, fontSize: 12 } } },
            fields: "userEnteredFormat.textFormat" } },
        { repeatCell: {
            range: { sheetId, startRowIndex: headerRow, endRowIndex: headerRow + 1 },
            cell: { userEnteredFormat: {
              backgroundColor: { red: 0.81, green: 0.13, blue: 0.19 },
              textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
              horizontalAlignment: "CENTER" } },
            fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)" } },
        { repeatCell: {
            range: { sheetId, startRowIndex: totalRow + 1, endRowIndex: totalRow + 2 },
            cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.95, green: 0.95, blue: 0.95 } } },
            fields: "userEnteredFormat(textFormat,backgroundColor)" } },
        { repeatCell: {
            range: { sheetId, startRowIndex: first - 1, endRowIndex: last, startColumnIndex: 4, endColumnIndex: 5 },
            cell: { userEnteredFormat: { numberFormat: { type: "NUMBER", pattern: "#,##0" } } },
            fields: "userEnteredFormat.numberFormat" } },
        { repeatCell: {
            range: { sheetId, startRowIndex: first - 1, endRowIndex: totalRow + 2, startColumnIndex: 11, endColumnIndex: 12 },
            cell: { userEnteredFormat: { numberFormat: { type: "NUMBER", pattern: "#,##0" } } },
            fields: "userEnteredFormat.numberFormat" } },
        { updateSheetProperties: {
            properties: { sheetId, gridProperties: { frozenRowCount: headerRow + 1 } },
            fields: "gridProperties.frozenRowCount" } },
        { autoResizeDimensions: { dimensions: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 13 } } },
      ],
    }),
  });
  console.log("서식 적용");

  // ── 검증: 수식이 실제 값으로 계산되는지 본다
  const check: any = await (await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${ID}/values/${encodeURIComponent(`'${TAB}'!A4:M${last + 2}`)}?key=${KEY}`
  )).json();
  console.log("\n=== 계산된 값 ===");
  (check.values || []).forEach((r: string[]) => console.log("  " + r.slice(0, 13).join(" | ")));
})();

/**
 * 신청명단 파일에 `지원 대상` 탭을 만든다.
 *
 * 이 탭에 적힌 사람은 결제 금액이 0원(또는 지원금액만큼 할인)이 된다.
 * 판정은 **지역 + 챕터 + 연락처**가 다 맞아야 한다. 이름은 대조하지 않는다 —
 * 오타 한 글자로 지원이 안 먹으면 그분이 돈을 내버리고, 되돌리려면 토스 상점관리자에서
 * 사람이 카드 취소까지 해야 한다(불일치는 로그로만 남긴다).
 *
 *   npx tsx scripts/build-sponsor-tab.ts
 *
 * ⛔ 탭이 이미 있으면 **데이터를 절대 지우지 않는다.** 담당자가 채워 넣은 명단이다.
 *    헤더·서식만 다시 맞추려면 `--reformat`.
 * ⭐ 옛 열 구성(지역·챕터가 없던 5열)이면 **행을 새 자리로 옮겨 적는다**(`--reformat` 필요).
 */

import 'dotenv/config';
import { getServiceAccountAccessToken } from "../server/services/google-sheets";
import { SPONSOR_TAB, SPONSOR_COLUMNS, SPONSOR_COLUMNS_V1 } from "../server/services/sponsor-list";

const ID = process.env.GOOGLE_SPREADSHEET_ID!;
const REFORMAT = process.argv.includes("--reformat");

/** 데이터 열 A~G */
const COLS = SPONSOR_COLUMNS.length;
const LAST = String.fromCharCode(64 + COLS);      // "G"
/** 안내문 열 (데이터와 한 칸 띄운다) */
const GUIDE_COL_INDEX = COLS + 1;                 // 0-based: H 를 비우고 I
const GUIDE_COL = String.fromCharCode(65 + GUIDE_COL_INDEX);

async function token() {
  return getServiceAccountAccessToken("https://www.googleapis.com/auth/spreadsheets");
}

async function api(path: string, init?: RequestInit) {
  const t = await token();
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${ID}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

async function readValues(range: string): Promise<string[][]> {
  const t = await token();
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${ID}/values/${encodeURIComponent(range)}`,
    { headers: { Authorization: `Bearer ${t}` } }
  );
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return ((await res.json()) as any).values || [];
}

/** 담당자가 읽을 사용법. 데이터 열 오른쪽에 따로 둔다 — 파싱 범위와 겹치지 않는다. */
const GUIDE = [
  ["■ 지원 대상 명단 — 이 탭에 적힌 분은 결제 금액이 0원이 됩니다."],
  [""],
  ["· 판정은 지역 + 챕터 + 연락처가 모두 맞아야 합니다."],
  ["  신청서에 적은 지역·챕터가 이 명단과 다르면 지원이 적용되지 않습니다."],
  ["· 연락처는 010-1234-5678 이든 01012345678 이든 상관없습니다."],
  ["· 이름은 참고용입니다. 대조하지 않으니 지역·챕터·연락처만 정확하면 됩니다."],
  ["· 지역·챕터를 비우면 그 항목은 따지지 않습니다(전 지역 / 전 챕터)."],
  ["· 지원 과목을 비우면 전 과목 지원입니다. 특정 과목만 지원하려면"],
  ["  과목명을 그대로 적고, 여러 개면 쉼표로 나눕니다."],
  ["· 지원 금액을 비우면 전액 지원(0원)입니다. 숫자를 적으면 그만큼만 깎고,"],
  ["  남은 금액은 평소대로 토스 결제창이 뜹니다."],
  ["· 명단에서 지우면 그때부터 정가로 돌아갑니다. 이미 완료된 신청은 그대로 둡니다."],
  [""],
  ["⚠ 지원은 개별 신청에만 적용됩니다. 일괄(대리) 신청은 정가로 결제됩니다."],
  ["⚠ 반영까지 최대 2~3분 걸립니다(사이트가 시트를 캐시합니다)."],
];

/** 열 너비 (데이터 A~G · 여백 H · 안내문 I) */
const WIDTHS = [110, 140, 100, 130, 260, 110, 180, 24, 520];

(async () => {
  const t = await token();
  const meta: any = await (await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${ID}?fields=sheets.properties`,
    { headers: { Authorization: `Bearer ${t}` } }
  )).json();

  const existing = (meta.sheets || []).find((s: any) => s.properties.title === SPONSOR_TAB);
  let sheetId: number;
  let migrated: string[][] | null = null;

  if (existing) {
    sheetId = existing.properties.sheetId;

    // 지금 헤더가 옛 구성인지 본다. 추측하지 않고 헤더 글자를 그대로 대조한다.
    const head = (await readValues(`'${SPONSOR_TAB}'!A1:G1`))[0] || [];
    const isV1 = SPONSOR_COLUMNS_V1.every((c, i) => String(head[i] || "").trim() === c);
    const isV2 = SPONSOR_COLUMNS.every((c, i) => String(head[i] || "").trim() === c);

    if (!REFORMAT) {
      console.log(`이미 '${SPONSOR_TAB}' 탭이 있습니다 (sheetId ${sheetId}). 데이터를 건드리지 않고 끝냅니다.`);
      if (isV1) console.log("⚠ 열 구성이 옛 것입니다(지역·챕터 없음). 옮기려면: npx tsx scripts/build-sponsor-tab.ts --reformat");
      return;
    }

    if (isV1) {
      // ⭐ 옛 행을 새 자리로 옮긴다. 지역·챕터는 알 수 없으니 비워 둔다(= 안 따짐).
      const rows = await readValues(`'${SPONSOR_TAB}'!A2:E`);
      migrated = rows
        .filter((r) => r.some((c) => String(c || "").trim()))
        .map((r) => ["", "", r[0] || "", r[1] || "", r[2] || "", r[3] || "", r[4] || ""]);
      console.log(`옛 열 구성 감지 — 데이터 ${migrated.length}행을 새 자리로 옮깁니다 (지역·챕터는 비워 둡니다).`);
      migrated.forEach((r) => console.log(`   · ${r[2]} ${r[3]}`));
    } else if (isV2) {
      console.log(`기존 탭 재서식 (sheetId ${sheetId}) — 데이터 행은 그대로 둡니다.`);
    } else {
      throw new Error(`'${SPONSOR_TAB}' 탭 헤더가 알 수 없는 구성입니다: ${head.join(" | ")}`);
    }
  } else {
    const added: any = await api(":batchUpdate", {
      method: "POST",
      body: JSON.stringify({
        requests: [{ addSheet: { properties: { title: SPONSOR_TAB, gridProperties: { rowCount: 500, columnCount: 14 } } } }],
      }),
    });
    sheetId = added.replies[0].addSheet.properties.sheetId;
    console.log(`탭 생성 (sheetId ${sheetId})`);
  }

  // ── 옛 구성이었으면 데이터 영역을 비우고 새 자리에 다시 적는다
  if (migrated) {
    await api(`/values/${encodeURIComponent(`'${SPONSOR_TAB}'!A2:${LAST}`)}:clear`, { method: "POST", body: "{}" });
    if (migrated.length) {
      // ⛔ RAW 로 쓴다. USER_ENTERED 면 구글이 01028033021 을 숫자로 읽어 **앞자리 0 이 날아간다**
      //    (실제로 한 번 겪었다 — 서식은 이 뒤에 적용되므로 쓰는 시점엔 아직 텍스트 열이 아니다).
      await api(`/values/${encodeURIComponent(`'${SPONSOR_TAB}'!A2`)}?valueInputOption=RAW`, {
        method: "PUT",
        body: JSON.stringify({ values: migrated }),
      });
    }
  }

  // ── 헤더 (1행) + 안내문. 데이터 행은 쓰지 않는다.
  await api(`/values:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({
      valueInputOption: "USER_ENTERED",
      data: [
        { range: `'${SPONSOR_TAB}'!A1:${LAST}1`, values: [SPONSOR_COLUMNS as unknown as string[]] },
        { range: `'${SPONSOR_TAB}'!${GUIDE_COL}1:${GUIDE_COL}${GUIDE.length}`, values: GUIDE },
      ],
    }),
  });
  console.log("헤더·안내문 기록");

  // ── 서식
  const phoneCol = SPONSOR_COLUMNS.indexOf("연락처" as any);
  const amountCol = SPONSOR_COLUMNS.indexOf("지원 금액(원)" as any);
  await api(":batchUpdate", {
    method: "POST",
    body: JSON.stringify({
      requests: [
        // 헤더 = BNI 레드 + 흰 굵은 글씨
        { repeatCell: {
            range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: COLS },
            cell: { userEnteredFormat: {
              backgroundColor: { red: 0.81, green: 0.13, blue: 0.19 },
              textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
              horizontalAlignment: "CENTER" } },
            fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)" } },
        // ⛔ 연락처는 텍스트로 둔다. 숫자로 두면 01012345678 의 맨 앞 0 이 사라진다.
        { repeatCell: {
            range: { sheetId, startRowIndex: 1, startColumnIndex: phoneCol, endColumnIndex: phoneCol + 1 },
            cell: { userEnteredFormat: { numberFormat: { type: "TEXT" } } },
            fields: "userEnteredFormat.numberFormat" } },
        { repeatCell: {
            range: { sheetId, startRowIndex: 1, startColumnIndex: amountCol, endColumnIndex: amountCol + 1 },
            cell: { userEnteredFormat: { numberFormat: { type: "NUMBER", pattern: "#,##0" } } },
            fields: "userEnteredFormat.numberFormat" } },
        // 안내문 = 회색 작은 글씨
        { repeatCell: {
            range: { sheetId, startRowIndex: 0, endRowIndex: GUIDE.length, startColumnIndex: GUIDE_COL_INDEX, endColumnIndex: GUIDE_COL_INDEX + 1 },
            cell: { userEnteredFormat: { textFormat: {
              fontSize: 10, foregroundColor: { red: 0.35, green: 0.35, blue: 0.35 } } } },
            fields: "userEnteredFormat.textFormat" } },
        { updateSheetProperties: {
            properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
            fields: "gridProperties.frozenRowCount" } },
        { setBasicFilter: { filter: { range: { sheetId, startRowIndex: 0, startColumnIndex: 0, endColumnIndex: COLS } } } },
        ...WIDTHS.map((pixelSize, i) => ({
          updateDimensionProperties: {
            range: { sheetId, dimension: "COLUMNS", startIndex: i, endIndex: i + 1 },
            properties: { pixelSize }, fields: "pixelSize",
          },
        })),
      ],
    }),
  });
  console.log("서식 적용");

  // ── 검증: 열 너비가 한 번에 안 먹는 경우가 있어 읽어서 확인한다
  const check: any = await (await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${ID}?fields=sheets(properties,data.columnMetadata.pixelSize)`,
    { headers: { Authorization: `Bearer ${t}` } }
  )).json();
  const tab = (check.sheets || []).find((s: any) => s.properties.title === SPONSOR_TAB);
  const widths = (tab?.data?.[0]?.columnMetadata || []).slice(0, WIDTHS.length).map((c: any) => c.pixelSize);
  const widthOk = JSON.stringify(widths) === JSON.stringify(WIDTHS);
  console.log(`${widthOk ? "✓" : "✗"} 열 너비: ${widths.join(" · ")}${widthOk ? "" : `  (기대 ${WIDTHS.join(" · ")})`}`);

  const head = (await readValues(`'${SPONSOR_TAB}'!A1:${LAST}1`))[0] || [];
  const headOk = SPONSOR_COLUMNS.every((c, i) => head[i] === c);
  console.log(`${headOk ? "✓" : "✗"} 헤더: ${head.join(" | ")}`);

  const data = await readValues(`'${SPONSOR_TAB}'!A2:${LAST}`);
  const filled = data.filter((r) => r.some((c) => String(c || "").trim()));
  console.log(`✓ 데이터 ${filled.length}행`);
  filled.slice(0, 20).forEach((r, i) =>
    console.log(`   ${i + 2}행  지역=${r[0] || "(전체)"} · 챕터=${r[1] || "(전체)"} · ${r[2] || ""} · ${r[3] || ""}`)
  );
})();

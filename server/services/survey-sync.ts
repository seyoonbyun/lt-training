/**
 * 설문 응답을 **신청명단 구글시트의 `설문 응답` 탭**으로 옮겨 쌓는다.
 *
 * 응답은 에어테이블 폼으로 들어오지만, 운영은 신청명단 파일 한 곳에서 본다.
 * 담당자가 접수·취소·발송 기록을 보는 그 파일에 설문도 같이 있어야 대조가 된다.
 *
 * 에어테이블 자동화(Google Sheets 액션)를 안 쓴 이유
 *   무료 플랜은 자동화 실행이 **월 100회**다. 한 세션에 수십 명이 답하면 금방 넘고,
 *   넘으면 **조용히 멈춘다** — 시트만 보는 사람은 "응답이 없네" 로 읽는다.
 *   서버가 직접 옮기면 한도가 없고, 실패가 로그에 남는다.
 *
 * ⛔ 중복 적재를 막는 키는 **에어테이블 레코드 ID** 하나다. 시간·이름으로 맞추면
 *    같은 사람이 두 과목에 답한 것과 재적재를 구분하지 못한다.
 * ⛔ 토큰이 없으면 **조용히 넘기지 않는다.** 한 번은 반드시 로그에 남긴다
 *    (Railway 에 `AIRTABLE_TOKEN` 을 안 넣으면 시트가 영원히 비어 있게 된다).
 */

import { getServiceAccountAccessToken, googleSheetsService } from "./google-sheets";

const BASE_ID = "app1K25AF4bAhA24S";
const TABLE_ID = "tblcOf4ao4864aJQs";
const TAB = "설문 응답";

/** 시트 열 순서. 마지막 `레코드ID` 가 중복 판정의 유일한 근거다. */
const HEADER = [
  "제출일시",
  "과목",
  "교육 내용 만족도",
  "강사 만족도",
  "운영·진행 만족도",
  "추천 의향",
  "가장 도움이 된 점",
  "개선했으면 하는 점",
  "이름",
  "챕터",
  "레코드ID",
] as const;

const SHEETS = "https://sheets.googleapis.com/v4/spreadsheets";

function token(): string {
  return String(process.env.AIRTABLE_TOKEN || "").trim();
}

export function isSurveySyncConfigured(): boolean {
  return token().length > 0;
}

function kst(iso: string): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    timeZone: "Asia/Seoul",
  }).format(new Date(iso));
}

interface AirtableRecord {
  id: string;
  createdTime: string;
  fields: Record<string, any>;
}

/** 에어테이블 레코드 전부. 100건씩 넘어오므로 offset 으로 이어 받는다. */
async function fetchRecords(): Promise<AirtableRecord[]> {
  const out: AirtableRecord[] = [];
  let offset: string | undefined;
  do {
    const url = new URL(`https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}`);
    url.searchParams.set("pageSize", "100");
    if (offset) url.searchParams.set("offset", offset);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token()}` } });
    if (!res.ok) {
      throw new Error(`에어테이블 읽기 실패 ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    const data: any = await res.json();
    out.push(...(data.records || []));
    offset = data.offset;
  } while (offset);
  return out;
}

/** `설문 응답` 탭이 없으면 만들고 헤더를 넣는다. 있으면 아무것도 하지 않는다. */
async function ensureTab(): Promise<void> {
  const spreadsheetId = googleSheetsService.getSheetInfo().primary;
  const auth = await getServiceAccountAccessToken("https://www.googleapis.com/auth/spreadsheets");

  const metaRes = await fetch(`${SHEETS}/${spreadsheetId}?fields=sheets.properties.title`, {
    headers: { Authorization: `Bearer ${auth}` },
  });
  if (!metaRes.ok) throw new Error(`시트 목록 읽기 실패 ${metaRes.status}`);
  const meta: any = await metaRes.json();
  const exists = (meta.sheets || []).some((s: any) => s.properties?.title === TAB);
  if (exists) return;

  // ⛔ addSheet 만 한다. 다른 탭은 건드리지 않는다 — 이 파일에는 신청명단과
  //    취소·환불 응답 탭이 같이 있고, 탭 이름 하나만 바뀌어도 Apps Script 가 조용히 죽는다.
  const add = await fetch(`${SHEETS}/${spreadsheetId}:batchUpdate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${auth}`, "Content-Type": "application/json" },
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title: TAB } } }] }),
  });
  if (!add.ok) throw new Error(`"${TAB}" 탭 생성 실패 ${add.status}: ${(await add.text()).slice(0, 200)}`);

  const head = await fetch(
    `${SHEETS}/${spreadsheetId}/values/${encodeURIComponent(`'${TAB}'!A1`)}?valueInputOption=RAW`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${auth}`, "Content-Type": "application/json" },
      body: JSON.stringify({ values: [HEADER as unknown as string[]] }),
    }
  );
  if (!head.ok) throw new Error(`"${TAB}" 헤더 기록 실패 ${head.status}`);
  console.log(`[설문] "${TAB}" 탭을 새로 만들었습니다.`);
}

/** 이미 들어간 레코드 ID. 마지막 열만 읽는다. */
async function existingIds(): Promise<Set<string>> {
  const colLetter = String.fromCharCode(65 + HEADER.length - 1); // K
  const rows = await googleSheetsService.readApplicationRows(`'${TAB}'!${colLetter}2:${colLetter}`);
  return new Set(rows.map((r) => String(r?.[0] || "").trim()).filter(Boolean));
}

function toRow(rec: AirtableRecord): string[] {
  const f = rec.fields || {};
  const v = (name: string) => {
    const x = f[name];
    return x === undefined || x === null ? "" : String(x);
  };
  return [
    kst(rec.createdTime),
    v("과목"),
    v("교육 내용 만족도"),
    v("강사 만족도"),
    v("운영·진행 만족도"),
    v("추천 의향"),
    v("가장 도움이 된 점"),
    v("개선했으면 하는 점"),
    v("이름"),
    v("챕터"),
    rec.id,
  ];
}

/** 1회 실행. 새 응답만 골라 `설문 응답` 탭 끝에 붙인다. */
export async function runSurveySync(): Promise<{ added: number; total: number; reason?: string }> {
  if (!isSurveySyncConfigured()) {
    return { added: 0, total: 0, reason: "no-token" };
  }

  await ensureTab();
  const [records, already] = await Promise.all([fetchRecords(), existingIds()]);

  const fresh = records
    .filter((r) => !already.has(r.id))
    .sort((a, b) => a.createdTime.localeCompare(b.createdTime));
  if (fresh.length === 0) return { added: 0, total: records.length };

  const spreadsheetId = googleSheetsService.getSheetInfo().primary;
  const auth = await getServiceAccountAccessToken("https://www.googleapis.com/auth/spreadsheets");
  // ⛔ RAW 로 쓴다. USER_ENTERED 면 시트가 값을 해석해 버린다(연락처 앞자리 0 이 날아간 전례).
  const res = await fetch(
    `${SHEETS}/${spreadsheetId}/values/${encodeURIComponent(`'${TAB}'!A1`)}:append` +
      `?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${auth}`, "Content-Type": "application/json" },
      body: JSON.stringify({ values: fresh.map(toRow) }),
    }
  );
  if (!res.ok) {
    throw new Error(`"${TAB}" 적재 실패 ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }

  console.log(`[설문] 새 응답 ${fresh.length}건을 "${TAB}" 탭에 적재했습니다 (누적 ${records.length}건).`);
  return { added: fresh.length, total: records.length };
}

let timer: NodeJS.Timeout | null = null;
let warned = false;

/**
 * 주기 적재. 폼 응답은 실시간일 필요가 없어 기본 10분마다 본다.
 *
 *   SURVEY_SYNC_ENABLED   off 로 두면 끈다
 *   SURVEY_SYNC_MIN       주기(분), 기본 10
 *   AIRTABLE_TOKEN        읽기 전용 PAT (없으면 적재를 못 한다)
 */
export function startSurveySyncScheduler() {
  if (timer) return;

  if ((process.env.SURVEY_SYNC_ENABLED || "on").toLowerCase() === "off") {
    console.log("[설문] SURVEY_SYNC_ENABLED=off — 시트 적재를 켜지 않습니다.");
    return;
  }
  if (!isSurveySyncConfigured()) {
    // 여기서 조용히 돌아서면 시트가 영원히 비어 있는데 아무도 이유를 모른다.
    console.error("❌ [설문] AIRTABLE_TOKEN 이 없어 시트 적재를 켜지 못했습니다. 응답은 에어테이블에만 쌓입니다.");
    return;
  }

  const everyMin = Math.max(1, Number(process.env.SURVEY_SYNC_MIN || 10));

  const tick = async () => {
    try {
      await runSurveySync();
      warned = false;
    } catch (error: any) {
      // 같은 오류로 로그를 도배하지 않되, 처음 한 번은 반드시 남긴다.
      if (!warned) console.error("❌ [설문] 시트 적재 실패:", error?.message || error);
      warned = true;
    }
  };

  timer = setInterval(tick, everyMin * 60 * 1000);
  void tick();

  console.log(`[설문] 시트 적재 시작 — ${everyMin}분마다 "${TAB}" 탭으로`);
}

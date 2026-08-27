/**
 * 만족도 설문 문자 — **트레이닝 종료 시각**에 그날 참여자에게 보낸다.
 *
 * 리마인드(`reminder.ts`)와 뼈대가 같다. 다른 것은 셋이다.
 *   1) 시각이 과목마다 다르다 — 세션등록 C열(`13:00~17:00(4시간)`)의 **끝 시각**을 읽는다.
 *   2) **실시간 참여자만** 보낸다. 녹화본(VOD)은 강의 익일 오후부터 시청이라
 *      당일 종료시각엔 아직 보지도 않았다.
 *   3) 링크가 우리 도메인(`/survey?s=N`)이다. 에어테이블 주소를 그대로 실으면
 *      문자에서 잘리고, QR 은 한 번 박히면 못 바꾼다.
 *
 * ⛔ 중복 발송을 막는 것이 핵심이다. 컨테이너가 재시작해도 다시 보내면 안 되므로
 *    보낸 뒤 `설문 링크 문자 발송` 열에 시각을 적고, 값이 있는 행은 건너뛴다.
 *    (메모리 플래그만 두면 Railway 재배포 한 번에 전원 재발송된다)
 */

import { cell, get as getCol, sheetRange } from "./sheet-schema";
import { googleSheetsService } from "./google-sheets";
import { isSolapiConfigured, sendMessages, smsByteLength, type SmsMessage } from "./solapi";
import { groupByPhone, CONTACT_NAME, CONTACT_TEL, BRAND, type SmsRecipient } from "./enrollment-notice";
import { SURVEY_PATH, SURVEY_URL } from "../../shared/site-links";
import { sendStamp } from "../../shared/stamp";

const SHEET_NAME = "2026 LTT 신청명단";

/** 문자에 실을 주소. 운영은 기본값 그대로고, 다른 도메인으로 띄울 때만 환경변수로 바꾼다. */
const SURVEY_BASE = process.env.PUBLIC_SITE_URL
  ? `${process.env.PUBLIC_SITE_URL.replace(/\/+$/, "")}${SURVEY_PATH}`
  : SURVEY_URL;

/**
 * 종료 시각이 지난 뒤 몇 분까지 보낼 것인가.
 *
 * ⛔ 상한이 필요하다. 컨테이너가 저녁에 재시작하면 이미 몇 시간 지난 과목이 대상으로
 *   잡히는데, 밤 늦게 도착하는 설문 문자는 안 보내느니만 못하다.
 */
const LATE_LIMIT_MIN = 240;
/** 이 시각(KST)을 넘으면 보내지 않는다. 21시 종료 과목이 자정 넘겨 나가는 것을 막는다. */
const LATEST_HOUR = 22;
const LATEST_MINUTE = 30;

/** KST 기준 오늘 날짜(YYYY-MM-DD). 서버 타임존이 무엇이든 한국 기준으로 판정한다. */
export function todayKst(now = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
}

/** 지금이 KST 로 몇 시 몇 분인지 → 자정부터 지난 분 */
export function kstMinutes(now = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value || "0");
  return g("hour") * 60 + g("minute");
}

/**
 * 세션등록 C열에서 **끝 시각**을 분으로 읽는다.
 *
 *   "13:00~17:00(4시간)"   -> 1020
 *   "12:00-17:00(5시간)"   -> 1020
 *   "18:00 - 21:00 (3시간)" -> 1260
 *
 * ⛔ 표기가 세 가지나 되므로 구분자로 자르지 않고 `HH:MM` 을 전부 찾아 **마지막 것**을 쓴다.
 *   시각이 하나뿐이면(끝 시각을 안 적은 과목) null 을 돌려준다 — 시작 시각에 설문을
 *   보내는 것이 최악이라, 지어내느니 안 보내고 로그를 남긴다.
 */
export function parseEndMinutes(time: string | undefined): number | null {
  const found = Array.from(String(time || "").matchAll(/(\d{1,2}):(\d{2})/g));
  if (found.length < 2) return null;
  const last = found[found.length - 1];
  const h = Number(last[1]);
  const m = Number(last[2]);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

export interface SurveyTarget {
  /** 세션등록 A열 `Session 3` 의 3. 문자 링크가 이 번호만 싣는다. */
  sessionNo: string;
  title: string;
  endMinutes: number;
}

/** 지금 설문을 보내야 하는 과목들. */
export async function findDueSessions(now = new Date()): Promise<{
  due: SurveyTarget[];
  tooLate: SurveyTarget[];
}> {
  const today = todayKst(now);
  const nowMin = kstMinutes(now);
  const cutoff = Math.min(nowMin, LATEST_HOUR * 60 + LATEST_MINUTE);

  const programs = (await googleSheetsService.getSecondarySheetPrograms()) as any[];
  const due: SurveyTarget[] = [];
  const tooLate: SurveyTarget[] = [];

  for (const p of programs) {
    if (!p.formattedDate) continue;
    const date = new Date(p.formattedDate).toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
    if (date !== today) continue;

    const endMinutes = parseEndMinutes(p.time);
    if (endMinutes == null) {
      console.warn(`[설문] "${p.title}" 은 끝 시각을 못 읽었습니다(시간 "${p.time}") — 보내지 않습니다.`);
      continue;
    }
    if (nowMin < endMinutes) continue;

    const target: SurveyTarget = {
      sessionNo: String(p.sessionNumber || "").replace(/[^0-9]/g, ""),
      title: p.title,
      endMinutes,
    };
    // 너무 늦은 건은 조용히 넘기지 않는다. 왜 안 나갔는지 로그에 남는다.
    if (nowMin > endMinutes + LATE_LIMIT_MIN || nowMin > cutoff) tooLate.push(target);
    else due.push(target);
  }

  return { due, tooLate };
}

export interface PendingRow {
  row: number;
  recipient: SmsRecipient;
}

/**
 * 대상자 = 결제완료 + 취소 아님 + **실시간 참여** + 아직 안 보낸 행.
 *
 * ⛔ 읽는 범위는 스키마가 정한다(`sheetRange`). 예전에 범위를 짧게 잘라 읽어
 *   취소 열이 늘 빈 값이 된 적이 있다 — 취소한 분에게 문자가 그대로 나갔다.
 */
export async function findAttendees(titles: string[]): Promise<PendingRow[]> {
  if (titles.length === 0) return [];
  const values = await googleSheetsService.readApplicationRows(sheetRange(SHEET_NAME));
  const rows: PendingRow[] = [];

  // 1행은 헤더. 시트 행 번호는 1-based 이므로 index+1.
  for (let i = 1; i < values.length; i++) {
    const r = values[i] || [];
    const title = getCol(r, "과목명");
    const phone = getCol(r, "연락처(H.P)");

    if (!title || !titles.includes(title)) continue;
    if (getCol(r, "신청현황") !== "완료") continue;              // 미결제는 대상이 아니다
    if (getCol(r, "취소")) continue;                             // 취소한 분에게 보내면 안 된다
    if (getCol(r, "설문 링크 문자 발송")) continue;              // 이미 보냈다
    if (!getCol(r, "참여 방식").includes("실시간")) continue;     // VOD 는 아직 보지도 않았다
    if (!phone) continue;                                        // 보낼 수단이 없다

    rows.push({
      row: i + 1,
      recipient: {
        name: getCol(r, "멤버명"),
        phone,
        programTitle: title,
        trainingType: "live",
        sheetRow: i + 1,
      },
    });
  }
  return rows;
}

/** 과목별 설문 링크. 세션 번호만 실어 짧게 유지한다. */
export function surveyLink(sessionNo: string): string {
  return sessionNo ? `${SURVEY_BASE}?s=${sessionNo}` : SURVEY_BASE;
}

/** 같은 번호는 한 통으로 묶는다. 하루에 두 과목을 들은 분도 문자는 하나다. */
export function buildSurveyMessages(
  rows: PendingRow[],
  linkOf: (title: string) => string
): SmsMessage[] {
  const { groups } = groupByPhone(rows.map((r) => r.recipient));

  return groups.map(({ phone, list }) => {
    const name = list[0].name || "";
    const blocks = list.map((r) => [`▶ ${r.programTitle}`, linkOf(r.programTitle)].join("\n"));
    const text = [
      `[${BRAND}]`,
      `${name}님, 오늘 교육 수고 많으셨습니다.`,
      "",
      "대표님의 소중한 의견 청합니다. 1분만 나누어주세요!:)",
      "",
      blocks.join("\n\n"),
      "",
      "※ 남겨 주신 의견은 다음 트레이닝 준비에 반영됩니다.",
      `문의 : ${CONTACT_NAME} ${CONTACT_TEL}`,
    ].join("\n");

    return { to: phone, text, label: `${name}(설문)` };
  });
}

/** 1회 실행. 발송 후 `설문 링크 문자 발송` 열에 시각을 적어 중복을 막는다. */
export async function runSurvey(now = new Date()): Promise<{
  sent: number;
  titles: string[];
  reason?: string;
}> {
  const tag = "[설문]";
  const { due, tooLate } = await findDueSessions(now);

  for (const t of tooLate) {
    console.warn(`${tag} "${t.title}" 은 종료 후 ${LATE_LIMIT_MIN}분이 지나 보내지 않습니다(재시작 등).`);
  }
  if (due.length === 0) return { sent: 0, titles: [], reason: "no-session" };

  const titles = due.map((d) => d.title);
  const linkByTitle = new Map(due.map((d) => [d.title, surveyLink(d.sessionNo)]));

  const rows = await findAttendees(titles);
  if (rows.length === 0) {
    console.log(`${tag} 대상자가 없습니다 (과목: ${titles.join(", ")}).`);
    return { sent: 0, titles, reason: "no-recipients" };
  }

  const messages = buildSurveyMessages(rows, (title) => linkByTitle.get(title) || SURVEY_BASE);
  const longest = Math.max(...messages.map((m) => smsByteLength(m.text)));
  console.log(`${tag} 대상 ${rows.length}건 → 문자 ${messages.length}통 (최대 ${longest}바이트) — ${titles.join(", ")}`);

  if (!isSolapiConfigured()) {
    console.error(`${tag} 설정이 없어 ${messages.length}건을 보내지 못했습니다.`);
    return { sent: 0, titles, reason: "sms-not-configured" };
  }

  const result = await sendMessages(messages, `(설문 ${todayKst(now)})`);

  // 발송을 시도한 행은 전부 표시한다. 일부 실패했다고 전원에게 다시 보내면 중복이 더 나쁘다.
  const stamp = sendStamp();
  try {
    await googleSheetsService.writeApplicationCells(
      rows.map((r) => ({ range: cell(SHEET_NAME, r.row, "설문 링크 문자 발송"), values: [[stamp]] }))
    );
  } catch (error: any) {
    // 표시에 실패하면 다음 실행에서 중복 발송된다. 반드시 눈에 띄게 남긴다.
    console.error(
      `❌ ${tag} 발송 표시(설문 링크 문자 발송) 실패 — 다음 실행에서 중복 발송될 수 있습니다: ${error?.message || error}`
    );
  }

  return { sent: result.sent, titles };
}

let timer: NodeJS.Timeout | null = null;

/**
 * 1분마다 시각만 본다. 과목마다 종료 시각이 달라 고정 시각 크론으로는 못 잡는다.
 *
 *   SURVEY_ENABLED   off 로 두면 끈다
 *   SURVEY_DELAY_MIN 종료 후 몇 분 뒤에 보낼지 (기본 0 = 종료 정각)
 */
export function startSurveyScheduler() {
  if (timer) return;

  if ((process.env.SURVEY_ENABLED || "on").toLowerCase() === "off") {
    console.log("[설문] SURVEY_ENABLED=off — 스케줄러를 켜지 않습니다.");
    return;
  }

  const delayMin = Number(process.env.SURVEY_DELAY_MIN || 0);

  timer = setInterval(async () => {
    try {
      // 지연을 주려면 "지금"을 그만큼 앞당겨 판정한다. 종료 시각 계산은 한 곳에만 둔다.
      await runSurvey(new Date(Date.now() - delayMin * 60_000));
    } catch (error: any) {
      console.error("[설문] 실행 실패:", error?.message || error);
    }
  }, 60 * 1000);

  console.log(
    `[설문] 스케줄러 시작 — 과목 종료 시각${delayMin ? ` +${delayMin}분` : " 정각"}에 실시간 참여자에게 발송`
  );
}

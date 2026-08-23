/**
 * 트레이닝 리마인드 — 2회 발송.
 *
 *   1차 : 트레이닝 **전날 오후 3시**  -> 신청명단 `리마인드1차` 열에 발송 시각
 *   2차 : 트레이닝 **당일 오전 10시** -> 신청명단 `리마인드2차` 열에 발송 시각
 *
 * 결제 직후 안내는 주문 정보로 보내지만, 리마인드는 그때 주문이 이미 사라진 뒤다
 * (PendingOrder 는 메모리에 30분만 산다). 그래서 **신청명단 시트를 정본으로 읽는다**.
 *
 * 대상 = 결제완료 + 그 과목 날짜가 대상일(KST) + 취소 아님 + 아직 그 차수를 안 보낸 행.
 *
 * ⛔ 읽는 범위는 스키마가 정한다(`sheetRange`). 예전에 `A1:R1000` 으로 잘라 읽어
 *    취소 열이 항상 빈 값이 된 적이 있다 — 취소한 분에게 리마인드가 그대로 나간다.
 *
 * ⛔ 중복 발송을 막는 것이 핵심이다. 컨테이너가 재시작해도 다시 보내면 안 되므로
 *    보낸 뒤 해당 차수 열에 발송 시각을 적고, 값이 있는 행은 건너뛴다.
 *    (메모리 플래그만 두면 Railway 재배포 한 번에 전원 재발송된다)
 */

import { cell, get as getCol, sheetRange } from "./sheet-schema";
import type { ColumnName } from "./sheet-schema";
import { googleSheetsService } from "./google-sheets";
import { loadProgramMap, sendEnrollmentNotice } from "./enrollment-notify";
import type { SmsRecipient } from "./enrollment-notice";

const SHEET_NAME = "2026 LTT 신청명단";

/** 차수별 설정. 열 위치는 sheet-schema 가 유일한 출처다. */
export const STAGES = {
  1: { label: "1차", column: "리마인드1차" as ColumnName, dayOffset: 1, defaultHour: 15, when: "전날 오후 3시" },
  2: { label: "2차", column: "리마인드2차" as ColumnName, dayOffset: 0, defaultHour: 10, when: "당일 오전 10시" },
} as const;

export type Stage = keyof typeof STAGES;

/** KST 기준 날짜를 YYYY-MM-DD 로. 서버 타임존이 무엇이든 한국 기준으로 판정한다. */
export function todayKst(now = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
}

/** KST 기준으로 n일 뒤 날짜 */
function dateKst(now: Date, plusDays: number): string {
  return new Date(now.getTime() + plusDays * 86400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
}

/** 지금이 KST 몇 시 몇 분인지 */
function kstHourMinute(now = new Date()): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value || "0");
  return { hour: g("hour"), minute: g("minute") };
}

export interface PendingRow {
  row: number;
  recipient: SmsRecipient;
}

/** 지정한 차수의 대상자를 찾는다. */
export async function findAttendees(
  stage: Stage,
  now = new Date()
): Promise<{ targetDate: string; rows: PendingRow[]; titles: string[] }> {
  const cfg = STAGES[stage];
  const targetDate = dateKst(now, cfg.dayOffset);

  // 대상일에 진행되는 과목만 추린다. 날짜 판정은 캘린더와 같은 값(formattedDate)을 쓴다.
  const programs = (await googleSheetsService.getSecondarySheetPrograms()) as any[];
  const titles = programs
    .filter((p) => p.formattedDate &&
      new Date(p.formattedDate).toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" }) === targetDate)
    .map((p) => p.title);

  if (titles.length === 0) return { targetDate, rows: [], titles: [] };

  const values = await googleSheetsService.readApplicationRows(sheetRange(SHEET_NAME));
  const rows: PendingRow[] = [];

  // 1행은 헤더. 시트 행 번호는 1-based 이므로 index+1.
  for (let i = 1; i < values.length; i++) {
    const r = values[i] || [];
    const title = getCol(r, "과목명");
    const phone = getCol(r, "연락처(H.P)");
    const email = getCol(r, "이메일");

    if (!title || !titles.includes(title)) continue;
    if (getCol(r, "신청현황") !== "완료") continue;   // 미결제는 대상이 아니다
    if (getCol(r, "취소")) continue;                  // 취소한 분에게 보내면 안 된다
    if (getCol(r, cfg.column)) continue;              // 이 차수는 이미 보냈다
    if (!phone && !email) continue;                   // 보낼 수단이 없다

    rows.push({
      row: i + 1,
      recipient: {
        name: getCol(r, "멤버명"),
        phone,
        email,
        programTitle: title,
        orderId: getCol(r, "주문번호"),
        // 시트에는 '실시간 참여' / '녹화본 시청(VOD)' 로 적힌다.
        trainingType: getCol(r, "참여 방식").includes("실시간") ? "live" : "recorded",
      },
    });
  }

  return { targetDate, rows, titles };
}

/** 한 차수 1회 실행. 발송 후 해당 차수 열에 시각을 적어 중복을 막는다. */
export async function runReminder(
  stage: Stage,
  now = new Date()
): Promise<{ stage: Stage; targetDate: string; sent: number; reason?: string }> {
  const cfg = STAGES[stage];
  const tag = `[리마인드${cfg.label}]`;
  const { targetDate, rows, titles } = await findAttendees(stage, now);

  if (titles.length === 0) {
    console.log(`${tag} ${targetDate} 진행되는 과목이 없습니다.`);
    return { stage, targetDate, sent: 0, reason: "no-session" };
  }
  if (rows.length === 0) {
    console.log(`${tag} ${targetDate} 대상자가 없습니다 (과목: ${titles.join(", ")}).`);
    return { stage, targetDate, sent: 0, reason: "no-recipients" };
  }

  console.log(`${tag} ${targetDate} 대상 ${rows.length}건 — ${titles.join(", ")}`);

  const programMap = await loadProgramMap();
  const result = await sendEnrollmentNotice(
    {
      recipients: rows.map((r) => r.recipient),
      kind: "reminder",
      context: `(리마인드${cfg.label} ${targetDate})`,
    },
    programMap
  );

  // 발송을 시도한 행은 전부 표시한다. 일부 실패했다고 전원에게 다시 보내면 중복이 더 나쁘다.
  const stamp = new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
  try {
    await googleSheetsService.writeApplicationCells(
      rows.map((r) => ({ range: cell(SHEET_NAME, r.row, cfg.column), values: [[stamp]] }))
    );
  } catch (error: any) {
    // 표시에 실패하면 다음 실행에서 중복 발송된다. 반드시 눈에 띄게 남긴다.
    console.error(
      `❌ ${tag} 발송 표시(${cfg.column}) 실패 — 다음 실행에서 중복 발송될 수 있습니다: ${error?.message || error}`
    );
  }

  return { stage, targetDate, sent: (result as any)?.sms?.sent ?? 0 };
}

let timer: NodeJS.Timeout | null = null;
const lastRun: Record<Stage, string> = { 1: "", 2: "" };

/**
 * 1분마다 시각만 본다. 크론 라이브러리를 두지 않는 이유는 컨테이너가 항상 떠 있는
 * 구조라 이걸로 충분하고, 재시작 시각이 발송 시각을 지나쳐도 그날 안에 다시 잡히기 때문이다.
 *
 *   REMINDER_ENABLED     off 로 두면 두 차수 모두 끈다
 *   REMINDER1_HOUR_KST   1차 시각, 기본 15 (전날 오후 3시)
 *   REMINDER_HOUR_KST    2차 시각, 기본 10 (당일 오전 10시)
 */
export function startReminderScheduler() {
  if (timer) return;

  if ((process.env.REMINDER_ENABLED || "on").toLowerCase() === "off") {
    console.log("[리마인드] REMINDER_ENABLED=off — 스케줄러를 켜지 않습니다.");
    return;
  }

  const hours: Record<Stage, number> = {
    1: Number(process.env.REMINDER1_HOUR_KST || STAGES[1].defaultHour),
    2: Number(process.env.REMINDER_HOUR_KST || STAGES[2].defaultHour),
  };

  timer = setInterval(async () => {
    const { hour, minute } = kstHourMinute();
    const today = todayKst();
    if (minute > 5) return;                     // 정각~정각+5분 사이 한 번
    for (const stage of [1, 2] as Stage[]) {
      if (hour !== hours[stage]) continue;
      if (lastRun[stage] === today) continue;
      lastRun[stage] = today;
      try {
        await runReminder(stage);
      } catch (error: any) {
        console.error(`[리마인드${STAGES[stage].label}] 실행 실패:`, error?.message || error);
      }
    }
  }, 60 * 1000);

  console.log(
    `[리마인드] 스케줄러 시작 — 1차 KST ${hours[1]}시(${STAGES[1].when}) · 2차 KST ${hours[2]}시(${STAGES[2].when})`
  );
}

/**
 * 트레이닝 당일 오전 10시 리마인드.
 *
 * 결제 직후 안내는 주문 정보로 보내지만, 리마인드는 그때 주문이 이미 사라진 뒤다
 * (PendingOrder 는 메모리에 30분만 산다). 그래서 **신청명단 시트를 정본으로 읽는다**.
 *
 * 대상 = 결제완료(J열='완료') + 그 과목의 날짜가 오늘(KST)인 행.
 *
 * ⛔ 읽는 범위는 **A:R** 이어야 한다. Q 까지만 읽으면 R열(취소)이 항상 빈 값이 되어
 *    취소한 사람에게 "오늘 교육이 진행됩니다" 가 그대로 나간다.
 *
 * ⛔ 중복 발송을 막는 것이 핵심이다. 컨테이너가 재시작해도 다시 보내면 안 되므로
 *    보낸 뒤 신청명단 **Q열**에 발송 시각을 적고, 값이 있는 행은 건너뛴다.
 *    (메모리 플래그만 두면 Railway 재배포 한 번에 전원 재발송된다)
 */

import { googleSheetsService } from "./google-sheets";
import { loadProgramMap, sendEnrollmentNotice } from "./enrollment-notify";
import type { SmsRecipient } from "./enrollment-notice";

/** 신청명단 시트에서 리마인드 발송 시각을 적는 열. A=1 기준 17번째. */
const REMINDER_COL = "Q";
const SHEET_NAME = "2026 LTT 신청명단";

/** 오늘 날짜(KST)를 YYYY-MM-DD 로. 서버 타임존이 무엇이든 한국 기준으로 판정한다. */
export function todayKst(now = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
}

/** 지금이 KST 몇 시 몇 분인지 */
function kstHourMinute(now = new Date()): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value || "0");
  return { hour: get("hour"), minute: get("minute") };
}

interface PendingRow {
  row: number;
  recipient: SmsRecipient;
}

/**
 * 오늘 교육이 있는 결제완료 신청자를 찾는다.
 * 시트를 그대로 읽어 판정하므로 수기로 넣은 행도 포함된다.
 */
export async function findTodaysAttendees(now = new Date()): Promise<{
  today: string;
  rows: PendingRow[];
  titlesToday: string[];
}> {
  const today = todayKst(now);
  const programMap = await loadProgramMap();

  // 오늘 진행되는 과목만 추린다. 날짜 판정은 캘린더와 같은 값(formattedDate)을 쓴다.
  const programs = (await googleSheetsService.getSecondarySheetPrograms()) as any[];
  const titlesToday = programs
    .filter((p) => {
      if (!p.formattedDate) return false;
      return new Date(p.formattedDate).toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" }) === today;
    })
    .map((p) => p.title);

  if (titlesToday.length === 0) {
    return { today, rows: [], titlesToday: [] };
  }

  const values = await googleSheetsService.readApplicationRows(`'${SHEET_NAME}'!A1:R1000`);
  const rows: PendingRow[] = [];

  // 1행은 헤더. 시트 행 번호는 1-based 이므로 index+1.
  for (let i = 1; i < values.length; i++) {
    const r = values[i] || [];
    const title = String(r[1] || "").trim();      // B: 과목명
    const name = String(r[4] || "").trim();       // E: 멤버명
    const phone = String(r[5] || "").trim();      // F: 연락처
    const email = String(r[6] || "").trim();      // G: 이메일
    const participation = String(r[7] || "").trim(); // H: 참여 방식
    const paid = String(r[9] || "").trim();       // J: 결제완료
    const orderId = String(r[12] || "").trim();   // M: 주문번호
    const remindedAt = String(r[16] || "").trim(); // Q: 리마인드 발송
    const cancelledAt = String(r[17] || "").trim(); // R: 취소

    if (!title || !titlesToday.includes(title)) continue;
    if (paid !== "완료") continue;      // 미결제는 대상이 아니다
    if (cancelledAt) continue;          // 취소한 사람에게 "오늘 교육이 진행됩니다" 를 보내면 안 된다
    if (remindedAt) continue;           // 이미 보냈다
    if (!phone && !email) continue;     // 보낼 수단이 없다

    rows.push({
      row: i + 1,
      recipient: {
        name,
        phone,
        email,
        programTitle: title,
        orderId,
        // 시트 H열은 '실시간 참여' / '녹화본 시청(VOD)' 로 적힌다.
        trainingType: participation.includes("실시간") ? "live" : "recorded",
      },
    });
  }

  return { today, rows, titlesToday };
}

/** 당일 리마인드 1회 실행. 발송 후 Q열에 시각을 적어 중복을 막는다. */
export async function runReminder(now = new Date()): Promise<{ today: string; sent: number; reason?: string }> {
  const { today, rows, titlesToday } = await findTodaysAttendees(now);

  if (titlesToday.length === 0) {
    console.log(`[리마인드] ${today} 오늘 진행되는 과목이 없습니다.`);
    return { today, sent: 0, reason: "no-session-today" };
  }
  if (rows.length === 0) {
    console.log(`[리마인드] ${today} 대상자가 없습니다 (과목: ${titlesToday.join(", ")}).`);
    return { today, sent: 0, reason: "no-recipients" };
  }

  console.log(`[리마인드] ${today} 대상 ${rows.length}건 — ${titlesToday.join(", ")}`);

  const programMap = await loadProgramMap();
  const result = await sendEnrollmentNotice(
    {
      recipients: rows.map((r) => r.recipient),
      kind: "reminder",
      context: `(당일 리마인드 ${today})`,
    },
    programMap
  );

  // 발송을 시도한 행은 전부 표시한다. 일부 실패했다고 전원에게 다시 보내면 중복이 더 나쁘다.
  const stamp = new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
  try {
    await googleSheetsService.writeApplicationCells(
      rows.map((r) => ({ range: `'${SHEET_NAME}'!${REMINDER_COL}${r.row}`, values: [[stamp]] }))
    );
  } catch (error: any) {
    // 표시에 실패하면 다음 실행에서 중복 발송된다. 반드시 눈에 띄게 남긴다.
    console.error(
      `❌ [리마인드] 발송 표시(Q열) 실패 — 다음 실행에서 중복 발송될 수 있습니다: ${error?.message || error}`
    );
  }

  const sent = (result as any)?.sms?.sent ?? 0;
  return { today, sent };
}

let timer: NodeJS.Timeout | null = null;
let lastRunDate = "";

/**
 * 매일 오전 10시(KST)에 한 번 돌린다.
 * 크론 라이브러리를 두지 않고 1분마다 시각만 본다 — 컨테이너가 항상 떠 있는 구조라 이걸로 충분하고,
 * 재시작 시각이 10시를 지나쳐도 그날 안에 다시 잡힌다.
 */
export function startReminderScheduler() {
  if (timer) return;

  const HOUR = Number(process.env.REMINDER_HOUR_KST || "10");
  const enabled = (process.env.REMINDER_ENABLED || "on").toLowerCase() !== "off";
  if (!enabled) {
    console.log("[리마인드] REMINDER_ENABLED=off — 스케줄러를 켜지 않습니다.");
    return;
  }

  timer = setInterval(async () => {
    const { hour, minute } = kstHourMinute();
    const today = todayKst();
    if (hour !== HOUR || minute > 5) return;   // 10:00~10:05 사이 한 번
    if (lastRunDate === today) return;
    lastRunDate = today;
    try {
      await runReminder();
    } catch (error: any) {
      console.error("[리마인드] 실행 실패:", error?.message || error);
    }
  }, 60 * 1000);

  console.log(`[리마인드] 스케줄러 시작 — 매일 KST ${HOUR}시`);
}

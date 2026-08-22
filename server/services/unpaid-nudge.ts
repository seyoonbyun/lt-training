/**
 * 미결제 재결제 안내 자동 발송.
 *
 * 신청 행은 결제 **전에** 쓰이므로 결제창에서 이탈하면 미결제 행이 남는다. 예전에는
 * 아무 안내도 나가지 않아 그대로 방치됐다 — 2026-08-22 오픈 당일 57건이 그렇게 쌓였고,
 * 유저 컴플레인이 오기 전까지 아무도 몰랐다.
 *
 * 매일 정해진 시각에 미결제 묶음을 찾아 「결제 이어하기」 링크를 한 번 보낸다.
 *
 * ⛔ 중복 발송을 막는 것이 핵심이다. 컨테이너가 재시작해도 다시 보내면 안 되므로
 *    보낸 뒤 신청명단 **V열**에 발송 시각을 적고, 값이 있는 묶음은 건너뛴다
 *    (메모리 플래그만 두면 Railway 재배포 한 번에 전원 재발송된다 — 리마인드와 같은 함정).
 *
 * ⛔ 접수 직후에는 보내지 않는다. 지금 결제창을 띄워 둔 사람에게 "결제가 안 됐다" 가
 *    날아가면 안 된다. 기본 2시간이 지난 묶음만 대상으로 한다.
 *
 * 환경변수
 *   UNPAID_NUDGE_ENABLED   off 면 끈다 (기본 on)
 *   UNPAID_NUDGE_HOUR_KST  발송 시각, 기본 11 (KST)
 *                          ⛔ 10시는 당일 리마인드(REMINDER_HOUR_KST)가 쓴다. 겹치면
 *                             같은 시각에 두 작업이 시트를 두고 경합한다.
 *   UNPAID_NUDGE_MIN_HOURS 접수 후 최소 경과 시간, 기본 2
 */
import { sendMessages } from "./solapi";
import {
  findUnpaidGroups,
  summarizeGroup,
  buildResumeLink,
  composeResumeSms,
  stampNudged,
  buildAdminCopies,
} from "./resume-notice";

let timer: NodeJS.Timeout | null = null;
let lastRunDate = "";

function todayKst(now = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
}

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

export interface NudgeResult {
  groups: number;
  targeted: number;
  sent: number;
  skipped: string[];
}

export async function runUnpaidNudge(now = new Date()): Promise<NudgeResult> {
  const minHours = Number(process.env.UNPAID_NUDGE_MIN_HOURS || "2");
  const groups = await findUnpaidGroups();
  const result: NudgeResult = { groups: groups.length, targeted: 0, sent: 0, skipped: [] };

  const messages: Array<{ to: string; text: string; label: string }> = [];
  const stamps: number[][] = [];

  for (const g of groups) {
    const who = `${g.payerName}(${g.chapter})`;

    if (g.alreadyNotified) { result.skipped.push(`${who}: 이미 안내함`); continue; }
    if (!g.payerPhone) { result.skipped.push(`${who}: 연락처 없음`); continue; }
    if (!Number.isFinite(g.submittedAtMs)) { result.skipped.push(`${who}: 접수 시각을 읽을 수 없음`); continue; }

    const hours = (now.getTime() - g.submittedAtMs) / 3600000;
    if (hours < minHours) { result.skipped.push(`${who}: 접수 ${hours.toFixed(1)}시간 — 아직 결제 중일 수 있음`); continue; }

    const summary = await summarizeGroup(g);
    if (summary.quantity === 0) { result.skipped.push(`${who}: 결제할 건이 없음(마감·결제완료)`); continue; }

    result.targeted += 1;
    const link = buildResumeLink(g.rows);
    messages.push({
      to: g.payerPhone,
      text: composeResumeSms(g, summary, link),
      label: `${who} ${summary.quantity}건`,
    });
    stamps.push(g.rows);
  }

  if (messages.length === 0) {
    console.log(`[재결제안내] 대상 없음 (묶음 ${groups.length}건). ${result.skipped.join(" / ")}`);
    return result;
  }

  // 검수용 사본은 실제 발송과 **같은 요청**에 실어 보낸다. 따로 보내면 한쪽만 나갈 수 있다.
  const copies = buildAdminCopies(messages);
  const sms = await sendMessages([...messages, ...copies], "[재결제안내]");
  // 사본은 발송 건수에서 뺀다 — 실제 대상에게 몇 통 갔는지가 중요하다.
  result.sent = Math.max(0, sms.sent - copies.length);

  // 발송을 시도한 묶음만 기록한다. 기록에 실패해도 발송 자체는 끝났으므로 로그로 남긴다
  // (다음 실행에서 다시 보내질 수 있으니 반드시 눈에 띄어야 한다).
  for (let i = 0; i < stamps.length; i++) {
    try {
      await stampNudged(stamps[i], now);
    } catch (error: any) {
      console.error(
        `⚠ [재결제안내] 발송은 됐으나 V열 기록 실패 — 다음 실행에서 재발송될 수 있습니다:`,
        stamps[i].join(","),
        error?.message || error
      );
    }
  }

  console.log(
    `[재결제안내] 묶음 ${result.groups} / 대상 ${result.targeted} / 발송 ${result.sent}` +
      (result.skipped.length ? ` / 제외: ${result.skipped.join(" · ")}` : "")
  );
  return result;
}

export function startUnpaidNudgeScheduler() {
  if (timer) return;

  const enabled = (process.env.UNPAID_NUDGE_ENABLED || "on").toLowerCase() !== "off";
  if (!enabled) {
    console.log("[재결제안내] UNPAID_NUDGE_ENABLED=off — 스케줄러를 켜지 않습니다.");
    return;
  }
  const HOUR = Number(process.env.UNPAID_NUDGE_HOUR_KST || "11");

  timer = setInterval(async () => {
    const { hour, minute } = kstHourMinute();
    const today = todayKst();
    if (hour !== HOUR || minute > 5) return;  // 정시~+5분 사이 한 번
    if (lastRunDate === today) return;
    lastRunDate = today;
    try {
      await runUnpaidNudge();
    } catch (error: any) {
      console.error("[재결제안내] 실행 실패:", error?.message || error);
    }
  }, 60 * 1000);

  console.log(`[재결제안내] 스케줄러 시작 — 매일 KST ${HOUR}시`);
}

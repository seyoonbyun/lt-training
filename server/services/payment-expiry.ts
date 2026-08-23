/**
 * 오래된 미결제 정리 — 2차(마지막) 안내 후 '결제만료' 표시.
 *
 * 신청 행은 결제 **전에** 쓰이므로 결제창에서 이탈하면 미결제 행이 남는다.
 * 다음 날 1차 안내(unpaid-nudge)가 나가지만, 그래도 결제하지 않은 건은 계속 쌓인다.
 * 쌓이면 결제대기 숫자가 실제 사람 수와 어긋나고 **완료율이 지표 구실을 못 한다**
 * (2026-08-22 오픈 당일 완료율 37%가 대시보드에 떠 있었는데 아무도 못 알아봤다).
 *
 * N일(기본 3일)이 지난 묶음에 마지막 안내를 한 번 더 보내고, J열에 '결제만료'를 적는다.
 *
 * ⛔⭐ **만료는 잠금이 아니다.** '결제만료'는 집계에서 빼는 표시일 뿐이고,
 *    그 행은 여전히 결제 가능하다 — 2차 안내 문자의 링크로 결제하시면 '완료'가 된다.
 *    중복 판정(isPaidRow)·행 재사용·이어하기 어디에도 걸리지 않는다.
 *    돈을 안 낸 사람을 막는 규칙은 전부 치명적이다.
 *
 * ⛔ 문자를 못 보냈으면 만료시키지 않는다. 안내 없이 조용히 정리하면 안 된다.
 *    (연락처가 없어 애초에 보낼 수 없는 묶음만 예외로 조용히 정리한다.)
 *
 * 환경변수
 *   PAYMENT_EXPIRY_ENABLED      off 면 끈다 (기본 on)
 *   PAYMENT_EXPIRY_HOUR_KST     실행 시각, 기본 12 (KST)
 *                               ⛔ 10시=당일 리마인드, 11시=1차 재결제 안내가 쓴다. 겹치면
 *                                  같은 시트를 두고 두 작업이 경합한다.
 *   PAYMENT_EXPIRY_DAYS         접수 후 며칠 지나면 정리할지, 기본 3
 *   PAYMENT_EXPIRY_MAX_PER_RUN  한 번에 처리할 묶음 수, 기본 40
 *                               (솔라피 한도를 넘기면 뒷건이 조용히 안 나간다 — 2026-08-23)
 */
import { sendMessages } from "./solapi";
import { googleSheetsService } from "./google-sheets";
import {
  findUnpaidGroups,
  summarizeGroup,
  buildResumeLink,
  composeFinalNoticeSms,
  markExpired,
  buildAdminCopies,
  NUDGE_COL,
  type UnpaidGroup,
} from "./resume-notice";

const SHEET_NAME = "2026 LTT 신청명단";
/** 2차 안내까지 나갔다는 표시. V열에 남긴다 (시트에서 눈으로 구분하기 위한 기록). */
const FINAL_MARK = "2차발송완";

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

export interface ExpiryResult {
  groups: number;
  /** 기한이 지나 처리 대상이 된 묶음 */
  due: number;
  /** 2차 안내를 보낸 통수 (검수 사본 제외) */
  notified: number;
  /** 실제로 '결제만료'를 찍은 묶음 */
  expired: number;
  /** 한도에 걸려 이번 실행에서 미룬 묶음 */
  deferred: number;
  skipped: string[];
}

export async function runPaymentExpiry(now = new Date()): Promise<ExpiryResult> {
  const days = Number(process.env.PAYMENT_EXPIRY_DAYS || "3");
  const maxPerRun = Number(process.env.PAYMENT_EXPIRY_MAX_PER_RUN || "40");

  const groups = await findUnpaidGroups();
  const result: ExpiryResult = {
    groups: groups.length, due: 0, notified: 0, expired: 0, deferred: 0, skipped: [],
  };

  // 연락처가 없어 안내 자체가 불가능한 묶음은 문자 없이 정리한다.
  const silent: UnpaidGroup[] = [];
  const messages: Array<{ to: string; text: string; label: string }> = [];
  const toExpire: number[][] = [];

  for (const g of groups) {
    const who = `${g.payerName}(${g.chapter})`;

    if (!Number.isFinite(g.submittedAtMs)) {
      result.skipped.push(`${who}: 접수 시각을 읽을 수 없음`);
      continue;
    }
    const age = (now.getTime() - g.submittedAtMs) / 86400000;
    if (age < days) continue;   // 아직 기한 전 — 조용히 넘어간다 (매일 로그를 채우지 않는다)

    result.due += 1;

    if (result.due > maxPerRun) {
      result.deferred += 1;
      continue;   // 한도 초과분은 다음 실행으로 미룬다. 아래에서 반드시 로그로 알린다.
    }

    const summary = await summarizeGroup(g);
    if (summary.quantity === 0) {
      // 마감·결제완료로 결제할 게 없다. 안내할 내용이 없으니 표시만 남긴다.
      silent.push(g);
      result.skipped.push(`${who}: 결제할 건이 없어 안내 없이 정리`);
      continue;
    }
    if (!g.payerPhone) {
      silent.push(g);
      result.skipped.push(`${who}: 연락처 없음 — 안내 없이 정리`);
      continue;
    }

    messages.push({
      to: g.payerPhone,
      text: composeFinalNoticeSms(g, summary, buildResumeLink(g.rows), now),
      label: `${who} ${summary.quantity}건 (${age.toFixed(0)}일 경과)`,
    });
    toExpire.push(g.rows);
  }

  // ── 안내 발송 ──────────────────────────────────────────────────────────
  if (messages.length > 0) {
    const copies = buildAdminCopies(messages);
    const sms = await sendMessages([...messages, ...copies], "[결제만료안내]");
    result.notified = Math.max(0, sms.sent - copies.length);

    // ⛔ 발송이 통째로 실패했으면 만료시키지 않는다. 안내 없이 정리되는 일은 없어야 한다.
    if (result.notified === 0 && !sms.dryRun) {
      console.error(
        `⚠ [결제만료] 2차 안내가 한 통도 나가지 않아 만료 처리를 보류합니다 (대상 ${messages.length}묶음).`,
        sms.reason || ""
      );
      toExpire.length = 0;
    }
  }

  // ── 만료 표시 ──────────────────────────────────────────────────────────
  const stampTargets = [...toExpire, ...silent.map((g) => g.rows)];
  for (const rows of stampTargets) {
    try {
      await markExpired(rows);
      await stampFinalNotice(rows);
      result.expired += 1;
    } catch (error: any) {
      console.error(
        `⚠ [결제만료] 안내는 나갔으나 표시 실패 — 다음 실행에서 또 안내될 수 있습니다:`,
        rows.join(","),
        error?.message || error
      );
    }
  }

  const lines = [
    `[결제만료] 묶음 ${result.groups} / ${days}일 경과 ${result.due} / 안내 ${result.notified} / 만료 ${result.expired}`,
  ];
  // 잘린 건 반드시 눈에 띄게 남긴다. 조용한 상한은 "다 처리했다"로 읽힌다.
  if (result.deferred > 0) lines.push(`⚠ 한도(${maxPerRun})를 넘어 ${result.deferred}묶음은 다음 실행으로 미룸`);
  if (result.skipped.length) lines.push(`제외: ${result.skipped.join(" · ")}`);
  console.log(lines.join("\n"));

  return result;
}

/** V열에 2차 안내까지 나갔다는 표시를 남긴다. 판정은 J열이 하고, 이건 사람이 보는 기록이다. */
async function stampFinalNotice(rows: number[]): Promise<void> {
  await googleSheetsService.writeApplicationCells(
    rows.map((row) => ({
      range: `'${SHEET_NAME}'!${NUDGE_COL}${row}`,
      values: [[FINAL_MARK]],
    }))
  );
}

export function startPaymentExpiryScheduler() {
  if (timer) return;

  const enabled = (process.env.PAYMENT_EXPIRY_ENABLED || "on").toLowerCase() !== "off";
  if (!enabled) {
    console.log("[결제만료] PAYMENT_EXPIRY_ENABLED=off — 스케줄러를 켜지 않습니다.");
    return;
  }
  const HOUR = Number(process.env.PAYMENT_EXPIRY_HOUR_KST || "12");

  timer = setInterval(async () => {
    const { hour, minute } = kstHourMinute();
    const today = todayKst();
    if (hour !== HOUR || minute > 5) return;   // 정시~+5분 사이 한 번
    if (lastRunDate === today) return;
    lastRunDate = today;
    try {
      await runPaymentExpiry();
    } catch (error: any) {
      console.error("[결제만료] 실행 실패:", error?.message || error);
    }
  }, 60 * 1000);

  console.log(
    `[결제만료] 스케줄러 시작 — 매일 KST ${HOUR}시 / ${process.env.PAYMENT_EXPIRY_DAYS || "3"}일 경과분`
  );
}

/**
 * 미결제 후속 처리 — 2차 안내(12시간 뒤) → 결제거부 표기(다시 12시간 뒤).
 *
 * 신청 행은 결제 **전에** 쓰이므로 결제창에서 이탈하면 미결제 행이 남는다.
 * 다음 날 11시에 1차 안내(unpaid-nudge)가 나가고, 그 뒤로는 이 파일이 맡는다.
 *
 *   1차 안내 발송        -> `재결제 안내` 열에 시각
 *        +12시간          -> 2차 안내 발송 -> `미결제 안내 문자 발송` 열에 시각
 *        +12시간          -> 그래도 미결제면 `신청현황` = **결제거부**
 *
 * ⛔⭐ **결제거부는 잠금이 아니다.** 집계에서 빼는 표시일 뿐이고 그 행은 여전히 결제 가능하다.
 *    이미 받은 링크로 결제하시면 그대로 '완료' 가 되고 주문번호·결제키·승인일시가 채워진다.
 *    (`isRowPayable = !취소 && !완료` — 결제거부는 어느 쪽도 아니다.)
 *    돈 내려는 분을 막는 규칙은 만들지 않는다. 2026-08-22 에 57명이 그렇게 잠겼다.
 *
 * ⛔ 문자를 못 보냈으면 결제거부로 찍지 않는다. 안내 없이 조용히 정리되는 일은 없어야 한다.
 *    (연락처가 없거나 결제할 건이 없어 애초에 보낼 수 없는 묶음만 예외로 조용히 표시)
 *
 * ⛔ 1차 안내 시각을 못 읽는 묶음은 **건드리지 않는다.** 예전에는 발송 표시로 시각이 아니라
 *    "문자발송완" 이라는 글자만 적었다. 그런 묶음은 언제 보냈는지 알 수 없으므로 추측해서
 *    2차를 보내면 안 된다 — 실제 고객에게 나가는 문자다. 로그로 남기고 사람이 판단한다.
 *
 * 환경변수
 *   PAYMENT_EXPIRY_ENABLED       off 로 끈다 (기본 on - 2026-08-23 승인)
 *   PAYMENT_EXPIRY_GAP_HOURS     각 단계 간격, 기본 12 (시간)
 *   PAYMENT_EXPIRY_MAX_PER_RUN   한 번에 처리할 묶음 수, 기본 40
 *                                (솔라피 한도를 넘기면 뒷건이 조용히 안 나간다 - 2026-08-23)
 *   PAYMENT_EXPIRY_INTERVAL_MIN  점검 주기, 기본 60 (분)
 *                                ⛔ 10시=리마인드2차, 11시=1차 재결제 안내, 15시=리마인드1차가
 *                                   같은 시트를 쓴다. 시각 고정이 아니라 주기 점검이라 겹쳐도
 *                                   각자 자기 열만 본다.
 */
import { sendMessages } from "./solapi";
import { alertAdmin } from "./admin-alert";
import {
  findUnpaidGroups,
  summarizeGroup,
  buildResumeLink,
  composeFinalNoticeSms,
  markExpired,
  stampFinalNotice,
  buildAdminCopies,
  type UnpaidGroup,
} from "./resume-notice";

let timer: NodeJS.Timeout | null = null;

const HOUR_MS = 3600_000;

export interface FollowupResult {
  groups: number;
  /** 2차 안내를 보낸 통수 (검수 사본 제외) */
  notified: number;
  /** 결제거부로 표시한 묶음 */
  marked: number;
  /** 한도에 걸려 이번 실행에서 미룬 묶음 */
  deferred: number;
  /** 1차 안내 시각을 못 읽어 손대지 않은 묶음 */
  unknownStamp: number;
  skipped: string[];
}

export async function runPaymentExpiry(now = new Date()): Promise<FollowupResult> {
  const gapMs = Number(process.env.PAYMENT_EXPIRY_GAP_HOURS || "12") * HOUR_MS;
  const maxPerRun = Number(process.env.PAYMENT_EXPIRY_MAX_PER_RUN || "40");

  const groups = await findUnpaidGroups();
  const r: FollowupResult = {
    groups: groups.length, notified: 0, marked: 0, deferred: 0, unknownStamp: 0, skipped: [],
  };

  const messages: Array<{ to: string; text: string; label: string }> = [];
  const toStampFinal: number[][] = [];   // 2차 안내를 보낸 묶음
  const toMark: number[][] = [];         // 결제거부로 찍을 묶음
  const silent: UnpaidGroup[] = [];      // 보낼 수단이 없어 조용히 표시할 묶음
  let due = 0;

  for (const g of groups) {
    const who = `${g.payerName}(${g.chapter})`;

    // ── 3단계: 2차 안내 뒤 12시간 지났으면 결제거부
    if (Number.isFinite(g.finalNoticeAtMs)) {
      if (now.getTime() - g.finalNoticeAtMs >= gapMs) toMark.push(g.rows);
      continue;   // 2차까지 나간 묶음은 더 보내지 않는다
    }

    // ── 2단계: 1차 안내 뒤 12시간 지났으면 2차 발송
    if (!g.alreadyNotified) continue;             // 1차가 아직 안 나갔다 — unpaid-nudge 담당
    if (!Number.isFinite(g.nudgedAtMs)) {
      // 시각을 모르는 묶음. 추측해서 실제 고객에게 문자를 보내지 않는다.
      r.unknownStamp += 1;
      r.skipped.push(`${who}: 1차 안내 시각을 읽을 수 없어 제외`);
      continue;
    }
    if (now.getTime() - g.nudgedAtMs < gapMs) continue;   // 아직 12시간 전

    due += 1;
    if (due > maxPerRun) { r.deferred += 1; continue; }

    const summary = await summarizeGroup(g);
    if (summary.quantity === 0) {
      silent.push(g);
      r.skipped.push(`${who}: 결제할 건이 없어 안내 없이 표시`);
      continue;
    }
    if (!g.payerPhone) {
      silent.push(g);
      r.skipped.push(`${who}: 연락처 없음 — 안내 없이 표시`);
      continue;
    }

    messages.push({
      to: g.payerPhone,
      text: composeFinalNoticeSms(g, summary, buildResumeLink(g.rows), now),
      label: `${who} ${summary.quantity}건`,
    });
    toStampFinal.push(g.rows);
  }

  // ── 2차 안내 발송 ────────────────────────────────────────────────────
  if (messages.length > 0) {
    const copies = buildAdminCopies(messages);
    const sms = await sendMessages([...messages, ...copies], "[미결제 2차안내]");
    r.notified = Math.max(0, sms.sent - copies.length);

    // ⛔ 한 통도 못 나갔으면 발송 표시를 남기지 않는다. 표시만 남으면 12시간 뒤
    //   안내를 못 받은 분이 결제거부로 찍힌다.
    if (r.notified === 0 && !sms.dryRun) {
      console.error(`⚠ [미결제] 2차 안내가 한 통도 나가지 않아 표시를 보류합니다 (대상 ${messages.length}묶음).`, sms.reason || "");
      void alertAdmin("미결제 2차 안내 발송 실패", `대상 ${messages.length}묶음에 한 통도 나가지 않았습니다.\n${sms.reason || ""}`);
      toStampFinal.length = 0;
    }
  }

  for (const rows of toStampFinal) {
    try { await stampFinalNotice(rows, now); } catch (error: any) {
      console.error(`⚠ [미결제] 2차 안내는 나갔으나 발송 표시 실패 — 다음 실행에서 또 나갈 수 있습니다:`, rows.join(","), error?.message || error);
    }
  }

  // ── 결제거부 표시 ────────────────────────────────────────────────────────
  for (const rows of [...toMark, ...silent.map((g) => g.rows)]) {
    try { await markExpired(rows); r.marked += 1; } catch (error: any) {
      console.error(`⚠ [미결제] 결제거부 표시 실패:`, rows.join(","), error?.message || error);
    }
  }

  const lines = [`[미결제] 묶음 ${r.groups} / 2차안내 ${r.notified} / 결제거부 ${r.marked}`];
  if (r.deferred > 0) lines.push(`⚠ 한도(${maxPerRun})를 넘어 ${r.deferred}묶음은 다음 실행으로 미룸`);
  if (r.unknownStamp > 0) lines.push(`⚠ 1차 안내 시각을 모르는 ${r.unknownStamp}묶음은 손대지 않음 (사람이 판단할 것)`);
  if (r.skipped.length) lines.push(`제외: ${r.skipped.join(" · ")}`);
  console.log(lines.join("\n"));

  return r;
}

/**
 * 주기 점검. 시각 고정이 아니라 "발송 후 N시간"이 기준이라 자주 보고 조건이 찬 것만 처리한다.
 */
export function startPaymentExpiryScheduler() {
  if (timer) return;

  const enabled = (process.env.PAYMENT_EXPIRY_ENABLED || "on").toLowerCase() !== "off";
  if (!enabled) {
    console.log("[미결제] PAYMENT_EXPIRY_ENABLED=off — 스케줄러를 켜지 않습니다.");
    return;
  }

  const everyMin = Math.max(10, Number(process.env.PAYMENT_EXPIRY_INTERVAL_MIN || "60"));
  const gap = Number(process.env.PAYMENT_EXPIRY_GAP_HOURS || "12");

  timer = setInterval(async () => {
    try {
      await runPaymentExpiry();
    } catch (error: any) {
      console.error("[미결제] 실행 실패:", error?.message || error);
    }
  }, everyMin * 60 * 1000);

  console.log(`[미결제] 스케줄러 시작 — ${everyMin}분마다 점검 · 단계 간격 ${gap}시간 (1차안내 → 2차안내 → 결제거부)`);
}

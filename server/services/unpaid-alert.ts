/**
 * 결제대기 급증 알림.
 *
 * 2026-08-22 오픈 당일, 완료율 37%가 대시보드에 그대로 떠 있었는데 아무도 보지 않았다.
 * 유저 컴플레인이 들어오고 나서야 결제대기 57건을 알았다.
 * **숫자가 화면에 있는 것과 누가 아는 것은 다르다** — 임계를 넘으면 관리자에게 문자를 보낸다.
 *
 * 판정 기준 두 가지 (둘 중 하나만 걸려도 알린다)
 *   1) 결제대기 건수가 임계 이상
 *   2) 표본이 충분한데 완료율이 바닥 아래
 *
 * ⛔ 취소(R열)·만료(J열 '결제만료') 행은 세지 않는다. 정리된 건까지 세면 알림이
 *    영원히 울린 채로 남아 아무도 안 보게 된다 — 그게 원래 문제였다.
 *
 * ⛔ 같은 상황으로 반복해 울리지 않는다. 한 번 보내면 쿨다운 동안 조용하다.
 *    (스케줄러 상태는 메모리에 있다. 재배포하면 쿨다운이 풀려 한 번 더 갈 수 있는데,
 *     빠뜨리는 것보다 한 통 더 가는 쪽이 낫다.)
 *
 * 환경변수
 *   UNPAID_ALERT_ENABLED      off 면 끈다 (기본 on)
 *   UNPAID_ALERT_TO           받는 번호 (기본 01028033021)
 *   UNPAID_ALERT_PENDING      결제대기 임계 건수, 기본 10
 *   UNPAID_ALERT_RATE_FLOOR   완료율 하한 (0~1), 기본 0.6
 *   UNPAID_ALERT_MIN_SAMPLE   완료율을 볼 최소 신청 건수, 기본 10
 *   UNPAID_ALERT_MIN_HOURS    접수 후 이 시간이 지난 미결제만 센다, 기본 2
 *                             (없으면 UNPAID_NUDGE_MIN_HOURS 를 따른다)
 *   UNPAID_ALERT_COOLDOWN_H   같은 알림을 다시 보내기까지 시간, 기본 6
 *   UNPAID_ALERT_INTERVAL_MIN 점검 주기(분), 기본 60
 */
import { sendMessages } from "./solapi";
import { googleSheetsService, EXPIRED_MARK } from "./google-sheets";
import { findUnpaidGroups, parseSubmittedAt } from "./resume-notice";

const SHEET_NAME = "2026 LTT 신청명단";
const SITE = process.env.PUBLIC_SITE_URL || "https://ltt-bnikorea.com";
const DEFAULT_ALERT_TO = "01028033021";

let timer: NodeJS.Timeout | null = null;
let lastAlertAt = 0;

export interface UnpaidSnapshot {
  /** 판정 대상 건수 (결제완료 + 접수 후 유예를 넘긴 미결제). 취소·만료·결제 진행 중은 뺀다 */
  total: number;
  paid: number;
  /** 유예 시간을 넘긴 미결제 = 진짜 밀린 건 */
  pending: number;
  /** 그 미결제를 낸 결제자 수 (단체 신청 한 건이 수십 행이 된다) */
  payers: number;
  /** 아직 유예 안 — 지금 결제창을 띄워 두고 계실 수 있는 건 */
  inFlight: number;
  /** 완료율 0~1. total 이 0이면 1로 본다 (신청이 없으면 문제도 없다). */
  rate: number;
  cancelled: number;
  expired: number;
}

/**
 * 신청명단을 읽어 현재 상태를 센다.
 *
 * ⛔ **접수 직후의 미결제는 세지 않는다.** 지금 결제창을 띄워 두신 분까지 세면
 *    평상시에도 임계를 넘어 알림이 상시로 울리고, 그러면 아무도 안 본다 —
 *    그게 애초에 고치려던 문제다(대시보드에 37%가 떠 있어도 아무도 안 봤다).
 *    1차 재결제 안내(unpaid-nudge)가 쓰는 유예와 같은 기준을 쓴다.
 *
 * ⛔ 취소(R열)·만료(J열)는 분모에서도 뺀다. 정리된 건이 완료율을 계속 끌어내리면
 *    완료율이 지표 구실을 못 한다.
 */
export async function snapshotUnpaid(now = new Date()): Promise<UnpaidSnapshot> {
  const minHours = Number(process.env.UNPAID_ALERT_MIN_HOURS || process.env.UNPAID_NUDGE_MIN_HOURS || "2");
  const rows = await googleSheetsService.readApplicationRows(`'${SHEET_NAME}'!A:R`);
  const snap: UnpaidSnapshot = {
    total: 0, paid: 0, pending: 0, payers: 0, inFlight: 0, rate: 1, cancelled: 0, expired: 0,
  };

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length < 5) continue;

    if (String(row[17] || "").trim()) { snap.cancelled += 1; continue; }

    const status = String(row[9] || "").trim();
    if (status === EXPIRED_MARK) { snap.expired += 1; continue; }

    if (status === "완료" || status === "결제완료") {
      snap.total += 1;
      snap.paid += 1;
      continue;
    }

    // 미결제 — 접수 후 유예를 넘긴 것만 "밀린 건"으로 센다.
    const at = parseSubmittedAt(String(row[0] || ""));
    const hours = (now.getTime() - at) / 3600000;
    // 접수 시각을 못 읽으면 밀린 것으로 본다. 놓치는 쪽보다 알리는 쪽이 낫다.
    if (Number.isFinite(hours) && hours < minHours) { snap.inFlight += 1; continue; }

    snap.total += 1;
    snap.pending += 1;
  }

  // 결제자 수는 묶음으로 센다. 57건이 네 분의 단체 신청일 수도 있다 — 숫자만 보면 오해한다.
  try {
    const groups = await findUnpaidGroups();
    snap.payers = groups.filter((g) => {
      const hours = (now.getTime() - g.submittedAtMs) / 3600000;
      return !Number.isFinite(hours) || hours >= minHours;
    }).length;
  } catch (error: any) {
    console.error("[결제대기알림] 묶음 수를 세지 못했습니다 (건수로만 판정):", error?.message || error);
  }

  snap.rate = snap.total > 0 ? snap.paid / snap.total : 1;
  return snap;
}

function alertPhone(): string | null {
  const raw = (process.env.UNPAID_ALERT_TO ?? DEFAULT_ALERT_TO).trim();
  if (!raw || raw.toLowerCase() === "off") return null;
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 9 ? digits : null;
}

/** 지금 알려야 하는가. 알려야 하면 이유를, 아니면 null 을 돌려준다. */
export function alertReasons(snap: UnpaidSnapshot): string[] {
  const pendingLimit = Number(process.env.UNPAID_ALERT_PENDING || "10");
  const rateFloor = Number(process.env.UNPAID_ALERT_RATE_FLOOR || "0.6");
  const minSample = Number(process.env.UNPAID_ALERT_MIN_SAMPLE || "10");

  const reasons: string[] = [];
  if (snap.pending >= pendingLimit) {
    reasons.push(`결제대기 ${snap.pending}건 / ${snap.payers}명 (임계 ${pendingLimit}건)`);
  }
  if (snap.total >= minSample && snap.rate < rateFloor) {
    reasons.push(`완료율 ${Math.round(snap.rate * 100)}% (하한 ${Math.round(rateFloor * 100)}%)`);
  }
  return reasons;
}

export function composeAlertSms(snap: UnpaidSnapshot, reasons: string[]): string {
  return `[LTT 관리자 알림]

결제대기가 임계를 넘었습니다.
${reasons.map((r) => `· ${r}`).join("\n")}

신청 ${snap.total}건 / 결제완료 ${snap.paid}건
결제대기 ${snap.pending}건 (결제자 ${snap.payers}명)
완료율 ${Math.round(snap.rate * 100)}%
(결제 진행중 ${snap.inFlight} · 취소 ${snap.cancelled} · 만료 ${snap.expired} 제외)

${SITE}/dashboard`;
}

export interface AlertRunResult {
  snapshot: UnpaidSnapshot;
  reasons: string[];
  sent: boolean;
  /** 안 보냈다면 그 이유 */
  reason?: string;
}

export async function runUnpaidAlert(now = new Date()): Promise<AlertRunResult> {
  const snap = await snapshotUnpaid();
  const reasons = alertReasons(snap);

  if (reasons.length === 0) {
    return { snapshot: snap, reasons, sent: false, reason: "임계 이내" };
  }

  const cooldownH = Number(process.env.UNPAID_ALERT_COOLDOWN_H || "6");
  if (lastAlertAt && now.getTime() - lastAlertAt < cooldownH * 3600000) {
    return { snapshot: snap, reasons, sent: false, reason: `쿨다운 ${cooldownH}시간 이내` };
  }

  const to = alertPhone();
  if (!to) {
    console.warn(`[결제대기알림] 받는 번호가 없어 보내지 못했습니다 — ${reasons.join(" / ")}`);
    return { snapshot: snap, reasons, sent: false, reason: "받는 번호 없음" };
  }

  const sms = await sendMessages(
    [{ to, text: composeAlertSms(snap, reasons), label: "결제대기 급증 알림" }],
    "[결제대기알림]"
  );
  const sent = sms.sent > 0 || sms.dryRun;
  if (sent) lastAlertAt = now.getTime();

  console.log(
    `[결제대기알림] ${sent ? "발송" : "발송 실패"} — ${reasons.join(" / ")} ` +
      `(신청 ${snap.total} / 완료 ${snap.paid} / 대기 ${snap.pending} / 결제자 ${snap.payers})`
  );
  return { snapshot: snap, reasons, sent, reason: sent ? undefined : sms.reason };
}

export function startUnpaidAlertScheduler() {
  if (timer) return;

  const enabled = (process.env.UNPAID_ALERT_ENABLED || "on").toLowerCase() !== "off";
  if (!enabled) {
    console.log("[결제대기알림] UNPAID_ALERT_ENABLED=off — 스케줄러를 켜지 않습니다.");
    return;
  }
  const everyMin = Math.max(5, Number(process.env.UNPAID_ALERT_INTERVAL_MIN || "60"));

  timer = setInterval(async () => {
    try {
      await runUnpaidAlert();
    } catch (error: any) {
      console.error("[결제대기알림] 점검 실패:", error?.message || error);
    }
  }, everyMin * 60 * 1000);

  console.log(
    `[결제대기알림] 스케줄러 시작 — ${everyMin}분마다 점검 / ` +
      `대기 ${process.env.UNPAID_ALERT_PENDING || "10"}건 또는 완료율 ` +
      `${Math.round(Number(process.env.UNPAID_ALERT_RATE_FLOOR || "0.6") * 100)}% 미만`
  );
}

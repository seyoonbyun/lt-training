/**
 * ①②③ 검증 — 읽기 전용. 시트에 아무것도 쓰지 않고, 문자도 보내지 않는다.
 *
 *   1) '결제거부' 표시가 결제를 막지 않는지 (가장 중요한 확인)
 *   2) 지금 시트의 결제대기 실측치와 급증 알림 판정
 *   3) 3일 기준으로 오늘 만료 대상이 될 묶음
 */
import "dotenv/config";
import { googleSheetsService, EXPIRED_MARK } from "../server/services/google-sheets";
import { snapshotUnpaid, alertReasons, composeAlertSms } from "../server/services/unpaid-alert";
import { findUnpaidGroups, summarizeGroup } from "../server/services/resume-notice";
import { createResumeToken, verifyResumeToken } from "../server/services/resume-token";

function row(paymentStatus: string, cancelled = ""): string[] {
  const r = new Array(18).fill("");
  r[1] = "LTT : 파운데이션 T."; r[4] = "홍길동"; r[5] = "01000000000";
  r[9] = paymentStatus; r[18] = cancelled;
  return r;
}

async function main() {
  console.log("─".repeat(70));
  console.log("[1] '결제거부' 가 결제를 막지 않는가 (잠금이 아니라 집계 표시여야 한다)");
  const cases: Array<[string, string[], boolean, boolean]> = [
    //  이름                       행                    결제가능?  만료표시?
    ["미결제(빈 값)",              row(""),               true,  false],
    ["결제거부",                   row(EXPIRED_MARK),     true,  true ],
    ["결제완료",                   row("완료"),           false, false],
    ["취소",                       row("", "2026-08-22"), false, false],
    ["결제거부 + 취소",            row(EXPIRED_MARK, "2026-08-22"), false, true],
  ];
  let bad = 0;
  for (const [label, r, wantPayable, wantExpired] of cases) {
    const payable = googleSheetsService.isRowPayable(r);
    const expired = googleSheetsService.isExpiredRow(r);
    const ok = payable === wantPayable && expired === wantExpired;
    if (!ok) bad++;
    console.log(`  ${ok ? "✓" : "✗"} ${label.padEnd(18)} 결제가능=${payable} (기대 ${wantPayable}) / 만료표시=${expired} (기대 ${wantExpired})`);
  }

  console.log("\n[2] 「결제 이어하기」 토큰 왕복 (① 이탈 즉시 화면에서 쓰는 토큰)");
  const token = createResumeToken([41, 42, 43]);
  const back = verifyResumeToken(token);
  const roundTrip = JSON.stringify(back?.rows) === JSON.stringify([41, 42, 43]);
  if (!roundTrip) bad++;
  console.log(`  ${roundTrip ? "✓" : "✗"} /pay/${token}  (${token.length}자) -> ${JSON.stringify(back?.rows)}`);

  console.log("\n[3] 지금 시트 실측 (③ 급증 알림 판정)");
  const snap = await snapshotUnpaid();
  console.log(`  신청 ${snap.total} / 결제완료 ${snap.paid} / 결제대기 ${snap.pending} / 완료율 ${Math.round(snap.rate * 100)}%`);
  console.log(`  (분모 제외: 취소 ${snap.cancelled} · 만료 ${snap.expired})`);
  const reasons = alertReasons(snap);
  console.log(reasons.length ? `  → 알림 발송 대상: ${reasons.join(" / ")}` : "  → 임계 이내 (알림 없음)");
  if (reasons.length) console.log("\n" + composeAlertSms(snap, reasons).split("\n").map((l) => "    | " + l).join("\n"));

  console.log("\n[4] 3일 경과 만료 대상 (② — 실행하지 않고 대상만 센다)");
  const days = Number(process.env.PAYMENT_EXPIRY_DAYS || "3");
  const groups = await findUnpaidGroups();
  const now = Date.now();
  let due = 0;
  for (const g of groups) {
    const age = (now - g.submittedAtMs) / 86400000;
    if (!Number.isFinite(age) || age < days) continue;
    due++;
    const s = await summarizeGroup(g);
    console.log(`  · ${g.payerName}(${g.chapter}) ${g.rows.length}행 / ${age.toFixed(1)}일 경과 / 결제가능 ${s.quantity}건 ${s.amount.toLocaleString("ko-KR")}원 / 1차안내 ${g.alreadyNotified ? "O" : "X"}`);
  }
  console.log(`  미결제 묶음 ${groups.length}건 중 ${days}일 경과 ${due}건`);

  console.log("\n" + "─".repeat(70));
  console.log(bad === 0 ? "판정 검증 통과" : `⚠ 판정 검증 실패 ${bad}건`);
  process.exit(bad === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });

/**
 * 재결제 안내 문자 수기 발송 — 결제를 끝내지 못한 분에게 「결제 이어하기」 링크를 보낸다.
 *
 * 평소에는 서버가 매일 자동으로 보낸다(server/services/unpaid-nudge.ts, KST 11시).
 * 이 스크립트는 **지금 당장** 보내야 할 때 쓴다. 묶음 기준·문구·발송 기록은
 * server/services/resume-notice.ts 를 그대로 쓰므로 자동 발송과 절대 어긋나지 않는다.
 *
 * ⭐ 명단·금액·링크를 **실행 시점에** 만든다. 미리 만들어 두면 그사이 결제한 분에게도
 *    결제 요청이 나간다.
 * ⛔ 보낸 뒤 신청명단 V열에 발송 시각을 적는다. 이걸 빠뜨리면 자동 발송이 같은 사람에게
 *    한 번 더 보낸다.
 *
 * 실행:
 *   npx tsx --env-file=.env scripts/send-resume-links.ts          # 보낼 내용만 출력
 *   npx tsx --env-file=.env scripts/send-resume-links.ts --send   # 실제 발송
 *   ... --force   이미 안내한 묶음도 다시 보낸다 (기본은 건너뜀)
 */
import {
  findUnpaidGroups,
  summarizeGroup,
  buildResumeLink,
  composeResumeSms,
  stampNudged,
  buildAdminCopies,
} from "../server/services/resume-notice";
import { sendMessages, smsByteLength } from "../server/services/solapi";

const SEND = process.argv.includes("--send");
const FORCE = process.argv.includes("--force");
/** 접수 직후에는 보내지 않는다 — 지금 결제창을 띄워 둔 사람일 수 있다. */
const MIN_HOURS = Number(process.env.UNPAID_NUDGE_MIN_HOURS || "2");

async function main() {
  const now = new Date();
  const groups = await findUnpaidGroups();
  console.log(`미결제 묶음 ${groups.length}건\n`);

  const messages: Array<{ to: string; text: string; label: string }> = [];
  const stamps: number[][] = [];

  for (const g of groups) {
    const who = `${g.payerName}(${g.chapter})`;

    if (g.alreadyNotified && !FORCE) { console.log(`  건너뜀 ${who}: 이미 안내함 (--force 로 재발송)`); continue; }
    if (!g.payerPhone) { console.log(`  건너뜀 ${who}: 연락처 없음`); continue; }

    const hours = (now.getTime() - g.submittedAtMs) / 3600000;
    if (Number.isFinite(hours) && hours < MIN_HOURS && !FORCE) {
      console.log(`  건너뜀 ${who}: 접수 ${hours.toFixed(1)}시간 — 아직 결제 중일 수 있음`);
      continue;
    }

    const s = await summarizeGroup(g);
    if (s.quantity === 0) { console.log(`  건너뜀 ${who}: 결제할 건이 없음(마감·결제완료)`); continue; }

    const link = buildResumeLink(g.rows);
    const text = composeResumeSms(g, s, link);
    const span = `${g.rows[0]}-${g.rows[g.rows.length - 1]}`;

    console.log(`  ${s.memberCount > 1 ? "단체" : "개별"} ${who} -> ${g.payerPhone}`);
    console.log(`       ${s.memberCount}명 ${s.quantity}건 ${s.amount.toLocaleString("ko-KR")}원 / ${smsByteLength(text)}bytes / 행 ${span}`);
    console.log(`       ${link}`);
    if (s.closed.length) console.log(`       마감 제외: ${s.closed.join(", ")}`);

    messages.push({ to: g.payerPhone, text, label: `${who} ${s.quantity}건` });
    stamps.push(g.rows);
  }

  if (messages.length === 0) {
    console.log("\n보낼 문자가 없습니다.");
    return;
  }
  if (!SEND) {
    const preview = buildAdminCopies(messages);
    console.log(`\n실제로 보내려면 --send 를 붙이세요. (${messages.length}건`
      + (preview.length ? ` + 검수용 사본 ${preview.length}건 -> ${preview[0].to}` : "") + ")");
    for (const m of messages) {
      console.log(`\n${"=".repeat(60)}\n수신 ${m.to} · ${smsByteLength(m.text)}bytes\n${"=".repeat(60)}\n${m.text}`);
    }
    return;
  }

  const copies = buildAdminCopies(messages);
  if (copies.length) console.log(`검수용 사본 ${copies.length}건을 ${copies[0].to} 로 함께 보냅니다.`);
  const res = await sendMessages([...messages, ...copies], "[재결제안내·수기]");
  console.log(`\n요청 ${res.requested} / 발송 ${res.sent} / 제외 ${res.skipped} / 실패 ${res.failed}${res.dryRun ? " (DRY RUN)" : ""}`);
  if (res.reason) console.log("사유:", res.reason);

  if (res.dryRun) {
    console.log("SOLAPI_DRY_RUN 이 켜져 있어 실제로 보내지 않았습니다. V열도 적지 않습니다.");
    return;
  }

  for (const rows of stamps) {
    try {
      await stampNudged(rows, now);
    } catch (error: any) {
      console.error(`⚠ 발송은 됐으나 V열 기록 실패 — 자동 발송이 재발송할 수 있습니다: ${rows.join(",")}`, error?.message || error);
    }
  }
  console.log("발송 기록(V열) 완료 — 자동 발송이 같은 분께 다시 보내지 않습니다.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

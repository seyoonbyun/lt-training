/**
 * 발송되지 못한 문자 재발송.
 *
 * 2026-08-22 16시에 대량 안내문자 472건이 나가면서 솔라피 일일 한도가 찼고,
 * 그 뒤 17:03~17:14 의 결제완료 안내 14건과 취소·환불 접수 2건이
 * `2000 접수(대기)` 상태로 멈춰 실제로 발송되지 않았다.
 * 돈은 받았는데 강의실·줌 링크를 못 보낸 상태였다.
 *
 * 솔라피 이력에 본문이 그대로 남아 있으므로 **원문 그대로** 다시 보낸다.
 * 새로 만들지 않는다 - 링크나 문구가 달라지면 받는 분이 더 혼란스럽다.
 *
 * 실행:
 *   npx tsx --env-file=.env scripts/resend-stuck-sms.ts          # 무엇을 보낼지만 출력
 *   npx tsx --env-file=.env scripts/resend-stuck-sms.ts --send   # 실제 발송
 *
 * ⚠ 한도가 안 풀렸으면 QuotaExceeded 로 다시 막힌다. 그때는 아무것도 나가지 않는다.
 */
import crypto from "crypto";

const SEND = process.argv.includes("--send");
const apiKey = (process.env.SOLAPI_API_KEY || "").trim();
const apiSecret = (process.env.SOLAPI_API_SECRET || "").trim();
const sender = (process.env.SOLAPI_SENDER || "").replace(/\D/g, "");

function auth(): string {
  const date = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const salt = crypto.randomBytes(16).toString("hex");
  const signature = crypto.createHmac("sha256", apiSecret).update(date + salt).digest("hex");
  return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
}

const byteLen = (t: string) => {
  let b = 0;
  for (const ch of t) b += ch.charCodeAt(0) > 0x7f ? 2 : 1;
  return b;
};

async function main() {
  if (!apiKey || !apiSecret || !sender) throw new Error("솔라피 설정이 없습니다");

  const res = await fetch("https://api.solapi.com/messages/v4/list?limit=500", {
    headers: { Authorization: auth() },
  });
  const list: any[] = Object.values(((await res.json()) as any).messageList || {});

  // 대기(2000) 상태 = 접수만 되고 발송되지 않은 건.
  // 내가 만든 테스트 문자는 제외한다 - 실제 유저에게 갈 것만 다시 보낸다.
  const stuck = list.filter((m) => {
    if (m.statusCode !== "2000") return false;
    const head = String(m.text || "").split("\n")[0];
    if (head.includes("LT 트레이닝 결제 안내")) return false;        // 내 테스트
    if (head.includes("LT 트레이닝 단체 신청 결제 안내")) return false; // 내 테스트
    return true;
  });

  if (stuck.length === 0) {
    console.log("재발송할 건이 없습니다.");
    return;
  }

  console.log(`재발송 대상 ${stuck.length}건\n`);
  const seen = new Set<string>();
  const messages = [];
  for (const m of stuck) {
    const kst = new Date(new Date(m.dateCreated).getTime() + 9 * 3600 * 1000)
      .toISOString().replace("T", " ").slice(0, 19);
    const head = String(m.text || "").split("\n")[0].slice(0, 34);
    const key = `${m.to}|${m.text}`;
    if (seen.has(key)) {
      console.log(`  건너뜀(중복) ${m.to}  ${head}`);
      continue;
    }
    seen.add(key);
    console.log(`  ${kst} -> ${m.to}  ${byteLen(m.text)}b  ${head}`);
    messages.push({
      to: m.to,
      from: sender,
      text: m.text,
      subject: head.slice(0, 40),
      type: byteLen(m.text) > 90 ? "LMS" : "SMS",
    });
  }

  // 검수용 요약 1통. 16건을 그대로 복사하면 발송량이 두 배가 되고,
  // 사본을 하나씩 읽는 것보다 "누구에게 몇 건 나갔나" 한 장이 더 쓸모 있다.
  const copyTo = (process.env.SMS_COPY_TO ?? "01028033021").replace(/\D/g, "");
  if (copyTo && copyTo.length >= 9) {
    const kinds = new Map<string, number>();
    for (const m of messages) {
      const head = String(m.text).split("\n")[0];
      const kind = head.includes("취소") ? "취소·환불 접수" : "결제완료 안내";
      kinds.set(kind, (kinds.get(kind) || 0) + 1);
    }
    const lines = [...kinds.entries()].map(([k, v]) => `- ${k} ${v}건`).join("\n");
    const numbers = messages.map((m) => m.to).join(", ");
    const summary =
      `[검수용] LTT 미발송 문자 재발송\n\n` +
      `2026-08-22 발송 한도 초과로 나가지 못했던 문자를 다시 보냈습니다.\n\n` +
      `총 ${messages.length}건\n${lines}\n\n수신 번호\n${numbers}`;
    messages.push({
      to: copyTo,
      from: sender,
      text: summary,
      subject: "[검수용] LTT 미발송 문자 재발송",
      type: byteLen(summary) > 90 ? "LMS" : "SMS",
    });
    console.log(`\n  + 검수용 요약 1건 -> ${copyTo}`);
  }

  if (!SEND) {
    console.log(`\n실제로 보내려면 --send 를 붙이세요. (${messages.length}건)`);
    return;
  }

  const r = await fetch("https://api.solapi.com/messages/v4/send-many/detail", {
    method: "POST",
    headers: { Authorization: auth(), "Content-Type": "application/json" },
    // 같은 번호로 두 통 이상이면 솔라피가 둘째 통을 조용히 실패시킨다.
    body: JSON.stringify({ messages, allowDuplicates: true }),
  });
  const raw = await r.text();
  console.log(`\nHTTP ${r.status}`);
  if (!r.ok) {
    console.log("응답:", raw.slice(0, 500));
    process.exitCode = 1;
    return;
  }
  const out = JSON.parse(raw);
  console.log(
    `요청 ${out.groupInfo?.count?.total} / 등록성공 ${out.groupInfo?.count?.registeredSuccess} / 등록실패 ${out.groupInfo?.count?.registeredFailed}`
  );
  if (out.failedMessageList?.length) console.log("실패:", JSON.stringify(out.failedMessageList, null, 2));
  console.log("\n⚠ 등록 성공이 곧 발송 성공은 아니다. 몇 분 뒤 상태코드가 4000(발송성공)인지 반드시 확인할 것.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

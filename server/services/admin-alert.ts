/**
 * 관리자에게 즉시 알리는 경보.
 *
 * 왜 있나
 *   지금까지 실패는 전부 `console.error` 한 줄로 끝났다. Railway 로그는 아무도 안 본다.
 *   - 2026-08-22 솔라피 한도 초과로 결제완료 안내 14건이 안 나간 걸 다음 날 알았다
 *   - 2026-08-23 일괄 26건이 엉뚱한 열에 기록된 걸 대표가 화면을 보고 발견했다
 *   조용한 실패는 실패가 아니라 사고다. 사람이 봐야 하는 일은 사람에게 보낸다.
 *
 * 규칙 두 가지
 *   1) **경보가 실패해도 본래 흐름(신청·결제)을 막지 않는다.**
 *      오류를 잡아서 위로 던지지 않는다. 경보가 못 나갔다고 결제가 깨지면 본말전도다.
 *   2) 그렇다고 조용히 끝내지도 않는다. **문자가 실패하면 메일로 한 번 더** 보낸다.
 *      둘 다 실패해야 로그로 내려간다. 경로가 하나뿐이면 그 하나가 죽었을 때
 *      아무도 모르는데, 그게 바로 위 두 사고의 공통점이었다.
 */
import { isSolapiConfigured, sendMessages } from "./solapi";
import { isMailerConfigured, sendMails } from "./mailer";

const DEFAULT_TO = "01028033021";
const DEFAULT_MAIL_TO = "hq@joy-bnikorea.com";

function phoneRecipients(): string[] {
  const raw = (process.env.ADMIN_ALERT_TO ?? process.env.UNPAID_ALERT_TO ?? DEFAULT_TO).trim();
  return raw.split(/[,\s]+/).map((v) => v.replace(/\D/g, "")).filter((v) => v.length >= 10);
}

function mailRecipients(): string[] {
  const raw = (process.env.ADMIN_ALERT_MAIL_TO ?? DEFAULT_MAIL_TO).trim();
  return raw.split(/[,\s]+/).map((v) => v.trim()).filter((v) => v.includes("@"));
}

/**
 * 관리자에게 경보 한 건. 문자 -> (실패 시) 메일 순으로 시도한다.
 * 어느 쪽도 예외를 밖으로 내보내지 않는다.
 */
export async function alertAdmin(title: string, body: string): Promise<void> {
  if ((process.env.ADMIN_ALERT_ENABLED || "on").toLowerCase() === "off") return;

  const text = `[LTT 관리자 알림]\n${title}\n\n${body}`;
  let smsOk = false;

  // ── 1차 : 문자
  try {
    const to = phoneRecipients();
    if (isSolapiConfigured() && to.length) {
      const from = (process.env.SOLAPI_SENDER || "").replace(/\D/g, "");
      const res = await sendMessages(
        to.map((phone) => ({ to: phone, from, text, subject: title.slice(0, 40) })),
        `(관리자알림 ${title})`
      );
      smsOk = (res as any)?.sent > 0;
    }
  } catch (error: any) {
    console.error(`[관리자알림] 문자 실패 (${title}):`, error?.message || error);
  }

  if (smsOk) return;

  // ── 2차 : 메일. 문자가 죽었을 때를 위한 다른 경로다.
  try {
    const to = mailRecipients();
    if (isMailerConfigured() && to.length) {
      await sendMails(
        to.map((addr) => ({
          to: addr,
          subject: `[LTT 경보] ${title}`,
          text,
          html: `<pre style="font:14px/1.7 monospace;white-space:pre-wrap">${escapeHtml(text)}</pre>`,
        })),
        `(관리자알림 ${title})`
      );
      console.error(`[관리자알림] 문자가 안 나가 메일로 보냈습니다 — ${title}`);
      return;
    }
  } catch (error: any) {
    console.error(`[관리자알림] 메일도 실패 (${title}):`, error?.message || error);
  }

  // ── 둘 다 실패. 여기까지 오면 남길 곳이 로그뿐이다.
  console.error(`❌ [관리자알림] 어느 경로로도 못 보냈습니다 — ${title}\n${body}`);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
}

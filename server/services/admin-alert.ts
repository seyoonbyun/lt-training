/**
 * 관리자에게 즉시 알리는 문자.
 *
 * 왜 있나
 *   지금까지 실패는 전부 `console.error` 한 줄로 끝났다. Railway 로그는 아무도 안 본다.
 *   - 2026-08-22 솔라피 한도 초과로 결제완료 안내 14건이 안 나간 걸 다음 날 알았다
 *   - 2026-08-23 일괄 26건이 엉뚱한 열에 기록된 걸 대표가 화면을 보고 발견했다
 *   조용한 실패는 실패가 아니라 사고다. 사람이 봐야 하는 일은 사람에게 보낸다.
 *
 * ⛔ 여기서 나는 오류가 본래 흐름(신청·결제)을 절대 막지 않는다. 전부 삼킨다.
 */
import { isSolapiConfigured, sendMessages } from "./solapi";

const DEFAULT_TO = "01028033021";

function recipients(): string[] {
  const raw = (process.env.ADMIN_ALERT_TO ?? process.env.UNPAID_ALERT_TO ?? DEFAULT_TO).trim();
  return raw.split(/[,\s]+/).map((v) => v.replace(/\D/g, "")).filter((v) => v.length >= 10);
}

/**
 * 관리자에게 한 통. 제목 한 줄 + 본문.
 * 실패해도 던지지 않는다 — 알림이 못 나갔다고 신청이 막히면 더 나쁘다.
 */
export async function alertAdmin(title: string, body: string): Promise<void> {
  try {
    if ((process.env.ADMIN_ALERT_ENABLED || "on").toLowerCase() === "off") return;
    if (!isSolapiConfigured()) {
      console.error(`[관리자알림] 솔라피 설정이 없어 못 보냈습니다 — ${title}\n${body}`);
      return;
    }
    const to = recipients();
    if (!to.length) return;
    const from = (process.env.SOLAPI_SENDER || "").replace(/\D/g, "");
    const text = `[LTT 관리자 알림]\n${title}\n\n${body}`;
    await sendMessages(
      to.map((phone) => ({ to: phone, from, text, subject: title.slice(0, 40) })),
      `(관리자알림 ${title})`
    );
  } catch (error: any) {
    console.error(`[관리자알림] 발송 실패 (${title}):`, error?.message || error);
  }
}

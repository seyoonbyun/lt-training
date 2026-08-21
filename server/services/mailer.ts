/**
 * 이메일 발송 — hq@joy-bnikorea.com Apps Script 웹앱 릴레이.
 *
 * 왜 릴레이인가
 *   보내는 주소가 hq@joy-bnikorea.com 이어야 하는데, 서버에서 그 계정으로 직접 보내려면
 *   앱 비밀번호나 OAuth 리프레시 토큰을 Railway 에 들고 있어야 한다.
 *   hq 계정에는 MTL 발송에 쓰는 Apps Script 가 이미 있고, 거기서 검증된 **Gmail API 경로**
 *   (`sendViaGmailApi_`)가 두 고질 문제를 피한다 —
 *     · Apps Script 메일 일일 캡("Service invoked too many times")
 *     · 네이버 수신자에게 뜨던 링크 리디렉션 경고
 *   같은 계정·같은 경로를 쓰는 웹앱을 하나 두고 서버는 POST 만 한다.
 *
 * ⛔ 메일 실패가 결제를 되돌리면 안 된다. 예외를 던지지 않고 결과만 돌려준다.
 */

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** 로그용 */
  label?: string;
}

export interface MailResult {
  requested: number;
  sent: number;
  skipped: number;
  failed: number;
  dryRun: boolean;
  reason?: string;
}

function cfg() {
  const url = (process.env.MAIL_RELAY_URL || "").trim();
  const secret = (process.env.MAIL_RELAY_SECRET || "").trim();
  if (!url || !secret) return null;
  return { url, secret };
}

export function isMailerConfigured(): boolean {
  return cfg() !== null;
}

function isDryRun(): boolean {
  const v = (process.env.MAIL_DRY_RUN || "").trim().toLowerCase();
  return v === "1" || v === "on" || v === "true";
}

export function isValidEmail(raw: string): boolean {
  const v = String(raw || "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length <= 254;
}

/**
 * 여러 통을 한 번의 POST 로 넘긴다. 릴레이가 순서대로 보내고 건별 결과를 돌려준다.
 * 실패해도 예외를 던지지 않는다.
 */
export async function sendMails(messages: MailMessage[], context = ""): Promise<MailResult> {
  const result: MailResult = {
    requested: messages.length,
    sent: 0,
    skipped: 0,
    failed: 0,
    dryRun: isDryRun(),
  };

  const valid = messages.filter((m) => {
    if (!isValidEmail(m.to)) {
      result.skipped += 1;
      console.warn(`[메일] 발송 대상 제외 — 주소 형식 불가 (${m.label || m.to}) ${context}`);
      return false;
    }
    return true;
  });

  if (valid.length === 0) return result;

  if (result.dryRun) {
    result.sent = valid.length;
    console.log(`[메일·DRY RUN] ${valid.length}통 (실제 발송 안 함) ${context}`);
    valid.forEach((m, i) => {
      console.log(`  ${i + 1}. ${m.label || ""} → ${m.to}\n  제목: ${m.subject}\n${m.text}\n---`);
    });
    return result;
  }

  const c = cfg();
  if (!c) {
    result.failed = valid.length;
    result.reason = "mailer-not-configured";
    console.error(
      `[메일] 발송 설정이 없어 ${valid.length}통을 보내지 못했습니다 ${context} ` +
        `(MAIL_RELAY_URL / MAIL_RELAY_SECRET)`
    );
    return result;
  }

  try {
    const res = await fetch(c.url, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        secret: c.secret,
        messages: valid.map((m) => ({ to: m.to, subject: m.subject, html: m.html, text: m.text })),
      }),
      // Apps Script 웹앱은 302 로 googleusercontent 로 넘긴다. fetch 가 따라간다.
      redirect: "follow",
    });

    const body: any = await res.json().catch(() => ({}));

    if (!res.ok || body?.ok !== true) {
      result.failed = valid.length;
      result.reason = body?.error || `HTTP ${res.status}`;
      console.error(`[메일] 발송 실패 ${res.status} ${body?.error || ""} ${context}`);
      return result;
    }

    result.sent = Number(body.sent ?? valid.length);
    result.failed = Number(body.failed ?? 0);
    if (result.failed > 0) {
      console.error(`[메일] ${result.failed}통 실패 ${context} :: ${JSON.stringify(body.errors || []).slice(0, 500)}`);
    }
    console.log(`[메일] ${result.sent}통 발송 ${context}`);
    return result;
  } catch (error: any) {
    result.failed = valid.length;
    result.reason = error?.message || "unknown";
    console.error(`[메일] 발송 중 오류 ${context}:`, error?.message || error);
    return result;
  }
}

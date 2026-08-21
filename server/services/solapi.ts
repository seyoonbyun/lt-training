/**
 * 솔라피(SOLAPI) 문자 발송.
 *
 * 결제 승인 직후 신청자에게 참여 링크를 보낸다.
 *   - 실시간 참여 → 줌 링크(세션등록 시트 J열). 오프라인 과목은 줌이 없으므로 장소(H열)를 안내한다.
 *   - 녹화본(VOD)  → 온라인 강의실 링크(I열)
 *
 * ⛔ 문자 실패가 결제를 되돌리면 안 된다. 이 모듈은 예외를 던지지 않고 결과만 돌려준다.
 *    실패는 콘솔에 남겨 수기 재발송이 가능하게 한다.
 *
 * 인증은 솔라피 표준 HMAC-SHA256 (date + salt 를 api_secret 으로 서명).
 * ⚠ 키는 다른 자동화(RPS-Board)와 공용이다. 재발급하면 그쪽이 같이 죽는다.
 */

import crypto from "crypto";

const SEND_MANY_URL = "https://api.solapi.com/messages/v4/send-many/detail";

/** SMS 는 EUC-KR 기준 90바이트까지. 넘으면 LMS 로 보내야 잘리지 않는다. */
const SMS_BYTE_LIMIT = 90;
/** LMS 본문 상한(2000바이트). 넘기면 솔라피가 거절한다. */
const LMS_BYTE_LIMIT = 2000;

export interface SmsMessage {
  to: string;
  text: string;
  /** 로그용. 누구에게 무엇을 보냈는지 남긴다 */
  label?: string;
}

export interface SmsResult {
  requested: number;
  sent: number;
  skipped: number;
  failed: number;
  dryRun: boolean;
  reason?: string;
}

function cfg() {
  const apiKey = (process.env.SOLAPI_API_KEY || "").trim();
  const apiSecret = (process.env.SOLAPI_API_SECRET || "").trim();
  const sender = (process.env.SOLAPI_SENDER || "").replace(/\D/g, "");
  if (!apiKey || !apiSecret || !sender) return null;
  return { apiKey, apiSecret, sender };
}

export function isSolapiConfigured(): boolean {
  return cfg() !== null;
}

/** 실제로 보내지 않고 로그만 남기는 모드. 로컬 확인용. */
function isDryRun(): boolean {
  const v = (process.env.SOLAPI_DRY_RUN || "").trim().toLowerCase();
  return v === "1" || v === "on" || v === "true";
}

function authHeader(c: { apiKey: string; apiSecret: string }): string {
  const date = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const salt = crypto.randomBytes(16).toString("hex");
  const signature = crypto
    .createHmac("sha256", c.apiSecret)
    .update(date + salt)
    .digest("hex");
  return `HMAC-SHA256 apiKey=${c.apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
}

/**
 * 문자 길이 판정용 바이트 수. 한글 등 비ASCII 는 2바이트로 센다(EUC-KR 기준).
 * Buffer.byteLength(utf8) 로 재면 한글이 3바이트라 실제보다 길게 나와 불필요하게 LMS 가 된다.
 */
export function smsByteLength(text: string): number {
  let bytes = 0;
  for (const ch of text) {
    bytes += ch.charCodeAt(0) > 0x7f ? 2 : 1;
  }
  return bytes;
}

/** LMS 상한을 넘으면 끝을 자르고 안내를 붙인다. 솔라피 거절로 전부 못 나가는 것보다 낫다. */
export function clampToLms(text: string): string {
  if (smsByteLength(text) <= LMS_BYTE_LIMIT) return text;
  const tail = "\n\n(내용이 길어 일부만 표시됩니다. 문의 02-6261-8838)";
  const budget = LMS_BYTE_LIMIT - smsByteLength(tail);
  let out = "";
  let bytes = 0;
  for (const ch of text) {
    const w = ch.charCodeAt(0) > 0x7f ? 2 : 1;
    if (bytes + w > budget) break;
    out += ch;
    bytes += w;
  }
  return out + tail;
}

export function normalizePhone(raw: string): string {
  const digits = String(raw || "").replace(/\D/g, "");
  // 국가번호로 적힌 경우를 국내 형식으로 되돌린다 (+82 10 → 010)
  if (digits.startsWith("82") && digits.length >= 11) return "0" + digits.slice(2);
  return digits;
}

/** 국내 휴대폰/일반전화로 보기에 타당한 번호인지. 오타로 엉뚱한 곳에 보내지 않게 한다. */
export function isSendablePhone(raw: string): boolean {
  const p = normalizePhone(raw);
  if (!/^0\d{8,10}$/.test(p)) return false;
  return true;
}

/**
 * 여러 명에게 각자 다른 본문을 한 번에 보낸다.
 * 실패해도 예외를 던지지 않는다 — 호출부(결제 승인)가 이 때문에 멈추면 안 된다.
 */
export async function sendMessages(messages: SmsMessage[], context = ""): Promise<SmsResult> {
  const result: SmsResult = {
    requested: messages.length,
    sent: 0,
    skipped: 0,
    failed: 0,
    dryRun: isDryRun(),
  };

  const valid = messages.filter((m) => {
    if (!isSendablePhone(m.to)) {
      result.skipped += 1;
      console.warn(`[문자] 발송 대상 제외 — 번호 형식 불가 (${m.label || m.to}) ${context}`);
      return false;
    }
    return true;
  });

  if (valid.length === 0) {
    return result;
  }

  const c = cfg();
  if (!c) {
    result.failed = valid.length;
    result.reason = "solapi-not-configured";
    console.error(
      `[문자] 발송 설정이 없어 ${valid.length}건을 보내지 못했습니다 ${context} ` +
        `(SOLAPI_API_KEY / SOLAPI_API_SECRET / SOLAPI_SENDER)`
    );
    return result;
  }

  const payload = valid.map((m) => {
    const text = clampToLms(m.text);
    return {
      to: normalizePhone(m.to),
      from: c.sender,
      text,
      // 길이에 따라 명시한다. 자동 판정에 맡기면 90바이트 넘는 글이 잘려 나갈 수 있다.
      type: smsByteLength(text) > SMS_BYTE_LIMIT ? "LMS" : "SMS",
    };
  });

  if (result.dryRun) {
    result.sent = payload.length;
    console.log(`[문자·DRY RUN] ${payload.length}건 (실제 발송 안 함) ${context}`);
    payload.forEach((p, i) => {
      console.log(`  ${i + 1}. ${valid[i].label || ""} → ${p.to} [${p.type}]\n${p.text}\n---`);
    });
    return result;
  }

  try {
    const res = await fetch(SEND_MANY_URL, {
      method: "POST",
      headers: {
        Authorization: authHeader(c),
        "Content-Type": "application/json",
      },
      // ⛔ allowDuplicates 를 켜지 않으면 **같은 번호로 온 두 번째 통이 조용히 실패**한다
      //    (statusCode 1026 "중복 수신번호"). 과목이 많아 (1/2)(2/2) 로 나눠 보낼 때가 정확히 그 경우다.
      body: JSON.stringify({ messages: payload, allowDuplicates: true }),
    });

    const body: any = await res.json().catch(() => ({}));

    if (!res.ok) {
      result.failed = payload.length;
      result.reason = body?.errorCode || `HTTP ${res.status}`;
      console.error(
        `[문자] 발송 실패 ${res.status} ${body?.errorCode || ""} ${body?.errorMessage || ""} ${context}`
      );
      return result;
    }

    // 솔라피는 일부만 실패해도 200 을 준다. groupInfo.count 로 실제 접수 건수를 본다.
    const count = body?.groupInfo?.count || {};
    const registered = Number(count.registeredSuccess ?? payload.length);
    const failedCount = Number(count.registeredFailed ?? 0);
    result.sent = registered;
    result.failed = failedCount;

    if (failedCount > 0) {
      console.error(
        `[문자] ${failedCount}건 접수 실패 ${context} :: ` +
          JSON.stringify(body?.failedMessageList || []).slice(0, 500)
      );
    }
    console.log(`[문자] ${registered}건 발송 접수 ${context}`);
    return result;
  } catch (error: any) {
    result.failed = payload.length;
    result.reason = error?.message || "unknown";
    console.error(`[문자] 발송 중 오류 ${context}:`, error?.message || error);
    return result;
  }
}

/**
 * 「결제 이어하기」 링크 토큰.
 *
 * 신청 행은 결제 **전에** 먼저 쓰이므로, 결제를 끝내지 못한 분의 행이 시트에 남는다.
 * 그 행 번호를 서명해 링크에 담으면, 받는 분은 아무것도 다시 입력하지 않고
 * 결제만 이어서 할 수 있다 (단체 신청은 명단 15명을 다시 타이핑해야 했다).
 *
 * 서명은 SESSION_SECRET 에서 파생한다 — Railway 에 환경변수를 새로 만들지 않는다
 * (이름이 빈 유령 변수 때문에 빌드가 깨진 전례가 있다).
 *
 * ⚠ 토큰에는 **행 번호와 결제자 정보만** 담는다. 금액은 절대 담지 않는다 —
 *    서버가 시트에서 다시 읽어 계산한다. 링크를 고쳐도 청구 금액은 못 바꾼다.
 */
import crypto from "crypto";

export interface ResumePayload {
  /** 신청명단 시트의 행 번호들 (1-based) */
  rows: number[];
  /** 결제자. 토스 결제창에 채워 넣는 값이고 금액과는 무관하다. */
  payer: { name: string; phone: string; email?: string };
  /** 만료 (epoch ms) */
  exp: number;
}

function secret(): string {
  const base = process.env.SESSION_SECRET || "";
  if (!base) throw new Error("SESSION_SECRET not set");
  // 세션 서명과 같은 키를 그대로 쓰지 않도록 용도를 섞는다.
  return crypto.createHash("sha256").update(`ltt-resume:${base}`).digest("hex");
}

function sign(body: string): string {
  return crypto.createHmac("sha256", secret()).update(body).digest("base64url");
}

export function createResumeToken(payload: Omit<ResumePayload, "exp">, ttlDays = 7): string {
  const full: ResumePayload = { ...payload, exp: Date.now() + ttlDays * 24 * 60 * 60 * 1000 };
  const body = Buffer.from(JSON.stringify(full)).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function verifyResumeToken(token: string): ResumePayload | null {
  try {
    const [body, mac] = String(token || "").split(".");
    if (!body || !mac) return null;

    const expected = sign(body);
    // 타이밍 공격 방지. 길이가 다르면 timingSafeEqual 이 던지므로 먼저 본다.
    if (mac.length !== expected.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;

    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as ResumePayload;
    if (!Array.isArray(payload.rows) || payload.rows.length === 0) return null;
    if (!payload.rows.every((r) => Number.isInteger(r) && r > 1)) return null;
    if (!payload.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

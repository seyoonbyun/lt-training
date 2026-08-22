/**
 * 「결제 이어하기」 링크 토큰.
 *
 * 신청 행은 결제 **전에** 먼저 쓰이므로, 결제를 끝내지 못한 분의 행이 시트에 남는다.
 * 그 행 번호를 서명해 링크에 담으면, 받는 분은 아무것도 다시 입력하지 않고
 * 결제만 이어서 할 수 있다 (단체 신청은 명단 15명을 다시 타이핑해야 했다).
 *
 * ⛔ 짧아야 한다. 문자로 보내는 링크다.
 *    처음엔 JSON 을 통째로 base64 해서 250자가 넘었는데, 그 길이는 터미널·메신저
 *    어디서든 줄바꿈에 잘리고 한 글자만 잘려도 서명이 깨진다(2026-08-22 실제로 겪음).
 *    -> 행 번호는 범위로 접고(41-67), 결제자는 담지 않고 시트 첫 행에서 읽고,
 *       서명은 12자만 쓴다. 링크가 50자 안쪽으로 떨어진다.
 *
 * 형식: <rows>~<exp36>.<mac12>     예) 41-67~mk3f.8Kd2mXpQ9vLt
 *   rows  : 행 번호. 연속 구간은 a-b 로 접는다. 여러 구간은 쉼표.
 *   exp36 : 만료 시각(분 단위 epoch)을 36진수로.
 *   mac12 : 앞 두 조각에 대한 HMAC-SHA256 앞 12자 (base64url, 72비트).
 *
 * 서명은 SESSION_SECRET 에서 파생한다 - Railway 에 환경변수를 새로 만들지 않는다
 * (이름이 빈 유령 변수 때문에 빌드가 깨진 전례가 있다).
 *
 * ⚠ 토큰에는 **행 번호만** 들어간다. 금액은 절대 담지 않는다 -
 *   서버가 시트에서 다시 읽어 계산한다. 링크를 고쳐도 청구 금액은 못 바꾼다.
 */
import crypto from "crypto";

export interface ResumePayload {
  /** 신청명단 시트의 행 번호들 (1-based, 오름차순) */
  rows: number[];
  /** 만료 (epoch ms) */
  exp: number;
}

const MAC_LENGTH = 12;

function secret(): string {
  const base = process.env.SESSION_SECRET || "";
  if (!base) throw new Error("SESSION_SECRET not set");
  // 세션 서명과 같은 키를 그대로 쓰지 않도록 용도를 섞는다.
  return crypto.createHash("sha256").update(`ltt-resume:${base}`).digest("hex");
}

function sign(body: string): string {
  return crypto.createHmac("sha256", secret()).update(body).digest("base64url").slice(0, MAC_LENGTH);
}

/** [41,42,...,67] -> "41-67" / [11] -> "11" / [11,15,16,17] -> "11,15-17" */
export function encodeRows(rows: number[]): string {
  const sorted = Array.from(new Set(rows)).sort((a, b) => a - b);
  const parts: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];

  for (let i = 1; i <= sorted.length; i++) {
    const n = sorted[i];
    if (n === prev + 1) {
      prev = n;
      continue;
    }
    parts.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = n;
    prev = n;
  }
  return parts.join(",");
}

/** "41-67,80" -> [41,...,67,80]. 형식이 어긋나면 null. */
export function decodeRows(encoded: string): number[] | null {
  const rows: number[] = [];
  for (const part of String(encoded || "").split(",")) {
    const range = part.match(/^(\d+)(?:-(\d+))?$/);
    if (!range) return null;

    const from = parseInt(range[1], 10);
    const to = range[2] ? parseInt(range[2], 10) : from;
    // 헤더(1행)는 신청이 아니고, 뒤집힌 범위는 형식 오류다.
    if (from < 2 || to < from) return null;
    // 링크 하나가 시트 전체를 긁지 못하게 막는다.
    if (to - from > 500) return null;

    for (let n = from; n <= to; n++) rows.push(n);
  }
  return rows.length > 0 ? rows : null;
}

export function createResumeToken(rows: number[], ttlDays = 7): string {
  const expMinutes = Math.floor((Date.now() + ttlDays * 24 * 60 * 60 * 1000) / 60000);
  const body = `${encodeRows(rows)}~${expMinutes.toString(36)}`;
  return `${body}.${sign(body)}`;
}

export function verifyResumeToken(token: string): ResumePayload | null {
  try {
    const raw = String(token || "");
    const dot = raw.lastIndexOf(".");
    if (dot <= 0) return null;

    const body = raw.slice(0, dot);
    const mac = raw.slice(dot + 1);
    const expected = sign(body);

    // 타이밍 공격 방지. 길이가 다르면 timingSafeEqual 이 던지므로 먼저 본다.
    if (mac.length !== expected.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;

    const [rowsPart, expPart] = body.split("~");
    if (!rowsPart || !expPart) return null;

    const rows = decodeRows(rowsPart);
    if (!rows) return null;

    const exp = parseInt(expPart, 36) * 60000;
    if (!Number.isFinite(exp) || Date.now() > exp) return null;

    return { rows, exp };
  } catch {
    return null;
  }
}

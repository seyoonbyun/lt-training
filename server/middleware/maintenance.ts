import type { Request, Response, NextFunction } from "express";
import { createHash, timingSafeEqual } from "crypto";

// 재정비(점검) 모드. 배포된 상태에서 즉시 끄려면 Railway 환경변수에
// MAINTENANCE_MODE=off 를 설정하고 재시작하면 된다. 이 커밋을 되돌려도 해제된다.
const DEFAULT_ON = true;

/**
 * 점검 중 우회.
 *
 * 사이트를 닫아 둔 채로 라이브 결제를 끝까지 돌려 보기 위한 통로다.
 * `?preview=<토큰>` 으로 한 번 들어오면 쿠키가 심기고, 그 브라우저만 정상 사이트를 본다.
 * 나머지 방문자·검색엔진에는 그대로 503 점검 페이지가 나간다.
 *
 * 토큰은 환경변수를 새로 만들지 않는다 — Railway 에 변수를 추가하면 이름이 빈
 * 유령 변수가 생겨 빌드가 깨진 적이 있다. 기존 SESSION_SECRET 에서 파생시키고,
 * 굳이 지정하고 싶으면 PREVIEW_TOKEN 이 우선한다.
 */
const PREVIEW_COOKIE = "ltt_preview";
const PREVIEW_TTL_MS = 12 * 60 * 60 * 1000;

export function getPreviewToken(): string {
  const explicit = (process.env.PREVIEW_TOKEN || "").trim();
  if (explicit) return explicit;

  const seed = (process.env.SESSION_SECRET || "").trim();
  if (!seed) return "";
  return createHash("sha256").update(`${seed}|ltt-preview`).digest("hex").slice(0, 24);
}

/** 길이가 달라도 던지지 않게 감싼 상수시간 비교 */
function sameToken(a: string, b: string): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function readCookie(req: Request, name: string): string {
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return part.slice(eq + 1).trim();
    }
  }
  return "";
}

function isEnabled() {
  const flag = (process.env.MAINTENANCE_MODE || "").trim().toLowerCase();
  if (flag === "off" || flag === "false" || flag === "0") return false;
  if (flag === "on" || flag === "true" || flag === "1") return true;
  return DEFAULT_ON;
}

const PAGE = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>재정비 중 · BNI LT Training</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    padding: 24px; background: #f5f5f5; color: #1a1a1a;
    font-family: "Pretendard", "Malgun Gothic", -apple-system, BlinkMacSystemFont, sans-serif;
  }
  .card {
    width: 100%; max-width: 480px; background: #fff; border-radius: 12px;
    padding: 40px 32px; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,.08);
    border-top: 4px solid #cf2030;
  }
  h1 { margin: 0 0 12px; font-size: 20px; font-weight: 700; letter-spacing: -.01em; }
  p { margin: 0 0 8px; font-size: 15px; line-height: 1.7; color: #555; }
  .brand { margin-top: 28px; font-size: 12px; letter-spacing: .08em; color: #999; }
</style>
</head>
<body>
  <main class="card">
    <h1>재정비 중입니다</h1>
    <p>LT Training 신청 페이지를 잠시 점검하고 있습니다.</p>
    <p>정비가 끝나는 대로 다시 열립니다. 이용에 불편을 드려 죄송합니다.</p>
    <div class="brand">BNI KOREA · LT TRAINING</div>
  </main>
</body>
</html>`;

export function maintenance(req: Request, res: Response, next: NextFunction) {
  if (!isEnabled()) return next();

  const token = getPreviewToken();

  // 이미 통과한 브라우저
  if (token && sameToken(readCookie(req, PREVIEW_COOKIE), token)) return next();

  // 토큰을 들고 들어온 첫 요청 — 쿠키를 심고, 주소에서 토큰을 지운 채 다시 부른다.
  // (토큰이 URL 에 남으면 referer·히스토리·외부 결제창으로 새어 나간다)
  const given = typeof req.query.preview === "string" ? req.query.preview : "";
  if (token && sameToken(given, token)) {
    res.cookie?.(PREVIEW_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: req.secure,
      maxAge: PREVIEW_TTL_MS,
      path: "/",
    });
    console.log(`[점검] 우회 접속 허용 — ${req.ip}`);

    const rest = { ...req.query } as Record<string, unknown>;
    delete rest.preview;
    const qs = new URLSearchParams(rest as Record<string, string>).toString();
    return res.redirect(302, qs ? `${req.path}?${qs}` : req.path);
  }

  res.status(503);
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Retry-After", "3600");

  if (req.path.startsWith("/api")) {
    return res.json({ message: "재정비 중입니다. 잠시 후 다시 시도해 주세요." });
  }

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.send(PAGE);
}

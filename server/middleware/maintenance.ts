import type { Request, Response, NextFunction } from "express";

// 재정비(점검) 모드. 배포된 상태에서 즉시 끄려면 Railway 환경변수에
// MAINTENANCE_MODE=off 를 설정하고 재시작하면 된다. 이 커밋을 되돌려도 해제된다.
const DEFAULT_ON = true;

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

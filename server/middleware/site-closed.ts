import type { Request, Response, NextFunction } from "express";

// ⛔ 2026-10-04 2026 LT 트레이닝 종료로 사이트를 내렸다(사용자 지시).
//   어떤 주소로 들어와도 종료 안내 팝업만 보인다. VOD·신청·결제·대시보드 모두 닫힌다.
//   다시 열려면 Railway 환경변수에 LTT_SITE_OPEN=on 을 넣고 재배포한다.
function isClosed() {
  return (process.env.LTT_SITE_OPEN || "").trim().toLowerCase() !== "on";
}

const PAGE = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>BNI LT Training</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    padding: 16px; background: rgba(17, 17, 17, .55); color: #1a1a1a;
    font-family: "Pretendard", "Malgun Gothic", -apple-system, BlinkMacSystemFont, sans-serif;
  }
  .popup {
    width: 100%; max-width: 400px; background: #fff; border-radius: 12px;
    padding: 36px 28px 32px; text-align: center; box-shadow: 0 12px 40px rgba(0,0,0,.25);
    border-top: 4px solid #cf2030;
  }
  h1 { margin: 0 0 10px; font-size: 19px; font-weight: 700; line-height: 1.5; letter-spacing: -.01em; word-break: keep-all; }
  p { margin: 0; font-size: 15px; line-height: 1.7; color: #555; }
  .brand { margin-top: 24px; font-size: 12px; letter-spacing: .08em; color: #999; }
</style>
</head>
<body>
  <main class="popup" role="dialog" aria-labelledby="t">
    <h1 id="t">2026 LT 트레이닝이 종료되었습니다</h1>
    <p>감사합니다.</p>
    <div class="brand">BNI KOREA · LT TRAINING</div>
  </main>
</body>
</html>`;

export function siteClosed(req: Request, res: Response, next: NextFunction) {
  if (!isClosed()) return next();

  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");

  if (req.path.startsWith("/api")) {
    return res.status(410).json({ message: "2026 LT 트레이닝이 종료되었습니다. 감사합니다." });
  }

  res.status(200);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.send(PAGE);
}

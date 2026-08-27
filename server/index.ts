import 'dotenv/config';
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic, log } from "./static-serve";
import { maintenance, getPreviewToken } from "./middleware/maintenance";
import { startReminderScheduler } from "./services/reminder";
import { startUnpaidNudgeScheduler } from "./services/unpaid-nudge";
import { startPaymentExpiryScheduler } from "./services/payment-expiry";
import { startUnpaidAlertScheduler } from "./services/unpaid-alert";
import { startSurveyScheduler } from "./services/survey";
import { startSurveySyncScheduler } from "./services/survey-sync";

const app = express();
app.set('trust proxy', true);

// 재정비 모드: 켜져 있으면 모든 요청을 점검 안내로 응답 (해제 = MAINTENANCE_MODE=off)
app.use(maintenance);
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Mobile compatibility middleware
app.use((req, res, next) => {
  const userAgent = req.headers['user-agent'] || '';
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent);
  const isKakaoTalk = /KAKAOTALK/i.test(userAgent);
  
  // Set mobile-friendly headers
  if (isMobile || isKakaoTalk) {
    res.setHeader('X-UA-Compatible', 'IE=edge');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  
  next();
});

// Serve static files from client/public
app.use(express.static('client/public'));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

process.on('uncaughtException', (err) => {
  log(`CRASH - Uncaught Exception: ${err.message}\n${err.stack}`);
});

process.on('unhandledRejection', (reason) => {
  log(`CRASH - Unhandled Rejection: ${reason}`);
});

process.on('SIGHUP', () => {
  log('SIGHUP received - ignoring (PTY disconnect, keeping server alive)');
});

process.on('SIGTERM', () => {
  log('SIGTERM received - process being terminated by system');
  process.exit(0);
});

process.on('SIGINT', () => {
  log('SIGINT received');
  process.exit(0);
});

process.on('exit', (code) => {
  if (code !== 0) {
    log(`Process exiting with code: ${code}`);
  }
});

(async () => {
  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    res.status(status).json({ message });
    console.error("Express error:", err.message);
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    const { setupVite } = await import("./vite");
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const port = parseInt(process.env.PORT || '5000', 10);
  server.listen({
    port,
    host: "0.0.0.0",
  }, () => {
    log(`serving on port ${port}`);

    // 점검 모드일 때만, 우회 주소를 로그에 한 번 찍는다.
    // 사이트를 닫아 둔 채 라이브 결제를 검증하려면 이 주소로 들어와야 한다.
    const flag = (process.env.MAINTENANCE_MODE || "").trim().toLowerCase();
    const maintenanceOn = !(flag === "off" || flag === "false" || flag === "0");
    if (maintenanceOn) {
      const token = getPreviewToken();
      log(token ? `점검 모드 — 우회 주소: /?preview=${token}` : "점검 모드 — 우회 토큰 없음 (SESSION_SECRET 미설정)");
    }

    // 트레이닝 당일 오전 10시(KST) 참여 안내 리마인드
    startReminderScheduler();
    startUnpaidNudgeScheduler();
    // 오래된 미결제 정리(2차 안내 후 만료 표시)와 결제대기 급증 알림.
    startPaymentExpiryScheduler();
    startUnpaidAlertScheduler();
    // 과목 종료 시각에 만족도 설문 문자, 그리고 응답을 신청명단 시트로 적재.
    startSurveyScheduler();
    startSurveySyncScheduler();
  });

  setInterval(() => {
    const mem = process.memoryUsage();
    log(`heartbeat | rss:${Math.round(mem.rss/1024/1024)}MB heap:${Math.round(mem.heapUsed/1024/1024)}/${Math.round(mem.heapTotal/1024/1024)}MB`);
  }, 30000);
})();

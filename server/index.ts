import 'dotenv/config';
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic, log } from "./static-serve";

const app = express();
app.set('trust proxy', true);
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
  });

  setInterval(() => {
    const mem = process.memoryUsage();
    log(`heartbeat | rss:${Math.round(mem.rss/1024/1024)}MB heap:${Math.round(mem.heapUsed/1024/1024)}/${Math.round(mem.heapTotal/1024/1024)}MB`);
  }, 30000);
})();

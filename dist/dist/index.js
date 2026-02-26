var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path2 from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
var vite_config_default;
var init_vite_config = __esm({
  async "vite.config.ts"() {
    "use strict";
    vite_config_default = defineConfig({
      plugins: [
        react(),
        runtimeErrorOverlay(),
        ...process.env.NODE_ENV !== "production" && process.env.REPL_ID !== void 0 ? [
          await import("@replit/vite-plugin-cartographer").then(
            (m) => m.cartographer()
          )
        ] : []
      ],
      resolve: {
        alias: {
          "@": path2.resolve(import.meta.dirname, "client", "src"),
          "@shared": path2.resolve(import.meta.dirname, "shared"),
          "@assets": path2.resolve(import.meta.dirname, "attached_assets")
        }
      },
      root: path2.resolve(import.meta.dirname, "client"),
      build: {
        outDir: path2.resolve(import.meta.dirname, "dist/public"),
        emptyOutDir: true
      },
      server: {
        fs: {
          strict: true,
          deny: ["**/.*"]
        }
      }
    });
  }
});

// server/vite.ts
var vite_exports = {};
__export(vite_exports, {
  log: () => log2,
  serveStatic: () => serveStatic2,
  setupVite: () => setupVite
});
import express2 from "express";
import fs2 from "fs";
import path3 from "path";
import { createServer as createViteServer, createLogger } from "vite";
import { nanoid } from "nanoid";
function log2(message, source = "express") {
  const formattedTime = (/* @__PURE__ */ new Date()).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true
  });
  console.log(`${formattedTime} [${source}] ${message}`);
}
async function setupVite(app2, server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true
  };
  const vite = await createViteServer({
    ...vite_config_default,
    configFile: false,
    customLogger: {
      ...viteLogger,
      error: (msg, options) => {
        viteLogger.error(msg, options);
        process.exit(1);
      }
    },
    server: serverOptions,
    appType: "custom"
  });
  app2.use(vite.middlewares);
  app2.use("*", async (req, res, next) => {
    const url = req.originalUrl;
    try {
      const clientTemplate = path3.resolve(
        import.meta.dirname,
        "..",
        "client",
        "index.html"
      );
      let template = await fs2.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e);
      next(e);
    }
  });
}
function serveStatic2(app2) {
  const distPath = path3.resolve(import.meta.dirname, "public");
  if (!fs2.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
  }
  app2.use(express2.static(distPath));
  app2.use("*", (_req, res) => {
    res.sendFile(path3.resolve(distPath, "index.html"));
  });
}
var viteLogger;
var init_vite = __esm({
  async "server/vite.ts"() {
    "use strict";
    await init_vite_config();
    viteLogger = createLogger();
  }
});

// server/index.ts
import express3 from "express";

// server/routes.ts
import { createServer } from "http";

// server/services/google-sheets.ts
import { createSign } from "crypto";
var GOOGLE_SHEETS_API_KEY = process.env.GOOGLE_SHEETS_API_KEY || "";
var SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID || "";
var _cachedToken = null;
async function getServiceAccountAccessToken(scope) {
  const now = Math.floor(Date.now() / 1e3);
  if (_cachedToken && _cachedToken.expiresAt > now + 60) {
    return _cachedToken.token;
  }
  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!serviceAccountJson) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON not set");
  const credentials = JSON.parse(serviceAccountJson);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    iss: credentials.client_email,
    scope,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  })).toString("base64url");
  const signingInput = `${header}.${payload}`;
  const sign = createSign("RSA-SHA256");
  sign.update(signingInput);
  const signature = sign.sign(credentials.private_key, "base64url");
  const jwt = `${signingInput}.${signature}`;
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt
    })
  });
  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    throw new Error(`Token fetch failed: ${err}`);
  }
  const tokenData = await tokenRes.json();
  _cachedToken = { token: tokenData.access_token, expiresAt: now + tokenData.expires_in };
  return _cachedToken.token;
}
function formatPhoneNumber(phone) {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return phone;
}
var GoogleSheetsService = class {
  baseUrl = "https://sheets.googleapis.com/v4/spreadsheets";
  apiKey;
  spreadsheetId;
  secondarySpreadsheetId;
  cache = /* @__PURE__ */ new Map();
  cacheTimeout = 15e4;
  // 2.5분 캐시 (안전한 성능 최적화)
  constructor() {
    this.apiKey = GOOGLE_SHEETS_API_KEY;
    this.spreadsheetId = SPREADSHEET_ID;
    this.secondarySpreadsheetId = process.env.GOOGLE_SECONDARY_SPREADSHEET_ID || "";
    if (!this.apiKey) {
      console.error("\u274C GOOGLE_SHEETS_API_KEY \uD658\uACBD\uBCC0\uC218\uAC00 \uC124\uC815\uB418\uC9C0 \uC54A\uC558\uC2B5\uB2C8\uB2E4.");
    }
    if (!this.spreadsheetId) {
      console.error("\u274C GOOGLE_SPREADSHEET_ID \uD658\uACBD\uBCC0\uC218\uAC00 \uC124\uC815\uB418\uC9C0 \uC54A\uC558\uC2B5\uB2C8\uB2E4.");
    }
  }
  getCachedData(key) {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }
    return null;
  }
  setCachedData(key, data) {
    this.cache.set(key, { data, timestamp: Date.now() });
  }
  isConfigured() {
    return !!(this.apiKey && this.spreadsheetId);
  }
  isSecondarySheetConfigured() {
    return !!this.secondarySpreadsheetId;
  }
  async fetchProgramDescriptions() {
    const cacheKey = "program-descriptions";
    const cached = this.getCachedData(cacheKey);
    if (cached) return cached;
    const descriptionSpreadsheetId = process.env.GOOGLE_DESCRIPTION_SPREADSHEET_ID || "";
    try {
      const url = `${this.baseUrl}/${descriptionSpreadsheetId}/values/A1:Z1000?key=${this.apiKey}`;
      const response = await fetch(url);
      if (!response.ok) {
        console.error("Failed to fetch description data:", response.status, response.statusText);
        return {};
      }
      const data = await response.json();
      const rows = data.values || [];
      if (rows.length < 2) {
        console.warn("No description data found in spreadsheet");
        return {};
      }
      let headerRowIndex = 0;
      let titleIndex = -1;
      let descriptionIndex = -1;
      for (let r = 0; r < Math.min(rows.length, 5); r++) {
        const row = rows[r] || [];
        const ti = row.findIndex((h) => h?.includes("\uC81C\uBAA9") || h?.includes("\uACFC\uBAA9") || h?.includes("\uD504\uB85C\uADF8\uB7A8") || h?.includes("\uACFC\uC815") || h?.includes("\uC138\uC158") || h?.includes("LTT"));
        const di = row.findIndex((h) => h?.includes("\uC124\uBA85") || h?.includes("\uB0B4\uC6A9") || h?.includes("description") || h?.includes("\uC548\uB0B4"));
        if (ti !== -1 && di !== -1) {
          headerRowIndex = r;
          titleIndex = ti;
          descriptionIndex = di;
          break;
        }
      }
      if (titleIndex === -1 || descriptionIndex === -1) {
        return {};
      }
      const descriptions = {};
      for (let i = headerRowIndex + 1; i < rows.length; i++) {
        const row = rows[i];
        if (row && row[titleIndex] && row[descriptionIndex]) {
          const title = String(row[titleIndex]).trim();
          const description = String(row[descriptionIndex]).trim();
          if (title && description) {
            descriptions[title] = description;
          }
        }
      }
      this.setCachedData(cacheKey, descriptions);
      return descriptions;
    } catch (error) {
      console.error("Error fetching program descriptions:", error);
      return {};
    }
  }
  async fetchApplicationStatus() {
    const cacheKey = "applicationStatus";
    const cached = this.getCachedData(cacheKey);
    if (cached) {
      return cached;
    }
    const descriptionSpreadsheetId = process.env.GOOGLE_DESCRIPTION_SPREADSHEET_ID || "";
    try {
      const url = `${this.baseUrl}/${descriptionSpreadsheetId}/values/A1:Z1000?key=${this.apiKey}`;
      const response = await fetch(url);
      if (!response.ok) {
        console.error("Failed to fetch application status data:", response.status, response.statusText);
        return {};
      }
      const data = await response.json();
      const rows = data.values || [];
      if (rows.length < 2) {
        console.warn("No application status data found in spreadsheet");
        return {};
      }
      let headerRowIndex = 0;
      let titleIndex = -1;
      const statusIndex = 9;
      for (let r = 0; r < Math.min(rows.length, 5); r++) {
        const row = rows[r] || [];
        const ti = row.findIndex((h) => h?.includes("\uC81C\uBAA9") || h?.includes("\uACFC\uBAA9") || h?.includes("LT Training") || h?.includes("\uD504\uB85C\uADF8\uB7A8") || h?.includes("\uACFC\uC815") || h?.includes("\uC138\uC158") || h?.includes("LTT"));
        if (ti !== -1) {
          headerRowIndex = r;
          titleIndex = ti;
          break;
        }
      }
      const actualTitleIndex = titleIndex === -1 ? 3 : titleIndex;
      if (titleIndex === -1) {
        headerRowIndex = 0;
      }
      const applicationStatus = {};
      for (let i = headerRowIndex + 1; i < rows.length; i++) {
        const row = rows[i];
        if (row && row[actualTitleIndex]) {
          const title = String(row[actualTitleIndex]).trim();
          const status = row[statusIndex] ? String(row[statusIndex]).trim().toLowerCase() : "";
          if (title && title !== "\uACFC\uBAA9") {
            applicationStatus[title] = status !== "\uB9C8\uAC10";
          }
        }
      }
      this.setCachedData(cacheKey, applicationStatus);
      return applicationStatus;
    } catch (error) {
      console.error("Error fetching application status:", error);
      return {};
    }
  }
  getSheetInfo() {
    return {
      primary: this.spreadsheetId || "",
      secondary: this.secondarySpreadsheetId || void 0
    };
  }
  // Google Sheets에서 프로그램 데이터를 읽어올 때 사용할 범위 설정
  getSheetRange() {
    return "A1:Z1000";
  }
  parseKoreanDate(dateStr, timeStr) {
    if (!dateStr) return (/* @__PURE__ */ new Date()).toISOString();
    const dateMatch = dateStr.match(/(\d+)\/(\d+)/);
    if (dateMatch) {
      const month = parseInt(dateMatch[1]);
      const day = parseInt(dateMatch[2]);
      const year = 2026;
      const timeMatch = timeStr?.match(/(\d+):(\d+)/);
      const hours = timeMatch ? parseInt(timeMatch[1]) : 14;
      const minutes = timeMatch ? parseInt(timeMatch[2]) : 0;
      const date = new Date(year, month - 1, day, hours, minutes);
      return date.toISOString();
    }
    return (/* @__PURE__ */ new Date()).toISOString();
  }
  parseLocation(notes, title) {
    if (title && title.includes("\uD30C\uC6B4\uB370\uC774\uC158")) {
      return "\uC624\uD504\uB77C\uC778 : \uC2A4\uD398\uC774\uC2A4 \uC250\uC5B4 \uC0BC\uC131\uC810";
    }
    if (!notes) return "\uC628\uB77C\uC778 : \uAC15\uC758\uC2E4 \uC785\uC7A5 (1\uCC28, 2\uCC28 \uB9C1\uD06C \uB3D9\uC77C)";
    if (notes.includes("\uC624\uD504\uB77C\uC778")) {
      if (notes.includes("\uC2A4\uD398\uC774\uC2A4 \uC250\uC5B4 \uC0BC\uC131\uC810")) {
        return "\uC624\uD504\uB77C\uC778 : \uC2A4\uD398\uC774\uC2A4 \uC250\uC5B4 \uC0BC\uC131\uC810";
      }
      return "\uC624\uD504\uB77C\uC778 \uAD50\uC721";
    }
    return "\uC628\uB77C\uC778 : \uAC15\uC758\uC2E4 \uC785\uC7A5 (1\uCC28, 2\uCC28 \uB9C1\uD06C \uB3D9\uC77C)";
  }
  parseLocationFromData(locationData, title) {
    if (!locationData) {
      return "\uC628\uB77C\uC778 : \uAC15\uC758\uC2E4 \uC785\uC7A5 (1\uCC28, 2\uCC28 \uB9C1\uD06C \uB3D9\uC77C)";
    }
    if (title && title.includes("\uD30C\uC6B4\uB370\uC774\uC158")) {
      return "\uC624\uD504\uB77C\uC778 : \uC12C\uC720\uC13C\uD130 \uCEE8\uD37C\uB7F0\uC2A4\uD640";
    }
    if (locationData.includes("notion.so")) {
      return "\uC628\uB77C\uC778 : \uAC15\uC758\uC2E4 \uC785\uC7A5 (1\uCC28, 2\uCC28 \uB9C1\uD06C \uB3D9\uC77C)";
    }
    const cleanLocation = locationData.replace(/(https?:\/\/[^\s]+)/gi, "").trim();
    if (cleanLocation.includes("\uC624\uD504\uB77C\uC778") || cleanLocation.includes("\uC2A4\uD398\uC774\uC2A4 \uC250\uC5B4")) {
      if (cleanLocation.includes("\uC2A4\uD398\uC774\uC2A4 \uC250\uC5B4 \uC0BC\uC131\uC810") || cleanLocation.includes("\uC0BC\uC131\uC810")) {
        return "\uC624\uD504\uB77C\uC778 : \uC2A4\uD398\uC774\uC2A4 \uC250\uC5B4 \uC0BC\uC131\uC810";
      }
      return cleanLocation || "\uC624\uD504\uB77C\uC778 \uAD50\uC721";
    }
    if (cleanLocation.includes("\uC628\uB77C\uC778") || cleanLocation.includes("\uAC15\uC758\uC2E4")) {
      return cleanLocation || "\uC628\uB77C\uC778 : \uAC15\uC758\uC2E4 \uC785\uC7A5 (1\uCC28, 2\uCC28 \uB9C1\uD06C \uB3D9\uC77C)";
    }
    return cleanLocation || "\uC628\uB77C\uC778 : \uAC15\uC758\uC2E4 \uC785\uC7A5 (1\uCC28, 2\uCC28 \uB9C1\uD06C \uB3D9\uC77C)";
  }
  extractClassroomUrl(format) {
    if (!format) return "";
    const urlMatch = format.match(/(https?:\/\/[^\s]+)/i);
    if (urlMatch) {
      let url = urlMatch[1];
      url = url.replace(/[,\s\)]+$/, "");
      return url;
    }
    if (format.includes("\uC628\uB77C\uC778")) {
      return "https://bni-korea.zoom.us/classroom";
    }
    return "";
  }
  getTrainingType(subject) {
    if (!subject) return "foundation";
    const subjectLower = subject.toLowerCase();
    if (subjectLower.includes("\uBA58\uD1A0\uB9C1") || subjectLower.includes("mentor")) return "mentoring";
    if (subjectLower.includes("pr") || subjectLower.includes("\uD64D\uBCF4")) return "pr";
    if (subjectLower.includes("st") || subjectLower.includes("door") || subjectLower.includes("\uB3C4\uC5B4")) return "st-door";
    if (subjectLower.includes("\uC774\uBCA4\uD2B8") || subjectLower.includes("event")) return "event";
    if (subjectLower.includes("\uBA64\uBC84\uC2ED") || subjectLower.includes("member")) return "membership";
    if (subjectLower.includes("\uAD50\uC721") || subjectLower.includes("education")) return "education";
    if (subjectLower.includes("\uBC29\uBB38") || subjectLower.includes("visitor")) return "visitor";
    return "foundation";
  }
  async fetchSheetData(range) {
    if (!this.isConfigured()) {
      return [];
    }
    try {
      const encodedRange = encodeURIComponent(range);
      const url = `${this.baseUrl}/${this.spreadsheetId}/values/${encodedRange}?key=${this.apiKey}`;
      const response = await fetch(url);
      if (!response.ok) {
        const errorText = await response.text();
        console.error("Google Sheets API error:", response.status, errorText);
        throw new Error(`Google Sheets API error: ${response.status} ${response.statusText}`);
      }
      const data = await response.json();
      return data.values || [];
    } catch (error) {
      console.error("Failed to fetch Google Sheets data:", error);
      throw new Error("Google Sheets API connection failed. Please check your API key and spreadsheet ID.");
    }
  }
  async getTrainingPrograms() {
    try {
      const rows = await this.fetchSheetData("A1:Z1000");
      const dataRows = rows.slice(1);
      const paidApplications = dataRows.filter((row) => row[9] === "\uC644\uB8CC").length;
      const programCounts = {};
      dataRows.forEach((row) => {
        const programName = row[1];
        if (programName && row[9] === "\uC644\uB8CC") {
          programCounts[programName] = (programCounts[programName] || 0) + 1;
        }
      });
      const defaultPrograms = [
        {
          title: "LT Training: \uD30C\uC6B4\uB370\uC774\uC158",
          description: "BNI \uB124\uD2B8\uC6CC\uD0B9\uC758 \uAE30\uCD08\uB97C \uBC30\uC6B0\uB294 \uD30C\uC6B4\uB370\uC774\uC158 \uD2B8\uB808\uC774\uB2DD",
          date: "2026-09-02T14:00:00.000Z",
          location: "\uC628\uB77C\uC778 \uAD50\uC721",
          trainer: "BNI Korea",
          maxParticipants: 30,
          currentParticipants: programCounts["LT Training: \uD30C\uC6B4\uB370\uC774\uC158"] || 0,
          status: "upcoming",
          type: "foundation",
          paymentLink: "https://store.bnikorea.com/product/foundation-training",
          recordingLink: "",
          isOnline: true
        },
        {
          title: "LT Training: \uBA58\uD1A0\uB9C1 \uCF54\uB514\uB124\uC774\uD130",
          description: "\uD6A8\uACFC\uC801\uC778 \uBA58\uD1A0\uB9C1 \uAE30\uC220\uC744 \uBC30\uC6B0\uB294 \uC804\uBB38 \uD2B8\uB808\uC774\uB2DD",
          date: "2026-09-05T14:00:00.000Z",
          location: "\uC628\uB77C\uC778 \uAD50\uC721",
          trainer: "BNI Korea",
          maxParticipants: 30,
          currentParticipants: programCounts["LT Training: \uBA58\uD1A0\uB9C1 \uCF54\uB514\uB124\uC774\uD130"] || 0,
          status: "upcoming",
          type: "mentoring",
          paymentLink: "https://store.bnikorea.com/product/mentoring-training",
          recordingLink: "",
          isOnline: true
        }
      ];
      return defaultPrograms;
    } catch (error) {
      console.error("Failed to fetch training programs:", error);
      throw error;
    }
  }
  async getNotices() {
    try {
      return [
        {
          title: "\u{1F3AF} 2026 LTT \uD504\uB85C\uADF8\uB7A8 \uC624\uD508",
          content: "BNI Korea Leadership Training 2026\uC774 \uC2DC\uC791\uB429\uB2C8\uB2E4. \uC21C\uCC28\uC801\uC73C\uB85C \uC9C4\uD589\uB418\uB294 \uC138\uC158\uC5D0 \uCC38\uC5EC\uD558\uC138\uC694!",
          priority: 1,
          isActive: true
        },
        {
          title: "\u{1F4C5} \uC138\uC158\uBCC4 \uC77C\uC815 \uD655\uC778",
          content: "\uAC01 \uC138\uC158\uC740 9\uC6D4 2\uC77C\uBD80\uD130 9\uC6D4 19\uC77C\uAE4C\uC9C0 \uC9C4\uD589\uB418\uBA70, \uC628\uB77C\uC778\uACFC \uC624\uD504\uB77C\uC778 \uC138\uC158\uC774 \uD63C\uD569\uB418\uC5B4 \uC788\uC2B5\uB2C8\uB2E4.",
          priority: 2,
          isActive: true
        },
        {
          title: "\u{1F4B3} \uACB0\uC81C \uC548\uB0B4",
          content: "\uAC01 \uC138\uC158\uBCC4 \uAC1C\uBCC4 \uACB0\uC81C \uB610\uB294 \uC804\uCCB4 \uC138\uC158 \uC77C\uAD04 \uACB0\uC81C\uAC00 \uAC00\uB2A5\uD569\uB2C8\uB2E4. BNI Korea Store\uC5D0\uC11C \uACB0\uC81C\uD574\uC8FC\uC138\uC694.",
          priority: 3,
          isActive: true
        }
      ];
    } catch (error) {
      console.error("Failed to fetch notices:", error);
      throw error;
    }
  }
  // Google Sheets에 직접 데이터 추가 (Service Account 인증 사용)
  async addApplicationToSheet(applicationData) {
    const now = /* @__PURE__ */ new Date();
    const koreaTime = new Intl.DateTimeFormat("ko-KR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZone: "Asia/Seoul"
    }).format(now);
    const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    if (!serviceAccountJson) {
      return;
    }
    try {
      const token = await getServiceAccountAccessToken("https://www.googleapis.com/auth/spreadsheets");
      const now2 = /* @__PURE__ */ new Date();
      const submittedAt = new Intl.DateTimeFormat("ko-KR", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        timeZone: "Asia/Seoul"
      }).format(now2);
      const values = [[
        submittedAt,
        applicationData.programTitle,
        applicationData.region,
        applicationData.chapter,
        applicationData.name,
        formatPhoneNumber(applicationData.phone),
        applicationData.email,
        applicationData.participationType,
        applicationData.notes || ""
      ]];
      const range = encodeURIComponent("'2026 LTT \uC2E0\uCCAD\uBA85\uB2E8'!A:I");
      const url = `${this.baseUrl}/${this.spreadsheetId}/values/${range}:append?valueInputOption=RAW`;
      await fetch(url, {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ values })
      });
    } catch (error) {
      console.error("\u274C Google Sheets \uC800\uC7A5 \uC2E4\uD328:", error);
    }
  }
  async getAllData() {
    try {
      const [programs, notices2] = await Promise.all([
        this.getTrainingPrograms(),
        this.getNotices()
      ]);
      return { programs, notices: notices2 };
    } catch (error) {
      console.error("Failed to fetch all Google Sheets data:", error);
      return { programs: [], notices: [] };
    }
  }
  getNotionLink(title) {
    const notionLinks = {
      "LT Training: \uD30C\uC6B4\uB370\uC774\uC158 T.": "https://www.notion.so/bnikorea-joy/LT-T_-e464035f91024e29b5fceb805b92ce2a?source=copy_link",
      "LT Training: \uBA64\uBC84\uC2ED \uC704\uC6D0\uD68C T.": "https://www.notion.so/bnikorea-joy/LT-T_-a8f5e312d6de4593aa79fcb2d260ebe6?source=copy_link",
      "LT Training: PR \uCF54\uB514\uB124\uC774\uD130T.": "https://www.notion.so/bnikorea-joy/LT-PR-T_-cba1fddc755d46c8a16631fde26bbb2f?source=copy_link",
      "LT Training: \uAD50\uC721 \uCF54\uB514\uB124\uC774\uD130 T.": "https://www.notion.so/bnikorea-joy/LT-T_-e1a5b3d5b6b648a789aad93f0105cfc0?source=copy_link",
      "LT Training: \uC131\uC7A5 \uCF54\uB514\uB124\uC774\uD130 T.": "https://www.notion.so/bnikorea-joy/LT-T_-7f274bdd80474ddea3548d70a87ed56f?source=copy_link",
      "LT Training: ST T.": "https://www.notion.so/bnikorea-joy/LT-ST-T_-7137c4231d6d497ba2c28f1ba0af282b?source=copy_link",
      "LT Training: \uBE44\uC9C0\uD130 \uD638\uC2A4\uD2B8 T.": "https://www.notion.so/bnikorea-joy/LT-T_-2b4192ea14d941489753208b4e02d0f8?source=copy_link",
      "LT Training: \uC774\uBCA4\uD2B8 \uCF54\uB514\uB124\uC774\uD130 T.": "https://www.notion.so/bnikorea-joy/LT-T_-fc56de81e616415b8efcd299b66ebdae?source=copy_link",
      "LT Training: \uBA58\uD1A0\uB9C1 \uCF54\uB514\uB124\uC774\uD130 T.": "https://www.notion.so/bnikorea-joy/LT-T_-d8bea5f2f98140eeaa2cc6dc6c83ecfe?source=copy_link"
    };
    return notionLinks[title] || "";
  }
  async checkDuplicateApplication(programTitle, phone, name) {
    if (!this.spreadsheetId) return false;
    try {
      const token = await getServiceAccountAccessToken("https://www.googleapis.com/auth/spreadsheets.readonly");
      const range = encodeURIComponent("'2026 LTT \uC2E0\uCCAD\uBA85\uB2E8'!A:J");
      const url = `${this.baseUrl}/${this.spreadsheetId}/values/${range}`;
      const response = await fetch(url, {
        headers: { "Authorization": `Bearer ${token}` }
      });
      if (!response.ok) {
        console.error("\uC911\uBCF5 \uD655\uC778 API \uC624\uB958:", response.status);
        return false;
      }
      const data = await response.json();
      const rows = data.values || [];
      const normalizedPhone = phone.replace(/\D/g, "");
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const rowProgram = row[1] || "";
        const rowPhone = (row[5] || "").replace(/\D/g, "");
        if (rowProgram === programTitle && normalizedPhone && rowPhone === normalizedPhone) {
          return true;
        }
      }
      return false;
    } catch (error) {
      console.error("\uC911\uBCF5 \uD655\uC778 \uC2E4\uD328 (\uC2E0\uCCAD \uACC4\uC18D \uC9C4\uD589):", error);
      return false;
    }
  }
  async checkBulkDuplicates(applications2) {
    if (!this.spreadsheetId) return [];
    try {
      const token = await getServiceAccountAccessToken("https://www.googleapis.com/auth/spreadsheets.readonly");
      const range = encodeURIComponent("'2026 LTT \uC2E0\uCCAD\uBA85\uB2E8'!A:J");
      const url = `${this.baseUrl}/${this.spreadsheetId}/values/${range}`;
      const response = await fetch(url, {
        headers: { "Authorization": `Bearer ${token}` }
      });
      if (!response.ok) {
        console.error("\uC77C\uAD04 \uC911\uBCF5 \uD655\uC778 API \uC624\uB958:", response.status);
        return [];
      }
      const data = await response.json();
      const rows = data.values || [];
      const existingEntries = /* @__PURE__ */ new Set();
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const rowProgram = row[1] || "";
        const rowPhone = (row[5] || "").replace(/\D/g, "");
        if (rowProgram && rowPhone) {
          existingEntries.add(`${rowProgram}|${rowPhone}`);
        }
      }
      const duplicates = [];
      for (const app2 of applications2) {
        const normalizedPhone = app2.phone.replace(/\D/g, "");
        const key = `${app2.programTitle}|${normalizedPhone}`;
        if (existingEntries.has(key)) {
          duplicates.push({ name: app2.name, programTitle: app2.programTitle, phone: app2.phone });
        }
      }
      return duplicates;
    } catch (error) {
      console.error("\uC77C\uAD04 \uC911\uBCF5 \uD655\uC778 \uC2E4\uD328 (\uC2E0\uCCAD \uACC4\uC18D \uC9C4\uD589):", error);
      return [];
    }
  }
  // 실제 신청 데이터를 Google Sheets에서 가져오는 메서드
  async getApplicationsFromSheet() {
    if (!this.spreadsheetId) {
      return [];
    }
    try {
      const rows = await this.fetchSheetData("A2:J1000");
      if (!rows || rows.length === 0) {
        return [];
      }
      const applications2 = rows.filter((row) => row && row.length > 1 && row[1]).map((row, index) => {
        const [submittedAt, programTitle, region, chapter, name, phone, email, participationType, notes, paymentStatus] = row;
        return {
          id: `app-${index + 1}`,
          programTitle: programTitle || "",
          region: region || "",
          chapter: chapter || "",
          name: name || "",
          phone: phone || "",
          email: email || "",
          participationType: participationType || "",
          notes: notes || "",
          paymentStatus: paymentStatus || "",
          isPaid: paymentStatus === "\uC644\uB8CC",
          createdAt: submittedAt || (/* @__PURE__ */ new Date()).toISOString()
        };
      });
      return applications2;
    } catch (error) {
      console.error("\uC2E0\uCCAD \uB370\uC774\uD130 \uAC00\uC838\uC624\uAE30 \uC2E4\uD328:", error);
      return [];
    }
  }
  async getLocationData() {
    const cacheKey = "location-data";
    const cached = this.getCachedData(cacheKey);
    if (cached) return cached;
    const locationSheetId = this.secondarySpreadsheetId || "1ksNpdM_3AZLyMvmSXG8GLf_dZMxcxXvx5PHNOrKujH8";
    try {
      const response = await fetch(`${this.baseUrl}/${locationSheetId}/values/'LTT \uC138\uC158\uB4F1\uB85D'!A1:I100?key=${this.apiKey}`);
      if (!response.ok) {
        console.error(`\uC704\uCE58 \uB370\uC774\uD130 \uC2DC\uD2B8 \uC811\uADFC \uC2E4\uD328: ${response.status}`);
        return {};
      }
      const data = await response.json();
      const rows = data.values;
      if (!rows || rows.length < 2) {
        return {};
      }
      const locationData = {};
      for (let i = 2; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length < 4) continue;
        const title = row[3] || "";
        const location = row[8] || "";
        if (title && location) {
          locationData[title] = location;
        }
      }
      this.setCachedData(cacheKey, locationData);
      return locationData;
    } catch (error) {
      console.error("\uC704\uCE58 \uB370\uC774\uD130 \uAC00\uC838\uC624\uAE30 \uC2E4\uD328:", error);
      return {};
    }
  }
  async getSecondarySheetPrograms() {
    const cacheKey = "secondary-sheet-programs";
    const cached = this.getCachedData(cacheKey);
    if (cached) return cached;
    if (!this.secondarySpreadsheetId) {
      throw new Error("Secondary spreadsheet not configured");
    }
    try {
      const [programResponse, descriptions, locationData] = await Promise.all([
        fetch(`${this.baseUrl}/${this.secondarySpreadsheetId}/values/'LTT \uC138\uC158\uB4F1\uB85D'!A1:Z100?key=${this.apiKey}`),
        this.fetchProgramDescriptions(),
        this.getLocationData()
      ]);
      if (!programResponse.ok) {
        throw new Error(`HTTP error! status: ${programResponse.status}`);
      }
      const data = await programResponse.json();
      const rows = data.values;
      if (!rows || rows.length < 2) {
        return [];
      }
      const headerI1Value = rows[0] && rows[0][8] ? rows[0][8] : "";
      const programs = [];
      for (let i = 2; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length < 4 || !row[0] || !row[3]) continue;
        const title = row[3] || "";
        const venueLink = row[7] || "";
        const onlineLink = row[8] || "";
        const program = {
          id: `secondary-${i}`,
          sessionNumber: row[0] || "",
          date: row[1] || "",
          time: row[2] || "",
          title,
          instructor: row[4] || "",
          description: descriptions[title] || row[5] || "",
          storeUrl: row[6] || "",
          format: venueLink ? "\uC624\uD504\uB77C\uC778" : "\uC628\uB77C\uC778",
          isAvailable: true,
          maxParticipants: 50,
          currentParticipants: 0,
          formattedDate: this.parseKoreanDate(row[1], row[2]),
          location: this.parseLocationFromData(venueLink || onlineLink, title),
          venueUrl: venueLink || "",
          classroomUrl: onlineLink || "",
          notionUrl: this.getNotionLink(title)
        };
        programs.push(program);
      }
      this.setCachedData(cacheKey, programs);
      return programs;
    } catch (error) {
      console.error("\uB450 \uBC88\uC9F8 \uC2DC\uD2B8 \uB370\uC774\uD130 \uAC00\uC838\uC624\uAE30 \uC2E4\uD328:", error);
      return [];
    }
  }
  async submitApplication(applicationData) {
    return true;
  }
  async bulkSubmitApplications(applications2) {
    if (!this.isConfigured()) {
      return;
    }
    try {
      const now = /* @__PURE__ */ new Date();
      const koreaTime = new Intl.DateTimeFormat("ko-KR", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        timeZone: "Asia/Seoul"
      }).format(now);
      const values = applications2.map((app2) => [
        koreaTime,
        // A열: 신청일시
        app2.programTitle,
        // B열: 프로그램명
        app2.name,
        // C열: 이름
        formatPhoneNumber(app2.phone),
        // D열: 연락처
        app2.email,
        // E열: 이메일
        app2.chapter || "",
        // F열: 소속 챕터
        app2.trainingType === "live" ? "\uC2E4\uC2DC\uAC04 \uAC15\uC758 \uCC38\uC5EC" : "\uB179\uD654\uBCF8 \uC2DC\uCCAD",
        // G열: 참여 방식
        app2.notes || "",
        // H열: 특이사항
        "\uBBF8\uB0A9"
        // I열: 결제상태 (기본값: 미납)
      ]);
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/2026 LTT \uC2E0\uCCAD\uBA85\uB2E8:append?valueInputOption=RAW&key=${this.apiKey}`;
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          values
        })
      });
      if (!response.ok) {
        const errorText = await response.text();
        console.error("Google Sheets API error:", errorText);
        throw new Error(`Google Sheets \uC77C\uAD04 \uC5C5\uB85C\uB4DC \uC2E4\uD328: ${response.status}`);
      }
      const result = await response.json();
    } catch (error) {
      console.error("Failed to bulk submit applications:", error);
      throw new Error("Google Sheets \uC77C\uAD04 \uC5F0\uB3D9 \uC2E4\uD328");
    }
  }
  // 결제완료된 신청자 수를 프로그램별로 카운트
  async getPaidApplicationCounts() {
    if (!this.isConfigured()) {
      return {};
    }
    try {
      const url = `${this.baseUrl}/${this.spreadsheetId}/values/2026 LTT \uC2E0\uCCAD\uBA85\uB2E8?key=${this.apiKey}`;
      const response = await fetch(url);
      if (!response.ok) {
        console.error("Failed to fetch application data for counting");
        return {};
      }
      const data = await response.json();
      const rows = data.values || [];
      const dataRows = rows.slice(1);
      const counts = {};
      dataRows.forEach((row) => {
        if (row.length >= 10) {
          const programTitle = row[1];
          const paymentStatus = row[9];
          if (paymentStatus === "\uC644\uB8CC") {
            counts[programTitle] = (counts[programTitle] || 0) + 1;
          }
        }
      });
      return counts;
    } catch (error) {
      console.error("Failed to get paid application counts:", error);
      return {};
    }
  }
  // 대시보드용 신청현황 데이터 가져오기
  async getDashboardData() {
    if (!this.isConfigured()) {
      return {
        totalApplications: 0,
        paidApplications: 0,
        pendingApplications: 0,
        programStats: {},
        regionStats: {},
        chapterStats: {},
        recentApplications: []
      };
    }
    try {
      const url = `${this.baseUrl}/${this.spreadsheetId}/values/'2026 LTT \uC2E0\uCCAD\uBA85\uB2E8'!A:J?key=${this.apiKey}`;
      const response = await fetch(url);
      if (!response.ok) {
        console.error("Failed to fetch dashboard data");
        return {
          totalApplications: 0,
          paidApplications: 0,
          pendingApplications: 0,
          programStats: {},
          regionStats: {},
          chapterStats: {},
          recentApplications: []
        };
      }
      const data = await response.json();
      const rows = data.values || [];
      if (rows.length < 2) {
        return {
          totalApplications: 0,
          paidApplications: 0,
          pendingApplications: 0,
          programStats: {},
          regionStats: {},
          chapterStats: {},
          recentApplications: []
        };
      }
      const dataRows = rows.slice(1);
      let totalApplications = 0;
      let paidApplications = 0;
      let pendingApplications = 0;
      const programStats = {};
      const regionStats = {};
      const chapterStats = {};
      const recentApplications = [];
      const normalizeCourseName = (courseName) => {
        if (!courseName) return courseName;
        const formalNames = [
          "LTT : \uD30C\uC6B4\uB370\uC774\uC158 T.",
          "LTT : \uBA64\uBC84\uC2ED \uC704\uC6D0\uD68C T.",
          "LTT : PR \uCF54\uB514\uB124\uC774\uD130T.",
          "LTT : \uAD50\uC721 \uCF54\uB514\uB124\uC774\uD130 T.",
          "LTT : \uC131\uC7A5 \uCF54\uB514\uB124\uC774\uD130 T.",
          "LTT : ST T.",
          "LTT : \uBE44\uC9C0\uD130 \uD638\uC2A4\uD2B8 T.",
          "LTT : \uC774\uBCA4\uD2B8 \uCF54\uB514\uB124\uC774\uD130 T.",
          "LTT : \uBA58\uD1A0\uB9C1 \uCF54\uB514\uB124\uC774\uD130 T."
        ];
        if (formalNames.includes(courseName)) {
          return courseName;
        }
        if (courseName === "LTT : ST & \uB3C4\uC5B4\uD37C\uC2A8 T.") {
          return "LTT : ST T.";
        }
        const lowerCourseName = courseName.toLowerCase();
        if (lowerCourseName.includes("\uD30C\uC6B4\uB370\uC774\uC158") || lowerCourseName.includes("foundation")) {
          return "LTT : \uD30C\uC6B4\uB370\uC774\uC158 T.";
        }
        if (lowerCourseName.includes("\uBA64\uBC84\uC2ED") && lowerCourseName.includes("\uC704\uC6D0\uD68C")) {
          return "LTT : \uBA64\uBC84\uC2ED \uC704\uC6D0\uD68C T.";
        }
        if ((lowerCourseName.includes("pr") || lowerCourseName.includes("\uD53C\uC54C")) && lowerCourseName.includes("\uCF54\uB514")) {
          return "LTT : PR \uCF54\uB514\uB124\uC774\uD130T.";
        }
        if (lowerCourseName.includes("\uAD50\uC721") && lowerCourseName.includes("\uCF54\uB514")) {
          return "LTT : \uAD50\uC721 \uCF54\uB514\uB124\uC774\uD130 T.";
        }
        if (lowerCourseName.includes("\uC131\uC7A5") && lowerCourseName.includes("\uCF54\uB514")) {
          return "LTT : \uC131\uC7A5 \uCF54\uB514\uB124\uC774\uD130 T.";
        }
        if (lowerCourseName.includes("\uB3C4\uC5B4\uD37C\uC2A8") || lowerCourseName.includes("st") && !lowerCourseName.includes("\uD638\uC2A4\uD2B8")) {
          return "LTT : ST T.";
        }
        if (lowerCourseName.includes("\uBE44\uC9C0\uD130")) {
          return "LTT : \uBE44\uC9C0\uD130 \uD638\uC2A4\uD2B8 T.";
        }
        if (lowerCourseName.includes("\uC774\uBCA4\uD2B8") && lowerCourseName.includes("\uCF54\uB514")) {
          return "LTT : \uC774\uBCA4\uD2B8 \uCF54\uB514\uB124\uC774\uD130 T.";
        }
        if (lowerCourseName.includes("\uBA58\uD1A0\uB9C1") && lowerCourseName.includes("\uCF54\uB514") && !lowerCourseName.includes("\uACE0\uC591") && !lowerCourseName.includes("\uAC15\uB0A8") && !lowerCourseName.includes("\uC1A1\uD30C") && !lowerCourseName.includes("\uC778\uCC9C")) {
          return "LTT : \uBA58\uD1A0\uB9C1 \uCF54\uB514\uB124\uC774\uD130 T.";
        }
        const courseNameMap = {
          "\uD30C\uC6B4\uB370\uC774\uC158": "LTT : \uD30C\uC6B4\uB370\uC774\uC158 T.",
          "\uD30C\uC6B4\uB370\uC774\uC158 T.": "LTT : \uD30C\uC6B4\uB370\uC774\uC158 T.",
          "\uD30C\uC6B4\uB370\uC774\uC158\uD2B8\uB808\uC774\uB2DD": "LTT : \uD30C\uC6B4\uB370\uC774\uC158 T.",
          "\uD30C\uC6B4\uB370\uC774\uC158 \uD2B8\uB808\uC774\uB2DD": "LTT : \uD30C\uC6B4\uB370\uC774\uC158 T.",
          "\uBA64\uBC84\uC2ED\uC704\uC6D0\uD68C": "LTT : \uBA64\uBC84\uC2ED \uC704\uC6D0\uD68C T.",
          "\uBA64\uBC84\uC2ED \uC704\uC6D0\uD68C": "LTT : \uBA64\uBC84\uC2ED \uC704\uC6D0\uD68C T.",
          "\uBA64\uBC84\uC2ED \uC704\uC6D0\uD68C T.": "LTT : \uBA64\uBC84\uC2ED \uC704\uC6D0\uD68C T.",
          "PR\uCF54\uB514": "LTT : PR \uCF54\uB514\uB124\uC774\uD130T.",
          "PR \uCF54\uB514": "LTT : PR \uCF54\uB514\uB124\uC774\uD130T.",
          "PR\uCF54\uB514\uB124\uC774\uD130": "LTT : PR \uCF54\uB514\uB124\uC774\uD130T.",
          "PR \uCF54\uB514\uB124\uC774\uD130": "LTT : PR \uCF54\uB514\uB124\uC774\uD130T.",
          "PR \uCF54\uB514\uB124\uC774\uD130T.": "LTT : PR \uCF54\uB514\uB124\uC774\uD130T.",
          "\uAD50\uC721\uCF54\uB514\uB124\uC774\uD130": "LTT : \uAD50\uC721 \uCF54\uB514\uB124\uC774\uD130 T.",
          "\uAD50\uC721 \uCF54\uB514\uB124\uC774\uD130": "LTT : \uAD50\uC721 \uCF54\uB514\uB124\uC774\uD130 T.",
          "\uAD50\uC721 \uCF54\uB514\uB124\uC774\uD130 T.": "LTT : \uAD50\uC721 \uCF54\uB514\uB124\uC774\uD130 T.",
          "\uC131\uC7A5\uCF54\uB514\uB124\uC774\uD130": "LTT : \uC131\uC7A5 \uCF54\uB514\uB124\uC774\uD130 T.",
          "\uC131\uC7A5 \uCF54\uB514\uB124\uC774\uD130": "LTT : \uC131\uC7A5 \uCF54\uB514\uB124\uC774\uD130 T.",
          "ST\uB3C4\uC5B4\uD37C\uC2A8": "LTT : ST T.",
          "ST & \uB3C4\uC5B4\uD37C\uC2A8": "LTT : ST T.",
          "ST": "LTT : ST T.",
          "ST T.": "LTT : ST T.",
          "ST & \uB3C4\uC5B4\uD37C\uC2A8 T.": "LTT : ST T.",
          "\uBE44\uC9C0\uD130\uD638\uC2A4\uD2B8": "LTT : \uBE44\uC9C0\uD130 \uD638\uC2A4\uD2B8 T.",
          "\uBE44\uC9C0\uD130 \uD638\uC2A4\uD2B8": "LTT : \uBE44\uC9C0\uD130 \uD638\uC2A4\uD2B8 T.",
          "\uC774\uBCA4\uD2B8\uCF54\uB514\uB124\uC774\uD130": "LTT : \uC774\uBCA4\uD2B8 \uCF54\uB514\uB124\uC774\uD130 T.",
          "\uC774\uBCA4\uD2B8 \uCF54\uB514\uB124\uC774\uD130": "LTT : \uC774\uBCA4\uD2B8 \uCF54\uB514\uB124\uC774\uD130 T.",
          "\uBA58\uD1A0\uB9C1\uCF54\uB514\uB124\uC774\uD130": "LTT : \uBA58\uD1A0\uB9C1 \uCF54\uB514\uB124\uC774\uD130 T.",
          "\uBA58\uD1A0\uB9C1 \uCF54\uB514\uB124\uC774\uD130": "LTT : \uBA58\uD1A0\uB9C1 \uCF54\uB514\uB124\uC774\uD130 T."
        };
        return courseNameMap[courseName] || courseName;
      };
      try {
        const allPrograms = await this.getSecondarySheetPrograms();
        allPrograms.forEach((program) => {
          programStats[program.title] = { total: 0, paid: 0, pending: 0 };
        });
      } catch (error) {
        console.error("Failed to fetch all programs for dashboard:", error);
        const defaultPrograms = [
          "LTT : \uD30C\uC6B4\uB370\uC774\uC158 T.",
          "LTT : \uBA64\uBC84\uC2ED \uC704\uC6D0\uD68C T.",
          "LTT : PR \uCF54\uB514\uB124\uC774\uD130T.",
          "LTT : \uAD50\uC721 \uCF54\uB514\uB124\uC774\uD130 T.",
          "LTT : \uC131\uC7A5 \uCF54\uB514\uB124\uC774\uD130 T.",
          "LTT : ST T.",
          "LTT : \uBE44\uC9C0\uD130 \uD638\uC2A4\uD2B8 T.",
          "LTT : \uC774\uBCA4\uD2B8 \uCF54\uB514\uB124\uC774\uD130 T.",
          "LTT : \uBA58\uD1A0\uB9C1 \uCF54\uB514\uB124\uC774\uD130 T."
        ];
        defaultPrograms.forEach((program) => {
          programStats[program] = { total: 0, paid: 0, pending: 0 };
        });
      }
      dataRows.forEach((row, index) => {
        if (row.length >= 5) {
          const submittedAt = row[0] || "";
          const rawProgram = row[1] || "\uBBF8\uC9C0\uC815";
          const program = normalizeCourseName(rawProgram);
          const region = row[2] || "\uBBF8\uC9C0\uC815";
          const chapter = row[3] || "\uBBF8\uC9C0\uC815";
          const name = row[4] || "";
          const phone = row[5] || "";
          const email = row[6] || "";
          const participationType = row[7] || "";
          const notes = row[8] || "";
          const paymentStatus = row[9] || "\uB300\uAE30";
          totalApplications++;
          const isPaid = paymentStatus === "\uC644\uB8CC" || paymentStatus === "\uACB0\uC81C\uC644\uB8CC";
          if (isPaid) {
            paidApplications++;
          } else {
            pendingApplications++;
          }
          if (!programStats[program]) {
            programStats[program] = { total: 0, paid: 0, pending: 0 };
          }
          programStats[program].total++;
          if (isPaid) {
            programStats[program].paid++;
          } else {
            programStats[program].pending++;
          }
          if (!regionStats[region]) {
            regionStats[region] = { total: 0, paid: 0, pending: 0 };
          }
          regionStats[region].total++;
          if (isPaid) {
            regionStats[region].paid++;
          } else {
            regionStats[region].pending++;
          }
          if (!chapterStats[chapter]) {
            chapterStats[chapter] = { total: 0, paid: 0, pending: 0 };
          }
          chapterStats[chapter].total++;
          if (isPaid) {
            chapterStats[chapter].paid++;
          } else {
            chapterStats[chapter].pending++;
          }
          if (recentApplications.length < 10) {
            recentApplications.push({
              program,
              // 이미 normalizeCourseName으로 변환된 정식 과목명
              region,
              chapter,
              name,
              phone,
              email,
              participationType,
              paymentStatus,
              rowIndex: index + 2
              // 시트에서 실제 행 번호 (헤더 포함)
            });
          }
        }
      });
      const consolidatedProgramStats = {};
      const formalCourseNames = [
        "LTT : \uD30C\uC6B4\uB370\uC774\uC158 T.",
        "LTT : \uBA64\uBC84\uC2ED \uC704\uC6D0\uD68C T.",
        "LTT : PR \uCF54\uB514\uB124\uC774\uD130T.",
        "LTT : \uAD50\uC721 \uCF54\uB514\uB124\uC774\uD130 T.",
        "LTT : \uC131\uC7A5 \uCF54\uB514\uB124\uC774\uD130 T.",
        "LTT : ST T.",
        "LTT : \uBE44\uC9C0\uD130 \uD638\uC2A4\uD2B8 T.",
        "LTT : \uC774\uBCA4\uD2B8 \uCF54\uB514\uB124\uC774\uD130 T.",
        "LTT : \uBA58\uD1A0\uB9C1 \uCF54\uB514\uB124\uC774\uD130 T."
      ];
      formalCourseNames.forEach((courseName) => {
        consolidatedProgramStats[courseName] = { total: 0, paid: 0, pending: 0 };
      });
      Object.entries(programStats).forEach(([courseName, stats]) => {
        const normalizedName = normalizeCourseName(courseName);
        if (consolidatedProgramStats[normalizedName]) {
          consolidatedProgramStats[normalizedName].total += stats.total;
          consolidatedProgramStats[normalizedName].paid += stats.paid;
          consolidatedProgramStats[normalizedName].pending += stats.pending;
        } else if (formalCourseNames.includes(normalizedName)) {
          consolidatedProgramStats[normalizedName] = { ...stats };
        }
      });
      return {
        totalApplications,
        paidApplications,
        pendingApplications,
        programStats: consolidatedProgramStats,
        // 통합된 통계 사용
        regionStats,
        chapterStats,
        recentApplications: recentApplications.reverse()
        // 최신순으로 정렬
      };
    } catch (error) {
      console.error("Failed to fetch dashboard data:", error);
      return {
        totalApplications: 0,
        paidApplications: 0,
        pendingApplications: 0,
        programStats: {},
        regionStats: {},
        chapterStats: {},
        recentApplications: []
      };
    }
  }
  // 결제완료된 신청자 수 조회 (I열에서 "완료" 상태 카운트)
  async getCompletedApplicationsCount(programTitle) {
    const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    if (!serviceAccountJson) {
      return 0;
    }
    try {
      const token = await getServiceAccountAccessToken("https://www.googleapis.com/auth/spreadsheets.readonly");
      const url = `${this.baseUrl}/${this.spreadsheetId}/values/'2026 LTT \uC2E0\uCCAD\uBA85\uB2E8'!A:J`;
      const response = await fetch(url, {
        headers: { "Authorization": `Bearer ${token}` }
      });
      if (!response.ok) throw new Error(`Sheets API error: ${response.status}`);
      const data = await response.json();
      const rows = data.values || [];
      let count = 0;
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const courseName = row[1] || "";
        const paymentStatus = row[9] || "";
        if (courseName === programTitle && paymentStatus === "\uC644\uB8CC") {
          count++;
        }
      }
      return count;
    } catch (error) {
      console.error("Failed to get completed applications count:", error);
      return 0;
    }
  }
  // 모든 프로그램의 결제완료 신청자 수 조회
  async getAllProgramsCompletedCounts() {
    const cacheKey = "completed-counts";
    const cached = this.getCachedData(cacheKey);
    if (cached) return cached;
    try {
      const token = await getServiceAccountAccessToken("https://www.googleapis.com/auth/spreadsheets.readonly");
      const url = `${this.baseUrl}/${this.spreadsheetId}/values/'2026 LTT \uC2E0\uCCAD\uBA85\uB2E8'!A:J`;
      const response = await fetch(url, {
        headers: { "Authorization": `Bearer ${token}` }
      });
      if (!response.ok) throw new Error(`Sheets API error: ${response.status}`);
      const data = await response.json();
      const rows = data.values || [];
      const counts = {};
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const courseName = row[1] || "";
        const paymentStatus = row[9] || "";
        if (courseName && paymentStatus === "\uC644\uB8CC") {
          counts[courseName] = (counts[courseName] || 0) + 1;
        }
      }
      this.setCachedData(cacheKey, counts);
      return counts;
    } catch (error) {
      console.error("Failed to get all programs completed counts:", error);
      return {};
    }
  }
};
var googleSheetsService = new GoogleSheetsService();

// server/storage.ts
import { randomUUID } from "crypto";
var MemStorage = class {
  applications;
  constructor() {
    this.applications = /* @__PURE__ */ new Map();
  }
  async getTrainingPrograms() {
    try {
      console.log("Fetching programs from Google Sheets...");
      const sheetsData = await googleSheetsService.getTrainingPrograms();
      const paidCounts = await googleSheetsService.getPaidApplicationCounts();
      console.log("Google Sheets data received:", sheetsData.length, "programs");
      const programs = sheetsData.map((program) => ({
        id: randomUUID(),
        title: program.title,
        description: program.description,
        date: new Date(program.date),
        location: program.location,
        trainer: program.trainer,
        maxParticipants: program.maxParticipants,
        currentParticipants: paidCounts[program.title] || 0,
        // 결제완료된 신청자 수로 업데이트
        status: program.status,
        type: program.type,
        paymentLink: program.paymentLink || null,
        recordingLink: program.recordingLink || null,
        isOnline: program.isOnline,
        createdAt: /* @__PURE__ */ new Date(),
        updatedAt: /* @__PURE__ */ new Date()
      }));
      if (programs.length > 0) {
        return programs;
      } else {
        return this.getTestProgramsWithPaidCounts(paidCounts);
      }
    } catch (error) {
      console.error("Failed to fetch training programs:", error);
      return this.getTestPrograms();
    }
  }
  getTestProgramsWithPaidCounts(paidCounts) {
    const testPrograms = this.getTestPrograms();
    return testPrograms.map((program) => ({
      ...program,
      currentParticipants: paidCounts[program.title] || program.currentParticipants
    }));
  }
  getTestPrograms() {
    return [
      {
        id: randomUUID(),
        title: "LT Training: \uB9AC\uB354\uC2ED\uC5C5\uB370\uC774\uD2B8",
        description: "\uB9AC\uB354\uC2ED \uC601\uD654\uB97C \uBC14\uD0D5\uC73C\uB85C \uBE44\uC988\uB2C8\uC2A4 \uB124\uD2B8\uC6CC\uD06C \uAE30\uC220\uACFC \uC804\uB7B5\uC744 \uD559\uC2B5\uD569\uB2C8\uB2E4.",
        date: /* @__PURE__ */ new Date("2026-02-09T14:00:00"),
        location: "\uC628\uB77C\uC778 \uAD50\uC721",
        trainer: "\uC870\uC601\uBBFC",
        maxParticipants: 30,
        currentParticipants: 15,
        status: "upcoming",
        type: "foundation",
        paymentLink: "https://bnikorestore.com/cart/9621",
        recordingLink: null,
        isOnline: true,
        createdAt: /* @__PURE__ */ new Date(),
        updatedAt: /* @__PURE__ */ new Date()
      },
      {
        id: randomUUID(),
        title: "LT Training: \uBA64\uBC84\uC2ED \uC5C5\uC885\uC62E\uAE40",
        description: "\uB9AC\uB354\uC2ED\uC758 \uC911\uC694\uC131\uACFC \uC774\uC775\uC5D0 \uCD08\uC810\uD55C \uAD50\uC721 \uD504\uB85C\uADF8\uB7A8\uC785\uB2C8\uB2E4.",
        date: /* @__PURE__ */ new Date("2026-02-09T18:00:00"),
        location: "\uC628\uB77C\uC778 \uAD50\uC721",
        trainer: "\uC774\uC885\uCCA0",
        maxParticipants: 30,
        currentParticipants: 18,
        status: "upcoming",
        type: "mentoring",
        paymentLink: "https://bnikorestore.com/cart/9672",
        recordingLink: null,
        isOnline: true,
        createdAt: /* @__PURE__ */ new Date(),
        updatedAt: /* @__PURE__ */ new Date()
      },
      {
        id: randomUUID(),
        title: "LT Training: PR \uCF54\uB514\uB124\uC774\uD130",
        description: "\uD6A8\uACFC\uC801\uC778 \uCEE4\uBBA4\uB2C8\uCF00\uC774\uC158 \uC804\uB7B5\uACFC \uC131\uACFC \uC2DC\uC810 \uAC15\uC88C\uC785\uB2C8\uB2E4.",
        date: /* @__PURE__ */ new Date("2026-02-09T20:00:00"),
        location: "\uC628\uB77C\uC778 \uAD50\uC721",
        trainer: "\uC720\uC900\uD638",
        maxParticipants: 30,
        currentParticipants: 22,
        status: "upcoming",
        type: "education",
        paymentLink: "https://bnikorestore.com/cart/9673",
        recordingLink: null,
        isOnline: true,
        createdAt: /* @__PURE__ */ new Date(),
        updatedAt: /* @__PURE__ */ new Date()
      },
      {
        id: randomUUID(),
        title: "LT Training: \uAD50\uC721 \uCF54\uB514\uB124\uC774\uD130",
        description: "BNI \uB124\uD2B8\uC6CC\uD0B9 \uAE30\uC220 \uC774\uD574 \uBC0F \uBE44\uC988\uB2C8\uC2A4 \uAC00\uCE58 \uCC3D\uCD9C \uC2DC\uC810\uC744 \uBC30\uC6C1\uB2C8\uB2E4.",
        date: /* @__PURE__ */ new Date("2026-02-09T18:00:00"),
        location: "\uC628\uB77C\uC778 \uAD50\uC721",
        trainer: "\uBA85\uC8FC\uB2E8",
        maxParticipants: 30,
        currentParticipants: 16,
        status: "upcoming",
        type: "pr",
        paymentLink: "https://bnikorestore.com/cart/9675",
        recordingLink: null,
        isOnline: true,
        createdAt: /* @__PURE__ */ new Date(),
        updatedAt: /* @__PURE__ */ new Date()
      },
      {
        id: randomUUID(),
        title: "LT Training: \uC131\uC7A5 \uCF54\uB514\uB124\uC774\uD130",
        description: "\uD300\uC6D0\uC758 \uD575\uC2EC\uC801 \uC0C1\uAE38 \uC9C4\uC815\uD55C \uC2E0\uB8B0 \uAD6C\uCD95\uC744 \uD1B5\uD574 \uBE44\uC988\uB2C8\uC2A4 \uC131\uACFC \uC99D\uC9C4\uC744 \uBC30\uC6C1\uB2C8\uB2E4.",
        date: /* @__PURE__ */ new Date("2026-02-09T20:00:00"),
        location: "\uC628\uB77C\uC778 \uAD50\uC721",
        trainer: "\uC870\uC601\uBBFC",
        maxParticipants: 30,
        currentParticipants: 14,
        status: "upcoming",
        type: "st-door",
        paymentLink: "https://bnikorestore.com/cart/9674",
        recordingLink: null,
        isOnline: true,
        createdAt: /* @__PURE__ */ new Date(),
        updatedAt: /* @__PURE__ */ new Date()
      },
      {
        id: randomUUID(),
        title: "LT Training: ST & \uB3C4\uC5B4\uD37C\uC2A8",
        description: "\uB9AC\uB354\uC2ED\uC744 \uD1B5\uD574 \uD300\uC6D0\uC758 \uB3C4\uC5B4\uD37C\uC2A8 \uC5ED\uD560 \uC774\uD574 \uBC0F \uBE44\uC988\uB2C8\uC2A4 \uAE30\uD68C \uCC3D\uCD9C\uC744 \uD559\uC2B5\uD569\uB2C8\uB2E4.",
        date: /* @__PURE__ */ new Date("2026-02-09T18:00:00"),
        location: "\uC628\uB77C\uC778 \uAD50\uC721",
        trainer: "\uC624\uD61C\uC6D0",
        maxParticipants: 30,
        currentParticipants: 19,
        status: "upcoming",
        type: "st-door",
        paymentLink: "https://bnikorestore.com/cart/9676",
        recordingLink: null,
        isOnline: true,
        createdAt: /* @__PURE__ */ new Date(),
        updatedAt: /* @__PURE__ */ new Date()
      },
      {
        id: randomUUID(),
        title: "LT Training: \uBA64\uBC84\uC2ED \uC704\uC6D0\uD68C",
        description: "\uCD08\uAE30 \uACFC\uC815 \uAD00\uCC30 \uD1B5\uD55C \uACF5\uC815\uD55C \uC591\uAC10\uC758 \uBE44\uC988\uB2C8\uC2A4 \uB124\uD2B8\uC6CC\uD06C \uAD6C\uCD95 \uAC00\uCE58 \uADF9\uB300\uD654\uB97C \uBC30\uC6C1\uB2C8\uB2E4.",
        date: /* @__PURE__ */ new Date("2026-02-09T18:00:00"),
        location: "\uC628\uB77C\uC778 \uAD50\uC721",
        trainer: "\uC815\uBB34\uC77C",
        maxParticipants: 30,
        currentParticipants: 21,
        status: "upcoming",
        type: "membership",
        paymentLink: "https://bnikorestore.com/cart/9677",
        recordingLink: null,
        isOnline: true,
        createdAt: /* @__PURE__ */ new Date(),
        updatedAt: /* @__PURE__ */ new Date()
      },
      {
        id: randomUUID(),
        title: "LT Training: \uC774\uBCA4\uD2B8 \uCF54\uB514\uB124\uC774\uD130",
        description: "\uD504\uB85C\uC81D\uD2B8 \uAD00\uB9AC \uBC0F BNI \uB124\uD2B8\uC6CC\uD06C \uD68C\uC6D0\uC744 \uD1B5\uD55C \uB9AC\uB354\uC2ED \uD601\uC2E0\uACFC \uC131\uC7A5\uC744 \uBC30\uC6C1\uB2C8\uB2E4.",
        date: /* @__PURE__ */ new Date("2026-02-09T18:00:00"),
        location: "\uC628\uB77C\uC778 \uAD50\uC721",
        trainer: "\uAE40\uCCA0\uC131",
        maxParticipants: 30,
        currentParticipants: 13,
        status: "upcoming",
        type: "event",
        paymentLink: "https://bnikorestore.com/cart/9678",
        recordingLink: null,
        isOnline: true,
        createdAt: /* @__PURE__ */ new Date(),
        updatedAt: /* @__PURE__ */ new Date()
      },
      {
        id: randomUUID(),
        title: "LT Training: \uBC29\uBB38\uD638 \uCF54\uB514\uB124\uC774\uD130",
        description: "\uBCF8 \uD074\uB798\uC2A4\uB294 \uBA64\uBC84\uC758 \uC704\uC6D0\uD68C\uC640 \uC591\uAC10\uC758 \uD601\uC2E0 \uD300\uC6D0 \uC870\uD654 \uACFC\uC815\uC744 \uD1B5\uD574 \uC0C8\uB85C\uC6B4 \uBE44\uC988\uB2C8\uC2A4 \uAE30\uD68C\uB97C \uCC3D\uCD9C\uD558\uB294 \uB124\uD2B8\uC6CC\uD06C \uAD6C\uCD95 \uC2DC\uC810\uC744 \uC81C\uACF5\uD569\uB2C8\uB2E4.",
        date: /* @__PURE__ */ new Date("2026-02-09T18:00:00"),
        location: "\uC628\uB77C\uC778 \uAD50\uC721",
        trainer: "\uAE40\uC9C0\uC218",
        maxParticipants: 30,
        currentParticipants: 17,
        status: "upcoming",
        type: "visitor",
        paymentLink: "https://bnikorestore.com/cart/9679",
        recordingLink: null,
        isOnline: true,
        createdAt: /* @__PURE__ */ new Date(),
        updatedAt: /* @__PURE__ */ new Date()
      }
    ];
  }
  async getNotices() {
    return this.getTestNotices();
  }
  getTestNotices() {
    return [
      {
        id: randomUUID(),
        title: "2026\uB144 \uB9AC\uB354\uC2ED \uD2B8\uB808\uC774\uB2DD \uC77C\uC815 \uD655\uC815",
        content: "\uCD1D 9\uAC1C \uC138\uC158\uC774 2\uC6D4 9\uC77C\uC5D0 \uC9C4\uD589\uB429\uB2C8\uB2E4. \uAC01 \uC138\uC158\uBCC4 \uC2DC\uAC04\uACFC \uB2F4\uB2F9\uC790\uB97C \uD655\uC778\uD558\uACE0 \uBBF8\uB9AC \uC2E0\uCCAD\uD574\uC8FC\uC138\uC694.",
        priority: 1,
        isActive: true,
        createdAt: /* @__PURE__ */ new Date(),
        updatedAt: /* @__PURE__ */ new Date()
      },
      {
        id: randomUUID(),
        title: "BNI \uCF54\uB9AC\uC544 \uC2A4\uD1A0\uC5B4 \uACB0\uC81C \uB9C1\uD06C \uC548\uB0B4",
        content: "\uBAA8\uB4E0 \uD2B8\uB808\uC774\uB2DD \uACB0\uC81C\uB294 BNI \uCF54\uB9AC\uC544 \uC2A4\uD1A0\uC5B4\uB97C \uD1B5\uD574 \uC9C4\uD589\uB429\uB2C8\uB2E4. \uAC01 \uC138\uC158\uBCC4 \uC804\uC6A9 \uACB0\uC81C \uB9C1\uD06C\uB97C \uD655\uC778\uD574\uC8FC\uC138\uC694.",
        priority: 0,
        isActive: true,
        createdAt: /* @__PURE__ */ new Date(),
        updatedAt: /* @__PURE__ */ new Date()
      },
      {
        id: randomUUID(),
        title: "\uC138\uC158 \uC6B4\uC601 \uC2DC\uAC04 \uC548\uB0B4",
        content: "\uC624\uD6C4 2\uC2DC\uBD80\uD130 \uBC24 9\uC2DC\uAE4C\uC9C0 \uB2E4\uC591\uD55C \uC2DC\uAC04\uB300\uC5D0 \uC138\uC158\uC774 \uC9C4\uD589\uB429\uB2C8\uB2E4. \uBCF8\uC778 \uC77C\uC815\uC5D0 \uB9DE\uB294 \uC138\uC158\uC744 \uC120\uD0DD\uD558\uC5EC \uCC38\uC5EC\uD574\uC8FC\uC138\uC694.",
        priority: 0,
        isActive: true,
        createdAt: /* @__PURE__ */ new Date(),
        updatedAt: /* @__PURE__ */ new Date()
      }
    ];
  }
  async submitApplication(insertApplication) {
    try {
      const id = randomUUID();
      const application = {
        ...insertApplication,
        id,
        programId: insertApplication.programId || `single-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        status: "pending",
        createdAt: /* @__PURE__ */ new Date(),
        chapter: insertApplication.chapter || null,
        notes: insertApplication.notes || null
      };
      this.applications.set(id, application);
      await googleSheetsService.addApplicationToSheet({
        programTitle: insertApplication.programTitle,
        region: insertApplication.region || "",
        chapter: application.chapter || "",
        name: application.name,
        phone: application.phone,
        email: application.email,
        participationType: application.trainingType === "live" ? "\uC2E4\uC2DC\uAC04 \uCC38\uC5EC" : "\uB179\uD654\uBCF8 \uC2DC\uCCAD(VOD)",
        notes: application.notes || ""
      });
      return application;
    } catch (error) {
      console.error("Failed to submit application:", error);
      throw new Error("\uC2E0\uCCAD \uC81C\uCD9C\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4. \uB2E4\uC2DC \uC2DC\uB3C4\uD574\uC8FC\uC138\uC694.");
    }
  }
  async getApplication(id) {
    return this.applications.get(id);
  }
  async bulkSubmitApplications(insertApplications) {
    try {
      const applications2 = [];
      for (const insertApp of insertApplications) {
        const id = randomUUID();
        const application = {
          ...insertApp,
          id,
          programId: `bulk-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          status: "pending",
          createdAt: /* @__PURE__ */ new Date(),
          chapter: insertApp.chapter || null,
          notes: insertApp.notes || null
        };
        this.applications.set(id, application);
        applications2.push(application);
      }
      try {
        for (const app2 of insertApplications) {
          await googleSheetsService.addApplicationToSheet({
            programTitle: app2.programTitle,
            region: app2.region || "",
            chapter: app2.chapter || "",
            name: app2.name,
            phone: app2.phone,
            email: app2.email,
            participationType: app2.participationType || (app2.trainingType === "live" ? "\uC2E4\uC2DC\uAC04 \uCC38\uC5EC" : "\uB179\uD654\uBCF8 \uC2DC\uCCAD"),
            notes: app2.notes || ""
          });
        }
      } catch (googleError) {
        console.error("Failed to add bulk applications to Google Sheets:", googleError);
      }
      return applications2;
    } catch (error) {
      console.error("Failed to bulk submit applications:", error);
      throw new Error("\uC77C\uAD04 \uC2E0\uCCAD \uC81C\uCD9C\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4. \uB2E4\uC2DC \uC2DC\uB3C4\uD574\uC8FC\uC138\uC694.");
    }
  }
  async getAllApplications() {
    return Array.from(this.applications.values()).sort(
      (a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0)
    );
  }
};
var storage = new MemStorage();

// shared/schema.ts
import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
var trainingPrograms = pgTable("training_programs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  description: text("description"),
  date: timestamp("date").notNull(),
  location: text("location").notNull(),
  trainer: text("trainer").notNull(),
  maxParticipants: integer("max_participants").notNull().default(30),
  currentParticipants: integer("current_participants").notNull().default(0),
  status: text("status").notNull().default("upcoming"),
  // upcoming, ongoing, completed
  type: text("type").notNull(),
  // foundation, mentoring, pr, st-door, event, membership, education, visitor
  paymentLink: text("payment_link"),
  recordingLink: text("recording_link"),
  isOnline: boolean("is_online").notNull().default(false),
  createdAt: timestamp("created_at").default(sql`now()`),
  updatedAt: timestamp("updated_at").default(sql`now()`)
});
var applications = pgTable("applications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  programId: varchar("program_id").notNull().references(() => trainingPrograms.id),
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull(),
  chapter: text("chapter"),
  region: text("region"),
  participationType: text("participation_type"),
  trainingType: text("training_type").notNull(),
  // live, recorded
  notes: text("notes"),
  status: text("status").notNull().default("pending"),
  // pending, approved, rejected
  createdAt: timestamp("created_at").default(sql`now()`)
});
var notices = pgTable("notices", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  content: text("content").notNull(),
  priority: integer("priority").notNull().default(0),
  // 0: normal, 1: high
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").default(sql`now()`),
  updatedAt: timestamp("updated_at").default(sql`now()`)
});
var insertTrainingProgramSchema = createInsertSchema(trainingPrograms).omit({
  id: true,
  createdAt: true,
  updatedAt: true
});
var insertApplicationSchema = createInsertSchema(applications).omit({
  id: true,
  createdAt: true,
  status: true,
  programId: true
  // programId를 완전히 제거하여 자동 생성되도록 함
}).extend({
  programTitle: z.string().min(1, "\uD504\uB85C\uADF8\uB7A8 \uC81C\uBAA9\uC774 \uD544\uC694\uD569\uB2C8\uB2E4"),
  name: z.string().min(1, "\uBA64\uBC84\uBA85\uC744 \uC785\uB825\uD574\uC8FC\uC138\uC694"),
  phone: z.string().min(1, "\uC5F0\uB77D\uCC98\uB97C \uC785\uB825\uD574\uC8FC\uC138\uC694"),
  email: z.string().email("\uC62C\uBC14\uB978 \uC774\uBA54\uC77C \uC8FC\uC18C\uB97C \uC785\uB825\uD574\uC8FC\uC138\uC694"),
  trainingType: z.enum(["live", "recorded"], {
    required_error: "\uCC38\uC5EC \uBC29\uC2DD\uC744 \uC120\uD0DD\uD574\uC8FC\uC138\uC694"
  }),
  region: z.string().min(1, "\uC9C0\uC5ED\uC744 \uC785\uB825\uD574\uC8FC\uC138\uC694"),
  participationType: z.string().min(1, "\uCC38\uC5EC \uBC29\uC2DD\uC744 \uC120\uD0DD\uD574\uC8FC\uC138\uC694"),
  // notes 필드를 명시적으로 처리 - 숫자나 다른 타입을 문자열로 변환
  notes: z.any().transform((val) => {
    if (val === null || val === void 0 || val === "") {
      return "";
    }
    return String(val);
  }).pipe(z.string())
});
var insertBulkApplicationSchema = insertApplicationSchema.extend({
  email: z.string().optional().transform((val) => {
    if (!val || val.trim() === "") {
      return "";
    }
    return val.trim();
  }).pipe(z.string().refine((val) => {
    if (val === "") return true;
    try {
      z.string().email().parse(val);
      return true;
    } catch {
      return false;
    }
  }, {
    message: "\uC62C\uBC14\uB978 \uC774\uBA54\uC77C \uC8FC\uC18C\uB97C \uC785\uB825\uD574\uC8FC\uC138\uC694"
  }))
});
var insertNoticeSchema = createInsertSchema(notices).omit({
  id: true,
  createdAt: true,
  updatedAt: true
});
var googleSheetsDataSchema = z.object({
  programs: z.array(z.object({
    title: z.string(),
    description: z.string(),
    date: z.string(),
    location: z.string(),
    trainer: z.string(),
    maxParticipants: z.number(),
    currentParticipants: z.number(),
    status: z.enum(["upcoming", "ongoing", "completed"]),
    type: z.enum(["foundation", "mentoring", "pr", "st-door", "event", "membership", "education", "visitor"]),
    paymentLink: z.string().optional(),
    recordingLink: z.string().optional(),
    isOnline: z.boolean()
  })),
  notices: z.array(z.object({
    title: z.string(),
    content: z.string(),
    priority: z.number(),
    isActive: z.boolean()
  }))
});

// server/middleware/rateLimiting.ts
var MemoryStore = class {
  store = {};
  // 5분마다 스토어 정리
  constructor() {
    setInterval(() => {
      const now = Date.now();
      Object.keys(this.store).forEach((key) => {
        if (this.store[key].resetTime < now) {
          delete this.store[key];
        }
      });
    }, 3e5);
  }
  get(key) {
    const record = this.store[key];
    if (!record || record.resetTime < Date.now()) {
      return null;
    }
    return record;
  }
  set(key, value) {
    this.store[key] = value;
  }
};
var store = new MemoryStore();
function createRateLimit(options) {
  const {
    windowMs,
    max,
    message = "\uC694\uCCAD\uC774 \uB108\uBB34 \uB9CE\uC2B5\uB2C8\uB2E4. \uC7A0\uC2DC \uD6C4 \uB2E4\uC2DC \uC2DC\uB3C4\uD574\uC8FC\uC138\uC694.",
    skipSuccessfulRequests = false
  } = options;
  return (req, res, next) => {
    const key = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.ip || req.socket.remoteAddress || "unknown";
    const now = Date.now();
    const resetTime = now + windowMs;
    const current = store.get(key);
    if (!current) {
      store.set(key, { count: 1, resetTime });
      return next();
    }
    if (current.count >= max) {
      const retryAfterSeconds = Math.ceil((current.resetTime - now) / 1e3);
      return res.status(429).json({
        error: message,
        retryAfter: retryAfterSeconds,
        message: `${message} ${retryAfterSeconds}\uCD08 \uD6C4 \uB2E4\uC2DC \uC2DC\uB3C4\uD574\uC8FC\uC138\uC694.`
      });
    }
    if (!skipSuccessfulRequests) {
      current.count++;
      store.set(key, current);
    } else {
      const originalSend = res.send;
      res.send = function(body) {
        if (res.statusCode < 400) {
          current.count++;
          store.set(key, current);
        }
        return originalSend.call(this, body);
      };
    }
    next();
  };
}
var apiRateLimit = createRateLimit({
  windowMs: 60 * 1e3,
  // 1분
  max: 100,
  // 분당 100회
  message: "API \uC694\uCCAD\uC774 \uB108\uBB34 \uB9CE\uC2B5\uB2C8\uB2E4."
});
var strictApiRateLimit = createRateLimit({
  windowMs: 60 * 1e3,
  // 1분  
  max: 900,
  // 분당 900회 (안전한 여유 마진 확보)
  message: "Google Sheets API \uBCF4\uD638\uB97C \uC704\uD574 \uC694\uCCAD\uC744 \uC81C\uD55C\uD569\uB2C8\uB2E4."
});
var applicationSubmitRateLimit = createRateLimit({
  windowMs: 1 * 60 * 1e3,
  // 1분
  max: 60,
  // 1분당 60회 신청 (사용자별 IP 기반)
  message: "\uC2E0\uCCAD \uC694\uCCAD\uC774 \uB108\uBB34 \uB9CE\uC2B5\uB2C8\uB2E4."
});

// server/routes.ts
async function registerRoutes(app2) {
  app2.get("/api/programs", async (req, res) => {
    try {
      const programs = await storage.getTrainingPrograms();
      let filteredPrograms = programs;
      const { status, search, date } = req.query;
      if (status) {
        filteredPrograms = filteredPrograms.filter((p) => p.status === status);
      }
      if (search) {
        const searchTerm = search.toLowerCase();
        filteredPrograms = filteredPrograms.filter(
          (p) => p.title.toLowerCase().includes(searchTerm) || p.description?.toLowerCase().includes(searchTerm) || p.trainer.toLowerCase().includes(searchTerm)
        );
      }
      if (date) {
        const now = /* @__PURE__ */ new Date();
        const filterDate = date;
        if (filterDate === "thisMonth") {
          const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
          const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
          filteredPrograms = filteredPrograms.filter(
            (p) => p.date >= startOfMonth && p.date <= endOfMonth
          );
        } else if (filterDate === "nextMonth") {
          const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
          const endOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 2, 0);
          filteredPrograms = filteredPrograms.filter(
            (p) => p.date >= startOfNextMonth && p.date <= endOfNextMonth
          );
        } else if (filterDate === "thisQuarter") {
          const currentQuarter = Math.floor(now.getMonth() / 3);
          const startOfQuarter = new Date(now.getFullYear(), currentQuarter * 3, 1);
          const endOfQuarter = new Date(now.getFullYear(), (currentQuarter + 1) * 3, 0);
          filteredPrograms = filteredPrograms.filter(
            (p) => p.date >= startOfQuarter && p.date <= endOfQuarter
          );
        }
      }
      res.json(filteredPrograms);
    } catch (error) {
      console.error("Failed to fetch programs:", error);
      res.status(500).json({
        message: "\uD504\uB85C\uADF8\uB7A8 \uB370\uC774\uD130\uB97C \uBD88\uB7EC\uC624\uB294\uB370 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4. Google Sheets \uC5F0\uACB0\uC744 \uD655\uC778\uD574\uC8FC\uC138\uC694.",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });
  app2.get("/api/application-status", strictApiRateLimit, async (req, res) => {
    try {
      const applicationStatus = await googleSheetsService.fetchApplicationStatus();
      res.json(applicationStatus);
    } catch (error) {
      console.error("Failed to fetch application status:", error);
      res.status(500).json({
        message: "\uC2E0\uCCAD \uC0C1\uD0DC\uB97C \uBD88\uB7EC\uC624\uB294\uB370 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });
  app2.get("/api/notices", async (req, res) => {
    try {
      const notices2 = await storage.getNotices();
      const sortedNotices = notices2.sort((a, b) => {
        if (a.priority !== b.priority) {
          return b.priority - a.priority;
        }
        const aDate = a.createdAt?.getTime() || 0;
        const bDate = b.createdAt?.getTime() || 0;
        return bDate - aDate;
      });
      res.json(sortedNotices);
    } catch (error) {
      console.error("Failed to fetch notices:", error);
      res.status(500).json({
        message: "\uACF5\uC9C0\uC0AC\uD56D\uC744 \uBD88\uB7EC\uC624\uB294\uB370 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });
  app2.post("/api/applications", applicationSubmitRateLimit, async (req, res) => {
    try {
      const validatedData = insertApplicationSchema.parse(req.body);
      const isDuplicate = await googleSheetsService.checkDuplicateApplication(
        validatedData.programTitle,
        validatedData.phone,
        validatedData.name
      );
      if (isDuplicate) {
        return res.status(409).json({
          message: "\uC774\uBBF8 \uB3D9\uC77C \uACFC\uBAA9\uC5D0 \uC2E0\uCCAD\uC774 \uC644\uB8CC\uB418\uC5C8\uC2B5\uB2C8\uB2E4.",
          duplicate: true
        });
      }
      const application = await storage.submitApplication(validatedData);
      res.status(201).json({
        message: "\uC2E0\uCCAD\uC774 \uC131\uACF5\uC801\uC73C\uB85C \uC811\uC218\uB418\uC5C8\uC2B5\uB2C8\uB2E4.",
        application: {
          id: application.id,
          status: application.status
        }
      });
    } catch (error) {
      console.error("Failed to submit application:", error);
      if (error instanceof Error && error.name === "ZodError") {
        res.status(400).json({
          message: "\uC785\uB825 \uB370\uC774\uD130\uAC00 \uC62C\uBC14\uB974\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.",
          error: error.message
        });
      } else {
        res.status(500).json({
          message: "\uC2E0\uCCAD \uC81C\uCD9C\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4. \uB2E4\uC2DC \uC2DC\uB3C4\uD574\uC8FC\uC138\uC694.",
          error: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  });
  app2.get("/api/applications/:id", async (req, res) => {
    try {
      const application = await storage.getApplication(req.params.id);
      if (!application) {
        return res.status(404).json({ message: "\uC2E0\uCCAD \uB0B4\uC5ED\uC744 \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4." });
      }
      res.json(application);
    } catch (error) {
      console.error("Failed to fetch application:", error);
      res.status(500).json({
        message: "\uC2E0\uCCAD \uB0B4\uC5ED \uC870\uD68C\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });
  app2.post("/api/applications/bulk", async (req, res) => {
    try {
      const { applications: applications2 } = req.body;
      if (!Array.isArray(applications2)) {
        return res.status(400).json({
          success: false,
          message: "\uC2E0\uCCAD \uB370\uC774\uD130\uB294 \uBC30\uC5F4 \uD615\uD0DC\uC5EC\uC57C \uD569\uB2C8\uB2E4."
        });
      }
      const duplicateEntries = await googleSheetsService.checkBulkDuplicates(
        applications2.map((app3) => ({
          programTitle: String(app3.programTitle || "").trim(),
          phone: String(app3.phone || "").trim(),
          name: String(app3.name || "").trim()
        }))
      );
      const duplicateKeys = new Set(
        duplicateEntries.map((d) => `${d.programTitle}|${d.phone.replace(/\D/g, "")}`)
      );
      const duplicateNames = duplicateEntries.map((d) => `${d.name}(${d.programTitle})`);
      const filteredApplications = duplicateKeys.size > 0 ? applications2.filter((app3) => {
        const key = `${String(app3.programTitle || "").trim()}|${String(app3.phone || "").trim().replace(/\D/g, "")}`;
        return !duplicateKeys.has(key);
      }) : applications2;
      if (filteredApplications.length === 0 && duplicateKeys.size > 0) {
        return res.status(409).json({
          success: false,
          message: `\uC774\uBBF8 \uB3D9\uC77C \uACFC\uBAA9\uC5D0 \uC2E0\uCCAD\uC774 \uC644\uB8CC\uB41C \uC778\uC6D0\uC774 \uC788\uC2B5\uB2C8\uB2E4: ${duplicateEntries.map((d) => d.name).join(", ")}`,
          duplicate: true,
          duplicateNames: duplicateEntries.map((d) => d.name)
        });
      }
      const validatedApplications = filteredApplications.map((app3, index) => {
        try {
          const normalizedApp = {
            ...app3,
            programId: app3.programId || `bulk-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            name: String(app3.name || "").trim(),
            email: app3.email ? String(app3.email).trim() : "",
            phone: String(app3.phone || "").trim(),
            region: String(app3.region || "").trim(),
            chapter: String(app3.chapter || "").trim(),
            participationType: String(app3.participationType || "\uC2E4\uC2DC\uAC04 \uCC38\uC5EC").trim(),
            notes: String(app3.notes || "").trim(),
            programTitle: String(app3.programTitle || "").trim(),
            trainingType: app3.trainingType || "live"
          };
          return insertBulkApplicationSchema.parse(normalizedApp);
        } catch (error) {
          console.error(`Error validating application at index ${index}:`, error);
          console.error(`Failed data:`, app3);
          const row = index + 2;
          const fieldMessages = [];
          if (error?.issues) {
            for (const issue of error.issues) {
              const field = issue.path?.join(".") || "\uC54C \uC218 \uC5C6\uB294 \uD544\uB4DC";
              fieldMessages.push(`${field}: ${issue.message}`);
            }
          }
          const validationError = new Error("VALIDATION_ERROR");
          validationError.validationDetails = {
            row,
            name: String(app3.name || "").trim(),
            fields: fieldMessages
          };
          throw validationError;
        }
      });
      const submittedApplications = await storage.bulkSubmitApplications(validatedApplications);
      res.status(201).json({
        success: true,
        applications: submittedApplications,
        count: submittedApplications.length,
        message: `${submittedApplications.length}\uAC1C\uC758 \uC2E0\uCCAD\uC774 \uC131\uACF5\uC801\uC73C\uB85C \uC81C\uCD9C\uB418\uC5C8\uC2B5\uB2C8\uB2E4.`,
        skippedDuplicates: duplicateNames,
        partialSuccess: duplicateNames.length > 0
      });
    } catch (error) {
      console.error("Error bulk submitting applications:", error);
      if (error?.message === "VALIDATION_ERROR" && error.validationDetails) {
        const details = error.validationDetails;
        res.status(400).json({
          success: false,
          type: "validation",
          message: "\uBA85\uB2E8\uC758 \uC591\uC2DD\uC5D0 \uC624\uB958\uAC00 \uC788\uC5B4 \uC2E0\uCCAD\uC774 \uBCF4\uB958\uB418\uC5C8\uC2B5\uB2C8\uB2E4.",
          row: details.row,
          name: details.name,
          fields: details.fields
        });
      } else if (error instanceof Error && error.name === "ZodError") {
        res.status(400).json({
          success: false,
          type: "validation",
          message: "\uBA85\uB2E8\uC758 \uC591\uC2DD\uC5D0 \uC624\uB958\uAC00 \uC788\uC5B4 \uC2E0\uCCAD\uC774 \uBCF4\uB958\uB418\uC5C8\uC2B5\uB2C8\uB2E4.",
          fields: [error.message]
        });
      } else {
        res.status(500).json({
          success: false,
          type: "server",
          message: "\uC77C\uAD04 \uC2E0\uCCAD \uC81C\uCD9C\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4. \uB2E4\uC2DC \uC2DC\uB3C4\uD574\uC8FC\uC138\uC694.",
          error: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  });
  app2.get("/api/applications", strictApiRateLimit, async (req, res) => {
    try {
      const applications2 = await googleSheetsService.getApplicationsFromSheet();
      res.json(applications2);
    } catch (error) {
      console.error("Error fetching applications from Google Sheets:", error);
      try {
        const applications2 = await storage.getAllApplications();
        res.json(applications2);
      } catch (backupError) {
        console.error("\uBC31\uC5C5 \uC2A4\uD1A0\uB9AC\uC9C0\uB3C4 \uC2E4\uD328:", backupError);
        res.status(500).json({
          message: "\uC2E0\uCCAD \uB0B4\uC5ED \uC870\uD68C\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4. Google Sheets \uC5F0\uACB0\uC744 \uD655\uC778\uD574\uC8FC\uC138\uC694.",
          error: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  });
  app2.get("/api/sheets/info", apiRateLimit, async (req, res) => {
    try {
      const sheetInfo = googleSheetsService.getSheetInfo();
      const isConfigured = googleSheetsService.isConfigured();
      const isSecondaryConfigured = googleSheetsService.isSecondarySheetConfigured();
      res.json({
        isConfigured,
        primarySheet: {
          id: sheetInfo.primary,
          url: sheetInfo.primary ? `https://docs.google.com/spreadsheets/d/${sheetInfo.primary}/edit` : null
        },
        secondarySheet: isSecondaryConfigured ? {
          id: sheetInfo.secondary,
          url: `https://docs.google.com/spreadsheets/d/${sheetInfo.secondary}/edit`
        } : null,
        message: isSecondaryConfigured ? "\uC591\uBC29\uD5A5 \uC5F0\uB3D9: 2\uAC1C \uC2DC\uD2B8 \uC124\uC815\uB428" : "\uC591\uBC29\uD5A5 \uC5F0\uB3D9: 1\uAC1C \uC2DC\uD2B8 \uC124\uC815\uB428"
      });
    } catch (error) {
      console.error("Failed to get sheets info:", error);
      res.status(500).json({
        message: "Google Sheets \uC815\uBCF4\uB97C \uAC00\uC838\uC624\uB294\uB370 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });
  app2.get("/api/secondary-programs", strictApiRateLimit, async (req, res) => {
    try {
      const programs = await googleSheetsService.getSecondarySheetPrograms();
      const completedCounts = await googleSheetsService.getAllProgramsCompletedCounts();
      const applicationStatus = await googleSheetsService.fetchApplicationStatus();
      const programsWithCounts = programs.map((program) => {
        let completedCount = 0;
        if (program.title.includes("\uBA58\uD1A0\uB9C1")) {
          let mentoringOnlyCount = 0;
          const mentoringKeys = [
            "LTT : \uBA58\uD1A0\uB9C1 \uCF54\uB514\uB124\uC774\uD130 T",
            // 1명
            "LTT : \uBA58\uD1A0\uB9C1 \uCF54\uB514\uB124\uC774\uD130 T ",
            // 2명 (공백)
            "LTT : \uBA58\uD1A0\uB9C1 \uCF54\uB514\uB124\uC774\uD130 T.",
            // 1명 (점)
            "\uBA58\uD1A0\uB9C1 \uCF54\uB514\uB124\uC774\uD130 T"
            // 1명
          ];
          mentoringKeys.forEach((key) => {
            const count = completedCounts[key] || 0;
            if (count > 0) {
              mentoringOnlyCount += count;
            }
          });
          completedCount = mentoringOnlyCount;
        } else {
          if (completedCounts[program.title]) {
            completedCount = completedCounts[program.title];
          }
          const ltTrainingFormat = program.title.replace("LTT :", "LT Training:");
          if (completedCounts[ltTrainingFormat]) {
            completedCount += completedCounts[ltTrainingFormat];
          }
          const shortFormMap = {
            "LTT : \uD30C\uC6B4\uB370\uC774\uC158 T.": [
              "\uD30C\uC6B4\uB370\uC774\uC158",
              "\uD30C\uC6B4\uB370\uC774\uC158 T.",
              "\uD30C\uC6B4\uB370\uC774\uC158 \uD2B8\uB808\uC774\uB2DD",
              "\uD30C\uC6B4\uB370\uC774\uC158\uD2B8\uB808\uC774\uB2DD"
            ],
            "LTT : \uBA64\uBC84\uC2ED \uC704\uC6D0\uD68C T.": [
              "\uBA64\uBC84\uC2ED\uC704\uC6D0\uD68C",
              "\uBA64\uBC84\uC2ED \uC704\uC6D0\uD68C",
              "\uBA64\uBC84\uC2ED \uC704\uC6D0\uD68C T.",
              "\uBA64\uBC84\uC2ED",
              "\uBA64\uBC84\uC2ED\uC704\uC6D0\uD68CT",
              "\uBA64\uBC84\uC2ED \uC704 \uC6D0\uD68C"
            ],
            "LTT : PR \uCF54\uB514\uB124\uC774\uD130T.": [
              "PR\uCF54\uB514",
              "pr\uCF54\uB514",
              "PR \uCF54\uB514",
              "pr \uCF54\uB514",
              "PR\uCF54\uB514\uB124\uC774\uD130",
              "PR\uCF54\uB514\uB124\uC774\uD130T",
              "PR \uCF54\uB514\uB124\uC774\uD130",
              "PR",
              "\uD53C\uC54C \uCF54\uB514\uB124\uC774\uD130",
              "PR \uCF54\uB514\uB124\uC774\uD130T."
            ],
            "LTT : \uAD50\uC721 \uCF54\uB514\uB124\uC774\uD130 T.": [
              "\uAD50\uC721\uCF54\uB514\uB124\uC774\uD130",
              "\uAD50\uC721 \uCF54\uB514\uB124\uC774\uD130",
              "\uAD50\uC721 \uCF54\uB514",
              "\uAD50\uC721\uCF54\uB514",
              "\uAD50\uC721",
              "\uAD50\uC721\uCF54\uB514\uB124\uC774\uD130T",
              "\uAD50\uC721 \uCF54\uB514\uB124\uC774\uD130 T."
            ],
            "LTT : \uC131\uC7A5 \uCF54\uB514\uB124\uC774\uD130 T.": [
              "\uC131\uC7A5\uCF54\uB514\uB124\uC774\uD130",
              "\uC131\uC7A5 \uCF54\uB514\uB124\uC774\uD130",
              "\uC131\uC7A5\uCF54\uB514",
              "\uC131\uC7A5 \uCF54\uB514",
              "\uC131\uC7A5",
              "\uC131\uC7A5\uCF54\uB514\uB124\uC774\uD130T",
              "\uC131\uC7A5 \uCF54\uB514\uB124\uC774\uD130 T."
            ],
            "LTT : ST T.": [
              "ST\uB3C4\uC5B4\uD37C\uC2A8",
              "ST & \uB3C4\uC5B4\uD37C\uC2A8",
              "ST",
              "ST \uB3C4\uC5B4\uD37C\uC2A8",
              "\uB3C4\uC5B4\uD37C\uC2A8",
              "ST & \uB3C4\uC5B4\uD37C\uC2A8 T.",
              "ST T.",
              "LTT : ST & \uB3C4\uC5B4\uD37C\uC2A8 T."
            ],
            "LTT : \uBE44\uC9C0\uD130 \uD638\uC2A4\uD2B8 T.": [
              "\uBE44\uC9C0\uD130\uD638\uC2A4\uD2B8",
              "\uBE44\uC9C0\uD130 \uD638\uC2A4\uD2B8",
              "\uBE44\uC9C0\uD130",
              "\uBE44\uC9C0\uD130\uD638\uC2A4\uD2B8T",
              "\uBE44\uC9C0\uD130 \uD638\uC2A4\uD2B8 T."
            ],
            "LTT : \uC774\uBCA4\uD2B8 \uCF54\uB514\uB124\uC774\uD130 T.": [
              "\uC774\uBCA4\uD2B8\uCF54\uB514\uB124\uC774\uD130",
              "\uC774\uBCA4\uD2B8 \uCF54\uB514\uB124\uC774\uD130",
              "\uC774\uBCA4\uD2B8\uCF54\uB514",
              "\uC774\uBCA4\uD2B8",
              "\uC774\uBCA4\uD2B8\uCF54\uB514\uB124\uC774\uD130T",
              "\uC774\uBCA4\uD2B8 \uCF54\uB514\uB124\uC774\uD130 T."
            ]
            // 멘토링은 특별 처리되므로 여기서 제외
          };
          const shortForms = shortFormMap[program.title] || [];
          let additionalCount = 0;
          for (const shortForm of shortForms) {
            if (completedCounts[shortForm]) {
              additionalCount += completedCounts[shortForm];
            }
          }
          completedCount += additionalCount;
        }
        return {
          ...program,
          completedCount,
          currentParticipants: completedCount,
          // 프로그램 카드에서 사용하는 필드명과 통일
          isAvailable: applicationStatus[program.title] !== false
          // 기본값은 true (신청 가능)
        };
      });
      res.set({
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
        "Expires": "0"
      });
      res.json(programsWithCounts);
    } catch (error) {
      console.error("Failed to fetch secondary programs:", error);
      res.status(500).json({
        message: "\uB450 \uBC88\uC9F8 \uC2DC\uD2B8 \uD504\uB85C\uADF8\uB7A8 \uC815\uBCF4\uB97C \uAC00\uC838\uC624\uB294\uB370 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });
  app2.get("/api/dashboard", strictApiRateLimit, async (req, res) => {
    try {
      const dashboardData = await googleSheetsService.getDashboardData();
      res.json(dashboardData);
    } catch (error) {
      console.error("Failed to fetch dashboard data:", error);
      res.status(500).json({
        message: "\uB300\uC2DC\uBCF4\uB4DC \uB370\uC774\uD130\uB97C \uBD88\uB7EC\uC624\uB294\uB370 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });
  const httpServer = createServer(app2);
  return httpServer;
}

// server/static-serve.ts
import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
var __dirname = path.dirname(fileURLToPath(import.meta.url));
function log(message, source = "express") {
  const formattedTime = (/* @__PURE__ */ new Date()).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true
  });
  console.log(`${formattedTime} [${source}] ${message}`);
}
function serveStatic(app2) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
  }
  app2.use(express.static(distPath));
  app2.use("*", (_req, res) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}

// server/index.ts
var app = express3();
app.set("trust proxy", true);
app.use(express3.json());
app.use(express3.urlencoded({ extended: false }));
app.use((req, res, next) => {
  const userAgent = req.headers["user-agent"] || "";
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent);
  const isKakaoTalk = /KAKAOTALK/i.test(userAgent);
  if (isMobile || isKakaoTalk) {
    res.setHeader("X-UA-Compatible", "IE=edge");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  }
  next();
});
app.use(express3.static("client/public"));
app.use((req, res, next) => {
  const start = Date.now();
  const path4 = req.path;
  let capturedJsonResponse = void 0;
  const originalResJson = res.json;
  res.json = function(bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };
  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path4.startsWith("/api")) {
      let logLine = `${req.method} ${path4} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }
      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "\u2026";
      }
      log(logLine);
    }
  });
  next();
});
process.on("uncaughtException", (err) => {
  log(`CRASH - Uncaught Exception: ${err.message}
${err.stack}`);
});
process.on("unhandledRejection", (reason) => {
  log(`CRASH - Unhandled Rejection: ${reason}`);
});
process.on("SIGHUP", () => {
  log("SIGHUP received - ignoring (PTY disconnect, keeping server alive)");
});
process.on("SIGTERM", () => {
  log("SIGTERM received - process being terminated by system");
  process.exit(0);
});
process.on("SIGINT", () => {
  log("SIGINT received");
  process.exit(0);
});
process.on("exit", (code) => {
  if (code !== 0) {
    log(`Process exiting with code: ${code}`);
  }
});
(async () => {
  const server = await registerRoutes(app);
  app.use((err, _req, res, _next) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    res.status(status).json({ message });
    console.error("Express error:", err.message);
  });
  if (app.get("env") === "development") {
    const { setupVite: setupVite2 } = await init_vite().then(() => vite_exports);
    await setupVite2(app, server);
  } else {
    serveStatic(app);
  }
  const port = parseInt(process.env.PORT || "5000", 10);
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true
  }, () => {
    log(`serving on port ${port}`);
  });
  setInterval(() => {
    const mem = process.memoryUsage();
    log(`heartbeat | rss:${Math.round(mem.rss / 1024 / 1024)}MB heap:${Math.round(mem.heapUsed / 1024 / 1024)}/${Math.round(mem.heapTotal / 1024 / 1024)}MB`);
  }, 3e4);
})();

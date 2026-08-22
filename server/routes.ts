import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertApplicationSchema, insertBulkApplicationSchema } from "../shared/schema";
import { apiRateLimit, strictApiRateLimit, applicationSubmitRateLimit } from "./middleware/rateLimiting";
import { googleSheetsService } from "./services/google-sheets";
import {
  confirmPayment,
  createOrderId,
  getClientKey,
  getOrder,
  isConfigured as isTossConfigured,
  saveOrder,
} from "./services/toss-payments";
import type { PendingOrder } from "./services/toss-payments";
import { sendEnrollmentNotice } from "./services/enrollment-notify";

/**
 * 결제 승인 뒤 참여 안내를 문자·이메일로 함께 보낸다.
 * 링크는 온라인 강의실(세션등록 I열)로 통일한다 — 실시간 입장과 녹화본이 같은 페이지에 있다.
 * 일괄(대리) 신청은 결제자에게도 링크 전체를 한 통 더 보낸다.
 *
 * ⛔ 여기서 나는 오류가 결제 승인 응답을 막으면 안 된다. 전부 잡아 로그만 남긴다.
 */
async function sendEnrollmentSms(order: PendingOrder) {
  return sendEnrollmentNotice({
    // 주문번호를 수강자마다 붙여 보낸다 — 문자·이메일에 실려야 취소·환불 접수 폼을 채울 수 있다.
    recipients: (order.recipients || []).map((r) => ({ ...r, orderId: order.orderId })),
    payer: order.payer,
    kind: "confirm",
    context: `(주문 ${order.orderId})`,
  });
}

export async function registerRoutes(app: Express): Promise<Server> {
  /**
   * 안내 메일 미리보기 (개발용). 실제 발송은 하지 않는다.
   *   /api/dev/notice-preview?title=<과목명>&type=live|recorded&kind=confirm|reminder
   * 운영에서는 열리지 않는다.
   */
  app.get("/api/dev/notice-preview", async (req, res) => {
    if (process.env.NODE_ENV === "production") return res.status(404).end();
    try {
      const { loadProgramMap } = await import("./services/enrollment-notify");
      const { buildAttendeeMails } = await import("./services/enrollment-email");
      const byTitle = await loadProgramMap();
      const programs = await googleSheetsService.getSecondarySheetPrograms();
      const title = String(req.query.title || (programs as any[])[0]?.title || "");
      const trainingType = String(req.query.type || "live");
      const kind = String(req.query.kind || "confirm") === "reminder" ? "reminder" : "confirm";
      const { mails } = buildAttendeeMails(
        [{ name: "홍길동", phone: "010-1234-5678", email: "preview@example.com", programTitle: title, trainingType }],
        byTitle,
        kind
      );
      if (!mails.length) return res.status(404).send("미리보기를 만들지 못했습니다. title 을 확인하세요.");
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(mails[0].html);
    } catch (error: any) {
      res.status(500).send(String(error?.message || error));
    }
  });

  // Get all training programs
  app.get("/api/programs", async (req, res) => {
    try {
      const programs = await storage.getTrainingPrograms();
      
      // Apply filters if provided
      let filteredPrograms = programs;
      
      const { status, search, date } = req.query;
      
      if (status) {
        filteredPrograms = filteredPrograms.filter(p => p.status === status);
      }
      
      if (search) {
        const searchTerm = (search as string).toLowerCase();
        filteredPrograms = filteredPrograms.filter(p => 
          p.title.toLowerCase().includes(searchTerm) ||
          p.description?.toLowerCase().includes(searchTerm) ||
          p.trainer.toLowerCase().includes(searchTerm)
        );
      }
      
      if (date) {
        const now = new Date();
        const filterDate = date as string;
        
        if (filterDate === "thisMonth") {
          const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
          const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
          filteredPrograms = filteredPrograms.filter(p => 
            p.date >= startOfMonth && p.date <= endOfMonth
          );
        } else if (filterDate === "nextMonth") {
          const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
          const endOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 2, 0);
          filteredPrograms = filteredPrograms.filter(p => 
            p.date >= startOfNextMonth && p.date <= endOfNextMonth
          );
        } else if (filterDate === "thisQuarter") {
          const currentQuarter = Math.floor(now.getMonth() / 3);
          const startOfQuarter = new Date(now.getFullYear(), currentQuarter * 3, 1);
          const endOfQuarter = new Date(now.getFullYear(), (currentQuarter + 1) * 3, 0);
          filteredPrograms = filteredPrograms.filter(p => 
            p.date >= startOfQuarter && p.date <= endOfQuarter
          );
        }
      }
      
      res.json(filteredPrograms);
    } catch (error) {
      console.error("Failed to fetch programs:", error);
      res.status(500).json({ 
        message: "프로그램 데이터를 불러오는데 실패했습니다. Google Sheets 연결을 확인해주세요.",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Get application status for programs - Google Sheets API 보호를 위한 엄격한 제한
  app.get("/api/application-status", strictApiRateLimit, async (req, res) => {
    try {
      const applicationStatus = await googleSheetsService.fetchApplicationStatus();
      res.json(applicationStatus);
    } catch (error) {
      console.error("Failed to fetch application status:", error);
      res.status(500).json({ 
        message: "신청 상태를 불러오는데 실패했습니다.",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Get all notices
  app.get("/api/notices", async (req, res) => {
    try {
      const notices = await storage.getNotices();
      // Sort by priority (high priority first) and then by creation date
      const sortedNotices = notices.sort((a, b) => {
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
        message: "공지사항을 불러오는데 실패했습니다.",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Submit application
  app.post("/api/applications", applicationSubmitRateLimit, async (req, res) => {
    try {
      const validatedData = insertApplicationSchema.parse(req.body);
      
      const isDuplicate = await googleSheetsService.checkDuplicateApplication(
        validatedData.programTitle,
        validatedData.phone,
        validatedData.name
      );
      
      if (isDuplicate) {
        return res.status(409).json({
          message: "이미 동일 과목에 신청이 완료되었습니다.",
          duplicate: true
        });
      }
      
      const application = await storage.submitApplication(validatedData);
      
      res.status(201).json({
        message: "신청이 성공적으로 접수되었습니다.",
        application: {
          id: application.id,
          status: application.status
        }
      });
    } catch (error) {
      console.error("Failed to submit application:", error);
      
      if (error instanceof Error && error.name === "ZodError") {
        res.status(400).json({ 
          message: "입력 데이터가 올바르지 않습니다.",
          error: error.message
        });
      } else {
        res.status(500).json({ 
          message: "신청 제출에 실패했습니다. 다시 시도해주세요.",
          error: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  });

  // ── 토스페이먼츠 결제 ──────────────────────────────────────────────
  // 클라이언트 키는 공개해도 되는 값이라 프론트에 내려준다. 시크릿 키는 서버에만 둔다.
  app.get("/api/payments/config", (req, res) => {
    res.json({ enabled: isTossConfigured(), clientKey: getClientKey() });
  });

  // 신청 접수 + 주문 생성. 금액은 클라이언트를 믿지 않고 시트에서 읽는다.
  // 개별 신청도 여러 과목을 한 번에 담을 수 있다 (programTitles). 과목마다 신청 행이
  // 하나씩 생기고, 결제는 선택한 과목 금액의 합으로 한 번만 일어난다.
  app.post("/api/payments/prepare", applicationSubmitRateLimit, async (req, res) => {
    try {
      if (!isTossConfigured()) {
        return res.status(503).json({ message: "결제 설정이 완료되지 않았습니다. 관리자에게 문의해 주세요." });
      }

      // 예전 단일 과목 요청(programTitle)도 그대로 받는다.
      const requestedTitles: string[] = Array.isArray(req.body?.programTitles) && req.body.programTitles.length > 0
        ? req.body.programTitles.map((title: any) => String(title || "").trim())
        : [String(req.body?.programTitle || "").trim()];
      const titles = Array.from(new Set(requestedTitles.filter(Boolean)));

      if (titles.length === 0) {
        return res.status(400).json({ message: "신청하실 과목을 선택해 주세요." });
      }

      const programs = await googleSheetsService.getSecondarySheetPrograms();
      const selected: any[] = [];

      for (const title of titles) {
        const program = programs.find((p: any) => p.title === title);
        if (!program) {
          return res.status(400).json({ message: `존재하지 않는 과목입니다: ${title}` });
        }
        if (!program.isAvailable) {
          return res.status(409).json({ message: `마감된 과목입니다: ${title}` });
        }
        if (!program.price || program.price <= 0) {
          console.error("❌ 금액 미설정:", title);
          return res.status(503).json({ message: `결제 금액이 설정되지 않은 과목입니다: ${title}` });
        }
        selected.push(program);
      }

      // 과목별로 신청 데이터를 만들어 검증한다. 신청자 정보는 한 벌을 공유한다.
      const validatedByProgram = selected.map((program: any) =>
        insertApplicationSchema.parse({
          ...req.body,
          programId: program.id,
          programTitle: program.title,
        })
      );

      // 이미 신청한 과목은 빼고 접수한다. 결제 금액도 그만큼 줄어든다.
      const duplicateTitles: string[] = [];
      const pending: { program: any; data: any }[] = [];

      for (let i = 0; i < selected.length; i++) {
        const isDuplicate = await googleSheetsService.checkDuplicateApplication(
          selected[i].title,
          validatedByProgram[i].phone,
          validatedByProgram[i].name
        );
        if (isDuplicate) duplicateTitles.push(selected[i].title);
        else pending.push({ program: selected[i], data: validatedByProgram[i] });
      }

      if (pending.length === 0) {
        return res.status(409).json({
          message: titles.length === 1
            ? "이미 동일 과목에 신청이 완료되었습니다."
            : `선택하신 과목이 모두 이미 신청 완료된 과목입니다: ${duplicateTitles.join(", ")}`,
          duplicate: true,
          duplicateTitles,
        });
      }

      // 결제를 끝내지 못하고 이탈한 분은 **자기 행으로 되돌아간다**. 새 행을 만들면
      // 재시도할 때마다 결제대기가 늘어 실제 사람 수와 어긋난다.
      // 지역·챕터·이름·연락처·과목명이 전부 같을 때만 같은 신청으로 본다.
      const reusableRows = await googleSheetsService.findReusableRows(
        pending.map((item) => ({
          programTitle: item.data.programTitle,
          region: item.data.region || "",
          chapter: item.data.chapter || "",
          name: item.data.name,
          phone: item.data.phone,
        }))
      );
      // 한 요청 안에서 같은 행을 두 번 쓰지 않는다 (명단에 같은 줄이 두 번 있는 경우).
      const usedRows = new Set<number>();

      // 결제 전에 신청 행을 먼저 만든다. J열(결제완료)은 비어 있어 아직 집계되지 않는다.
      const sheetRows: number[] = [];
      const rowAmounts: number[] = [];
      const recorded: any[] = [];

      for (const item of pending) {
        const key = googleSheetsService.buildReuseKey({
          programTitle: item.data.programTitle,
          region: item.data.region || "",
          chapter: item.data.chapter || "",
          name: item.data.name,
          phone: item.data.phone,
        });
        const candidate = reusableRows.get(key);
        const reuseRow = candidate && !usedRows.has(candidate) ? candidate : undefined;
        if (reuseRow) usedRows.add(reuseRow);

        const application = await storage.submitApplication(item.data, reuseRow);
        const sheetRow = (application as any).sheetRow as number | undefined;
        if (typeof sheetRow === "number" && sheetRow > 1) {
          sheetRows.push(sheetRow);
          rowAmounts.push(item.program.price);
          recorded.push(item.program);
        } else {
          console.error("⚠ 신청 행이 기록되지 않았습니다:", item.program.title);
        }
      }

      if (sheetRows.length === 0) {
        console.error("❌ 신청이 시트에 기록되지 않아 결제를 중단합니다:", titles.join(", "));
        return res.status(500).json({ message: "신청 기록에 실패했습니다. 내셔널 오피스로 문의해 주세요." });
      }

      const amount = rowAmounts.reduce((sum, price) => sum + price, 0);
      const orderName = recorded.length === 1
        ? recorded[0].title
        : `${recorded[0].title} 외 ${recorded.length - 1}과목`;
      const applicant = validatedByProgram[0];
      const orderId = createOrderId();

      saveOrder({
        orderId,
        amount,
        orderName,
        programTitle: recorded.map((p: any) => p.title).join(", "),
        name: applicant.name,
        phone: applicant.phone,
        email: applicant.email,
        createdAt: Date.now(),
        sheetRow: sheetRows[0],
        sheetRows,
        rowAmounts,
        // 승인 뒤 참여 링크 문자를 보낼 대상. 개별 신청은 신청자 본인이 과목 수만큼 들어간다.
        recipients: recorded.map((p: any) => ({
          name: applicant.name,
          phone: applicant.phone,
          email: applicant.email,
          programTitle: p.title,
          trainingType: applicant.trainingType || "live",
        })),
        status: "pending",
      });

      res.status(201).json({
        orderId,
        amount,
        orderName,
        clientKey: getClientKey(),
        customerName: applicant.name,
        customerEmail: applicant.email,
        customerMobilePhone: String(applicant.phone || "").replace(/[^0-9]/g, ""),
        sessions: recorded.map((p: any) => ({ title: p.title, price: p.price })),
        skippedDuplicates: duplicateTitles,
      });
    } catch (error) {
      console.error("결제 준비 실패:", error);
      if (error instanceof Error && error.name === "ZodError") {
        return res.status(400).json({ message: "입력 데이터가 올바르지 않습니다." });
      }
      res.status(500).json({ message: "결제 준비에 실패했습니다. 다시 시도해 주세요." });
    }
  });

  /**
   * 일괄 신청 결제 준비.
   * 한 분이 여러 사람의 신청을 대신한다. 사람마다 과목이 다를 수 있으므로
   * 행(사람 x 과목)마다 시트 L열 단가를 따로 읽어 합계를 낸다.
   * 금액은 클라이언트를 믿지 않는다 — 서버가 다시 계산한 값만 청구된다.
   */
  app.post("/api/payments/prepare-bulk", applicationSubmitRateLimit, async (req, res) => {
    try {
      if (!isTossConfigured()) {
        return res.status(503).json({ message: "결제 설정이 완료되지 않았습니다. 관리자에게 문의해 주세요." });
      }

      const { applications, payer } = req.body || {};

      if (!Array.isArray(applications) || applications.length === 0) {
        return res.status(400).json({ message: "신청 명단이 비어 있습니다." });
      }
      const payerEmail = String(payer?.email || "").trim();
      if (!payer || !String(payer.name || "").trim() || !String(payer.phone || "").trim() || !payerEmail) {
        return res.status(400).json({ message: "결제자 성명·연락처·이메일을 입력해 주세요." });
      }
      // 영수증이 가는 주소라 형식까지 본다
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payerEmail)) {
        return res.status(400).json({ message: "결제자 이메일 주소가 올바르지 않습니다." });
      }

      const programs = await googleSheetsService.getSecondarySheetPrograms();

      // 명단에 등장하는 과목을 먼저 전부 확인한다. 하나라도 어긋나면 접수 전에 멈춘다.
      const requestedTitles = Array.from(
        new Set(applications.map((app: any) => String(app.programTitle || "").trim()))
      ).filter(Boolean);

      if (requestedTitles.length === 0) {
        return res.status(400).json({ message: "신청할 과목이 지정되지 않았습니다." });
      }

      const priceByTitle = new Map<string, number>();
      for (const title of requestedTitles) {
        const program = programs.find((p: any) => p.title === title);
        if (!program) {
          return res.status(400).json({ message: `존재하지 않는 과목입니다: ${title}` });
        }
        if (!program.isAvailable) {
          return res.status(409).json({ message: `마감된 과목입니다: ${title}` });
        }
        if (!program.price || program.price <= 0) {
          console.error("❌ 금액 미설정:", title);
          return res.status(503).json({ message: `결제 금액이 설정되지 않은 과목입니다: ${title}` });
        }
        priceByTitle.set(title, program.price);
      }

      // 이미 신청된 (사람, 과목)은 빼고 접수한다. 결제 금액도 그만큼 줄어든다.
      // 중복 판정은 연락처로 한다. 연락처를 안 적은 분은 판정할 수 없으니 그대로 접수한다
      // (빈 연락처끼리 같은 사람으로 묶여 엉뚱하게 빠지는 것을 막는다).
      const duplicateEntries = await googleSheetsService.checkBulkDuplicates(
        applications
          .filter((app: any) => String(app.phone || "").replace(/\D/g, "").length > 0)
          .map((app: any) => ({
            programTitle: String(app.programTitle || "").trim(),
            phone: String(app.phone || "").trim(),
            name: String(app.name || "").trim(),
          }))
      );
      const duplicateKeys = new Set(
        duplicateEntries.map((d: any) => `${d.programTitle}|${d.phone.replace(/\D/g, "")}`)
      );
      const duplicateNames = duplicateEntries.map((d: any) =>
        d.programTitle ? `${d.name}(${d.programTitle})` : d.name
      );

      const filtered = applications.filter((app: any) => {
        const normalizedPhone = String(app.phone || "").trim().replace(/\D/g, "");
        if (!normalizedPhone) return true;
        return !duplicateKeys.has(`${String(app.programTitle || "").trim()}|${normalizedPhone}`);
      });

      if (filtered.length === 0) {
        return res.status(409).json({
          message: `명단이 모두 기존 신청자입니다: ${duplicateNames.join(", ")}`,
          duplicate: true,
          duplicateNames,
        });
      }

      const validated = filtered.map((app: any) =>
        insertBulkApplicationSchema.parse({
          ...app,
          programId: app.programId || `bulk-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          name: String(app.name || "").trim(),
          email: app.email ? String(app.email).trim() : "",
          phone: String(app.phone || "").trim(),
          region: String(app.region || "").trim(),
          chapter: String(app.chapter || "").trim(),
          participationType: String(app.participationType || "실시간 참여").trim(),
          notes: String(app.notes || "").trim(),
          programTitle: String(app.programTitle || "").trim(),
          trainingType: app.trainingType || "live",
        })
      );

      // 이탈 후 재신청은 기존 행을 다시 쓴다 (개별 신청과 같은 규칙).
      const reusableRows = await googleSheetsService.findReusableRows(
        validated.map((app: any) => ({
          programTitle: app.programTitle,
          region: app.region || "",
          chapter: app.chapter || "",
          name: app.name,
          phone: app.phone,
        }))
      );
      const usedRows = new Set<number>();
      const reuseRowsForSubmit: Array<number | undefined> = validated.map((app: any) => {
        const key = googleSheetsService.buildReuseKey({
          programTitle: app.programTitle,
          region: app.region || "",
          chapter: app.chapter || "",
          name: app.name,
          phone: app.phone,
        });
        const candidate = reusableRows.get(key);
        if (!candidate || usedRows.has(candidate)) return undefined;
        usedRows.add(candidate);
        return candidate;
      });

      // 결제 전에 신청 행을 먼저 만든다. J열(결제완료)이 비어 있어 아직 집계되지 않는다.
      const submitted = await storage.bulkSubmitApplications(validated, reuseRowsForSubmit);

      // 행 번호와 금액을 같은 순서로 모은다. 과목마다 단가가 달라도 행별로 정확히 기록된다.
      const sheetRows: number[] = [];
      const rowAmounts: number[] = [];
      const recordedTitles: string[] = [];
      // 실제로 접수된 행만 문자 대상이 된다. 연락처를 안 적은 분은 뒤에서 걸러진다.
      const recipients: Array<{ name: string; phone: string; email: string; programTitle: string; trainingType: string }> = [];

      submitted.forEach((application: any, index: number) => {
        const sheetRow = application?.sheetRow as number | undefined;
        if (typeof sheetRow !== "number" || sheetRow <= 1) return;
        const title = validated[index]?.programTitle || "";
        sheetRows.push(sheetRow);
        rowAmounts.push(priceByTitle.get(title) || 0);
        recordedTitles.push(title);
        recipients.push({
          name: String(validated[index]?.name || "").trim(),
          phone: String(validated[index]?.phone || "").trim(),
          email: String(validated[index]?.email || "").trim(),
          programTitle: title,
          trainingType: validated[index]?.trainingType || "live",
        });
      });

      if (sheetRows.length === 0) {
        console.error("❌ 일괄 신청이 시트에 기록되지 않아 결제를 중단합니다:", requestedTitles.join(", "));
        return res.status(500).json({ message: "신청 명단 기록에 실패했습니다. 내셔널 오피스로 문의해 주세요." });
      }

      const quantity = sheetRows.length;
      const amount = rowAmounts.reduce((sum, price) => sum + price, 0);
      const distinctTitles = Array.from(new Set(recordedTitles));
      const memberCount = new Set(
        validated.map(
          (app: any) => String(app.phone || "").replace(/\D/g, "") || String(app.name || "").trim()
        )
      ).size;

      const orderName = distinctTitles.length === 1
        ? `${distinctTitles[0]} ${quantity}건`
        : `${distinctTitles[0]} 외 ${quantity - 1}건`;

      const orderId = createOrderId("LTT-BULK");

      saveOrder({
        orderId,
        amount,
        orderName,
        programTitle: distinctTitles.join(", "),
        name: String(payer.name).trim(),
        phone: String(payer.phone).trim(),
        email: String(payer.email || "").trim(),
        createdAt: Date.now(),
        sheetRows,
        rowAmounts,
        quantity,
        recipients,
        payer: {
          name: String(payer.name).trim(),
          phone: String(payer.phone).trim(),
          email: String(payer.email || "").trim(),
        },
        status: "pending",
      });

      res.status(201).json({
        orderId,
        amount,
        quantity,
        memberCount,
        orderName,
        clientKey: getClientKey(),
        customerName: String(payer.name).trim(),
        customerEmail: String(payer.email || "").trim(),
        customerMobilePhone: String(payer.phone || "").replace(/[^0-9]/g, ""),
        sessions: distinctTitles.map((title) => ({ title, price: priceByTitle.get(title) || 0 })),
        skippedDuplicates: duplicateNames,
      });
    } catch (error: any) {
      console.error("일괄 결제 준비 실패:", error);
      if (error?.name === "ZodError") {
        return res.status(400).json({ message: "명단의 양식에 오류가 있어 신청이 보류되었습니다." });
      }
      res.status(500).json({ message: "결제 준비에 실패했습니다. 다시 시도해 주세요." });
    }
  });

  // 결제 승인. 토스가 successUrl 로 돌려준 값을 그대로 받아 승인을 요청한다.
  app.post("/api/payments/confirm", async (req, res) => {
    try {
      const { paymentKey, orderId, amount } = req.body || {};

      if (!paymentKey || !orderId || amount === undefined) {
        return res.status(400).json({ message: "결제 정보가 올바르지 않습니다." });
      }

      const order = getOrder(String(orderId));
      if (!order) {
        // 재배포 등으로 주문이 사라진 경우. 승인하지 않고 사람이 확인하게 둔다.
        console.error("❌ 알 수 없는 주문:", orderId);
        return res.status(404).json({
          message: "주문 정보를 찾을 수 없습니다. 결제가 진행됐다면 내셔널 오피스로 문의해 주세요.",
        });
      }

      // 금액 위변조 방지: 시트에서 읽어 저장해 둔 금액과 반드시 같아야 한다.
      if (Number(amount) !== order.amount) {
        console.error(`❌ 금액 불일치: 요청 ${amount} / 주문 ${order.amount} (${orderId})`);
        return res.status(400).json({ message: "결제 금액이 일치하지 않습니다." });
      }

      if (order.status === "paid") {
        return res.json({ ok: true, alreadyConfirmed: true, orderName: order.orderName });
      }

      const result = await confirmPayment({
        paymentKey: String(paymentKey),
        orderId: String(orderId),
        amount: order.amount,
      });

      if (!result.ok) {
        order.status = "failed";
        return res.status(400).json({ message: result.message, code: result.code });
      }

      order.status = "paid";
      order.paymentKey = String(paymentKey);

      // 승인은 끝났으므로 시트 기록이 실패해도 결제 자체는 유효하다.
      // 사용자에게 실패로 보이지 않게 하되, 로그로 남겨 수기 보정이 가능하게 한다.
      // 일괄 결제는 한 주문이 여러 행을 덮는다. 한 행이 실패해도 나머지는 계속 찍는다.
      const rowsToMark = order.sheetRows?.length ? order.sheetRows : [order.sheetRow || 0];
      for (let i = 0; i < rowsToMark.length; i++) {
        const row = rowsToMark[i];
        // 다과목 개별 신청은 행마다 금액이 다를 수 있어 rowAmounts 를 먼저 본다.
        const rowAmount = order.rowAmounts?.[i]
          ?? (order.quantity ? order.amount / order.quantity : order.amount);
        try {
          await googleSheetsService.markApplicationPaid(row, {
            orderId: order.orderId,
            paymentKey: String(paymentKey),
            method: result.method,
            approvedAt: result.approvedAt,
            amount: rowAmount,
          });
        } catch (sheetError) {
          console.error(`⚠ 결제는 승인됐으나 시트 기록에 실패했습니다: ${order.orderId} (행 ${row})`, sheetError);
        }
      }

      // 참여 링크 문자. 실패해도 결제는 유효하므로 응답을 막지 않는다.
      const smsResult = await sendEnrollmentSms(order);

      res.json({
        ok: true,
        orderId: order.orderId,
        orderName: order.orderName,
        amount: order.amount,
        method: result.method,
        approvedAt: result.approvedAt,
        receiptUrl: result.receiptUrl,
        sms: smsResult,
      });
    } catch (error) {
      console.error("결제 승인 처리 실패:", error);
      res.status(500).json({ message: "결제 승인 처리 중 오류가 발생했습니다." });
    }
  });

  // Get application status
  app.get("/api/applications/:id", async (req, res) => {
    try {
      const application = await storage.getApplication(req.params.id);
      
      if (!application) {
        return res.status(404).json({ message: "신청 내역을 찾을 수 없습니다." });
      }
      
      res.json(application);
    } catch (error) {
      console.error("Failed to fetch application:", error);
      res.status(500).json({ 
        message: "신청 내역 조회에 실패했습니다.",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Bulk application submission endpoint
  app.post("/api/applications/bulk", async (req, res) => {
    try {
      const { applications } = req.body;
      
      if (!Array.isArray(applications)) {
        return res.status(400).json({
          success: false,
          message: "신청 데이터는 배열 형태여야 합니다."
        });
      }

      const duplicateEntries = await googleSheetsService.checkBulkDuplicates(
        applications.map((app: any) => ({
          programTitle: String(app.programTitle || "").trim(),
          phone: String(app.phone || "").trim(),
          name: String(app.name || "").trim()
        }))
      );

      const duplicateKeys = new Set(
        duplicateEntries.map((d: any) => `${d.programTitle}|${d.phone.replace(/\D/g, '')}`)
      );
      const duplicateNames = duplicateEntries.map((d: any) => `${d.name}(${d.programTitle})`);

      const filteredApplications = duplicateKeys.size > 0
        ? applications.filter((app: any) => {
            const key = `${String(app.programTitle || "").trim()}|${String(app.phone || "").trim().replace(/\D/g, '')}`;
            return !duplicateKeys.has(key);
          })
        : applications;

      if (filteredApplications.length === 0 && duplicateKeys.size > 0) {
        return res.status(409).json({
          success: false,
          message: `이미 동일 과목에 신청이 완료된 인원이 있습니다: ${duplicateEntries.map((d: any) => d.name).join(', ')}`,
          duplicate: true,
          duplicateNames: duplicateEntries.map((d: any) => d.name)
        });
      }

      // programId를 자동 생성하여 추가하고 데이터 정규화
      const validatedApplications = filteredApplications.map((app: any, index: number) => {
        try {
          const normalizedApp = {
            ...app,
            programId: app.programId || `bulk-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            name: String(app.name || "").trim(),
            email: app.email ? String(app.email).trim() : "",
            phone: String(app.phone || "").trim(),
            region: String(app.region || "").trim(),
            chapter: String(app.chapter || "").trim(),
            participationType: String(app.participationType || "실시간 참여").trim(),
            notes: String(app.notes || "").trim(),
            programTitle: String(app.programTitle || "").trim(),
            trainingType: app.trainingType || "live"
          };
          
          return insertBulkApplicationSchema.parse(normalizedApp);
        } catch (error: any) {
          console.error(`Error validating application at index ${index}:`, error);
          console.error(`Failed data:`, app);
          const row = index + 2;
          const fieldMessages: string[] = [];
          if (error?.issues) {
            for (const issue of error.issues) {
              const field = issue.path?.join('.') || '알 수 없는 필드';
              fieldMessages.push(`${field}: ${issue.message}`);
            }
          }
          const validationError: any = new Error("VALIDATION_ERROR");
          validationError.validationDetails = {
            row,
            name: String(app.name || "").trim(),
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
        message: `${submittedApplications.length}개의 신청이 성공적으로 제출되었습니다.`,
        skippedDuplicates: duplicateNames,
        partialSuccess: duplicateNames.length > 0
      });
    } catch (error: any) {
      console.error("Error bulk submitting applications:", error);
      
      if (error?.message === "VALIDATION_ERROR" && error.validationDetails) {
        const details = error.validationDetails;
        res.status(400).json({ 
          success: false,
          type: "validation",
          message: "명단의 양식에 오류가 있어 신청이 보류되었습니다.",
          row: details.row,
          name: details.name,
          fields: details.fields
        });
      } else if (error instanceof Error && error.name === "ZodError") {
        res.status(400).json({ 
          success: false,
          type: "validation",
          message: "명단의 양식에 오류가 있어 신청이 보류되었습니다.",
          fields: [error.message]
        });
      } else {
        res.status(500).json({ 
          success: false,
          type: "server",
          message: "일괄 신청 제출에 실패했습니다. 다시 시도해주세요.",
          error: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  });

  // Get all applications endpoint - 실제 Google Sheets에서 신청 데이터 가져오기
  app.get("/api/applications", strictApiRateLimit, async (req, res) => {
    try {
      // Google Sheets에서 실제 신청 데이터 가져오기
      const applications = await googleSheetsService.getApplicationsFromSheet();
      
      res.json(applications);
    } catch (error) {
      console.error("Error fetching applications from Google Sheets:", error);
      
      // 구글 시트 연동 실패시 메모리 스토리지 백업 사용
      try {
        const applications = await storage.getAllApplications();
        res.json(applications);
      } catch (backupError) {
        console.error("백업 스토리지도 실패:", backupError);
        res.status(500).json({ 
          message: "신청 내역 조회에 실패했습니다. Google Sheets 연결을 확인해주세요.",
          error: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  });

  // Google Sheets 연동 정보 확인
  app.get("/api/sheets/info", apiRateLimit, async (req, res) => {
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
        message: isSecondaryConfigured ? "양방향 연동: 2개 시트 설정됨" : "양방향 연동: 1개 시트 설정됨"
      });
    } catch (error) {
      console.error("Failed to get sheets info:", error);
      res.status(500).json({ 
        message: "Google Sheets 정보를 가져오는데 실패했습니다.",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // 두 번째 시트의 프로그램 정보 가져오기
  app.get("/api/secondary-programs", strictApiRateLimit, async (req, res) => {
    try {
      const programs = await googleSheetsService.getSecondarySheetPrograms();
      
      // 결제완료된 신청자 수 조회
      const completedCounts = await googleSheetsService.getAllProgramsCompletedCounts();

      // 신청 상태 조회 (K열의 "마감" 상태)
      const applicationStatus = await googleSheetsService.fetchApplicationStatus();
      console.log('🔍 /api/secondary-programs applicationStatus:', JSON.stringify(applicationStatus));

      // 프로그램에 결제완료 신청자 수와 신청 상태 추가
      const programsWithCounts = programs.map(program => {
        
        // 신청자 카운트 데이터에서 해당 프로그램 찾기 (여러 형식 시도)
        let completedCount = 0;
        
        // 멘토링 코디네이터는 완전히 독립적인 처리 (기존 로직 완전 건너뜀)
        if (program.title.includes('멘토링')) {
          
          // 멘토링만을 위한 완전히 새로운 카운팅 (초기화)
          
          // 완전히 새로운 멘토링 전용 카운트 (기존 completedCount 무시)
          let mentoringOnlyCount = 0;
          
          // 정확한 멘토링 관련 키들만 합산 (Google Sheets 확인된 5개 항목)
          const mentoringKeys = [
            'LTT : 멘토링 코디네이터 T',     // 1명
            'LTT : 멘토링 코디네이터 T ',    // 2명 (공백)
            'LTT : 멘토링 코디네이터 T.',    // 1명 (점)
            '멘토링 코디네이터 T'              // 1명
          ];
          
          
          mentoringKeys.forEach(key => {
            const count = completedCounts[key] || 0;
            if (count > 0) {
              mentoringOnlyCount += count;
            }
          });
          
          // 최종적으로 completedCount에 멘토링 전용 카운트 할당
          completedCount = mentoringOnlyCount;
        } else {
          // 다른 프로그램들만 기존 로직 사용
          
          // 1. 정확한 매칭 시도
          if (completedCounts[program.title]) {
            completedCount = completedCounts[program.title];
          }
          
          // 2. LT Training 형식으로 변환하여 시도
          const ltTrainingFormat = program.title.replace('LTT :', 'LT Training:');
          if (completedCounts[ltTrainingFormat]) {
            completedCount += completedCounts[ltTrainingFormat];
          }
          
          // 3. 짧은 형태 매칭 시도 (일괄 업로드에서 사용된 짧은 형태) - 항상 실행하여 합산
          const shortFormMap: Record<string, string[]> = {
          'LTT : 파운데이션 T.': [
            '파운데이션', '파운데이션 T.', '파운데이션 트레이닝', '파운데이션트레이닝'
          ],
          'LTT : 멤버십 위원회 T.': [
            '멤버십위원회', '멤버십 위원회', '멤버십 위원회 T.', '멤버십', 
            '멤버십위원회T', '멤버십 위 원회'
          ],
          'LTT : PR 코디네이터T.': [
            'PR코디', 'pr코디', 'PR 코디', 'pr 코디', 'PR코디네이터', 'PR코디네이터T', 'PR 코디네이터',
            'PR', '피알 코디네이터', 'PR 코디네이터T.'
          ],
          'LTT : 교육 코디네이터 T.': [
            '교육코디네이터', '교육 코디네이터', '교육 코디', '교육코디', '교육',
            '교육코디네이터T', '교육 코디네이터 T.'
          ],
          'LTT : 성장 코디네이터 T.': [
            '성장코디네이터', '성장 코디네이터', '성장코디', '성장 코디', '성장',
            '성장코디네이터T', '성장 코디네이터 T.'
          ],
          'LTT : ST T.': [
            'ST도어퍼슨', 'ST & 도어퍼슨', 'ST', 'ST 도어퍼슨', '도어퍼슨',
            'ST & 도어퍼슨 T.', 'ST T.', 'LTT : ST & 도어퍼슨 T.'
          ],
          'LTT : 비지터 호스트 T.': [
            '비지터호스트', '비지터 호스트', '비지터', '비지터호스트T',
            '비지터 호스트 T.'
          ],
          'LTT : 이벤트 코디네이터 T.': [
            '이벤트코디네이터', '이벤트 코디네이터', '이벤트코디', '이벤트',
            '이벤트코디네이터T', '이벤트 코디네이터 T.'
          ],
          // 멘토링은 특별 처리되므로 여기서 제외
        };
        
          // 다른 프로그램들은 기존 로직 사용
          
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
          completedCount: completedCount,
          currentParticipants: completedCount, // 프로그램 카드에서 사용하는 필드명과 통일
          isAvailable: (program.title in applicationStatus) ? applicationStatus[program.title] : program.isAvailable // K열 마감 상태 우선, 없으면 기본값 사용
        };
      });
      
      // 캐시 비활성화로 실시간 반영 보장
      res.set({
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      });
      res.json(programsWithCounts);
    } catch (error) {
      console.error("Failed to fetch secondary programs:", error);
      res.status(500).json({ 
        message: "두 번째 시트 프로그램 정보를 가져오는데 실패했습니다.",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Get dashboard data
  app.get("/api/dashboard", strictApiRateLimit, async (req, res) => {
    try {
      const dashboardData = await googleSheetsService.getDashboardData();
      res.json(dashboardData);
    } catch (error) {
      console.error("Failed to fetch dashboard data:", error);
      res.status(500).json({ 
        message: "대시보드 데이터를 불러오는데 실패했습니다.",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}

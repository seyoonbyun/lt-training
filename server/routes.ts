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
import { createResumeToken, verifyResumeToken } from "./services/resume-token";
import { applySponsorToItems, normalizePhone, withSponsorNote } from "./services/sponsor-list";
import { idx } from "./services/sheet-schema";

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

/** 0원(지원) 주문의 결제수단 표기. 시트 `결제수단` 열에 이 값이 남는다. */
const FREE_METHOD = "지원(0원)";

/**
 * 승인된 주문을 신청명단에 기록한다 (J열 `완료` + 주문번호·결제키·결제수단·승인일시).
 *
 * ⛔ 유료 결제와 0원 지원이 **같은 함수를 쓴다.** 갈래를 나누면 한쪽만 고쳐지고,
 *    그 결과가 "취소했는데 대시보드는 그대로" 같은 조용한 어긋남으로 돌아온다.
 * ⛔ 승인은 이미 끝났으므로 시트 기록이 실패해도 위로 던지지 않는다. 로그만 남긴다.
 */
async function markOrderRowsPaid(
  order: PendingOrder,
  info: { paymentKey: string; method?: string; approvedAt?: string }
) {
  const rowsToMark = order.sheetRows?.length ? order.sheetRows : [order.sheetRow || 0];
  for (let i = 0; i < rowsToMark.length; i++) {
    const row = rowsToMark[i];
    if (!row || row <= 1) continue;   // 신청 행이 못 만들어진 건 — 결제는 유효하다
    // 다과목 개별 신청은 행마다 금액이 다를 수 있어 rowAmounts 를 먼저 본다.
    const rowAmount = order.rowAmounts?.[i]
      ?? (order.quantity ? order.amount / order.quantity : order.amount);
    try {
      await googleSheetsService.markApplicationPaid(row, {
        orderId: order.orderId,
        paymentKey: info.paymentKey,
        method: info.method,
        approvedAt: info.approvedAt,
        amount: rowAmount,
        // 「결제 이어하기」는 행이 이미 있어 신청 때 결제자를 못 썼다. 여기서 채운다.
        payer: order.payer || { name: order.name, phone: order.phone, email: order.email },
        // 지원 대상 표기(I열). 신청 때 이미 붙은 건은 값이 없어 건드리지 않는다.
        notes: order.rowNotes?.[i],
      });
    } catch (sheetError) {
      console.error(`⚠ 결제는 승인됐으나 시트 기록에 실패했습니다: ${order.orderId} (행 ${row})`, sheetError);
    }
  }
}

/**
 * 결제창에서 이탈한 그 순간 화면에서 바로 결제를 이어갈 수 있도록,
 * 주문을 내려줄 때 「결제 이어하기」 토큰을 함께 준다.
 *
 * 예전에는 이탈하면 토스트 한 줄이 떴다 사라지고 끝이었다 — 실수로 창을 닫은 분도
 * 다음 날 11시 안내 문자를 기다려야 했다(2026-08-22 오픈 당일 결제대기 57건).
 *
 * ⛔ 여기서 실패해도 결제를 막지 않는다. 이어하기는 보조 장치지 결제 경로가 아니다.
 *   (SESSION_SECRET 이 없으면 createResumeToken 이 던진다.)
 */
function resumeTokenFor(rows: number[]): string | undefined {
  if (!rows || rows.length === 0) return undefined;
  try {
    return createResumeToken(rows);
  } catch (error: any) {
    console.error("이어하기 토큰 생성 실패 (결제는 그대로 진행):", error?.message || error);
    return undefined;
  }
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

      // 지원 대상 명단(신청명단 `지원 대상` 탭)에 있으면 그 금액만큼 깎는다.
      // 전액 지원이면 합계가 0원이 되고, 그때는 결제창을 띄우지 않는다(토스는 0원을 못 받는다).
      const sponsored = await applySponsorToItems(
        pending.map((item) => ({
          phone: item.data.phone,
          name: item.data.name,
          region: item.data.region || "",
          chapter: item.data.chapter || "",
          programTitle: item.data.programTitle,
          price: item.program.price,
        }))
      );

      // 결제 전에 신청 행을 먼저 만든다. J열(결제완료)은 비어 있어 아직 집계되지 않는다.
      const sheetRows: number[] = [];
      const rowAmounts: number[] = [];
      const recorded: any[] = [];

      for (let i = 0; i < pending.length; i++) {
        const item = pending[i];
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

        // 지원이 붙은 건은 신청명단 I열(특이사항 & 문의)에 `교육비 지원` 이라고 남긴다.
        // ⭐ 행을 **만들기 전에** 붙인다 — 만든 뒤에 따로 쓰면 시트 호출이 한 번 더 늘고,
        //    신청자가 적은 특이사항을 되읽어야 해서 덮어쓸 위험이 생긴다.
        if (sponsored[i].discount > 0) {
          item.data.notes = withSponsorNote(item.data.notes || "");
        }

        const application = await storage.submitApplication(item.data, reuseRow);
        const sheetRow = (application as any).sheetRow as number | undefined;
        // ⛔ 행이 안 만들어져도 **결제는 진행한다.** 신청은 유효하고, 돈 내려는 분을
        //   막는 것이 훨씬 나쁘다. 행 번호만 0 으로 두고 결제 기록 단계에서 건너뛴다.
        //   기록 실패는 googleSheetsService 가 관리자에게 문자로 알린다.
        sheetRows.push(typeof sheetRow === "number" && sheetRow > 1 ? sheetRow : 0);
        rowAmounts.push(sponsored[i].price);
        recorded.push(item.program);
      }

      const missingRows = sheetRows.filter((r) => !r).length;
      if (missingRows) {
        console.error(`⚠ 신청 행 ${missingRows}건이 기록되지 않았습니다 (결제는 계속): ${titles.join(", ")}`);
      }

      const amount = rowAmounts.reduce((sum, price) => sum + price, 0);
      const listAmount = sponsored.reduce((sum, s) => sum + s.listPrice, 0);
      // 0원이면 토스를 태우지 않고 서버가 자체 승인한다 (/api/payments/confirm-free).
      const free = amount === 0;
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
        free,
        listAmount,
        // 승인 뒤 참여 링크 문자를 보낼 대상. 개별 신청은 신청자 본인이 과목 수만큼 들어간다.
        recipients: recorded.map((p: any, i: number) => ({
          name: applicant.name,
          phone: applicant.phone,
          email: applicant.email,
          programTitle: p.title,
          trainingType: applicant.trainingType || "live",
          // 발송 결과를 이 행에 적는다. sheetRows 와 recorded 는 같은 순서로 쌓인다.
          sheetRow: sheetRows[i],
        })),
        status: "pending",
      });

      res.status(201).json({
        orderId,
        amount,
        free,
        listAmount,
        orderName,
        clientKey: getClientKey(),
        customerName: applicant.name,
        customerEmail: applicant.email,
        customerMobilePhone: String(applicant.phone || "").replace(/[^0-9]/g, ""),
        sessions: recorded.map((p: any, i: number) => ({
          title: p.title,
          price: sponsored[i].price,
          listPrice: sponsored[i].listPrice,
          sponsored: sponsored[i].discount > 0,
        })),
        skippedDuplicates: duplicateTitles,
        resumeToken: resumeTokenFor(sheetRows.filter((r) => r > 1)),
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
      const submitted = await storage.bulkSubmitApplications(validated, reuseRowsForSubmit, {
        name: String(payer.name).trim(),
        phone: String(payer.phone).trim(),
        email: String(payer.email || "").trim(),
      });

      // ⛔ 일괄(대리) 신청에는 교육비 지원을 적용하지 않는다 — 지원은 개별 신청 한정이다.
      //    대신 결제하는 분이 따로 있어 "누구에게 준 지원인가" 가 흐려지고,
      //    수강자 연락처가 선택 입력이라 애초에 판정할 수 없는 줄이 섞인다.

      // 행 번호와 금액을 같은 순서로 모은다. 과목마다 단가가 달라도 행별로 정확히 기록된다.
      const sheetRows: number[] = [];
      const rowAmounts: number[] = [];
      const recordedTitles: string[] = [];
      // 실제로 접수된 행만 문자 대상이 된다. 연락처를 안 적은 분은 뒤에서 걸러진다.
      const recipients: Array<{ name: string; phone: string; email: string; programTitle: string; trainingType: string; sheetRow?: number }> = [];

      submitted.forEach((application: any, index: number) => {
        const raw = application?.sheetRow as number | undefined;
        // 행이 없어도 건너뛰지 않는다. 그 사람만 조용히 빠지면 결제 금액이 줄고,
        // 본인은 신청된 줄 알지만 명단에 없다. 결제는 그대로 하고 행만 0 으로 둔다.
        const sheetRow = typeof raw === "number" && raw > 1 ? raw : 0;
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
          sheetRow,
        });
      });

      const missingBulk = sheetRows.filter((r) => !r).length;
      if (missingBulk) {
        console.error(`⚠ 일괄 신청 ${missingBulk}건이 시트에 기록되지 않았습니다 (결제는 계속): ${requestedTitles.join(", ")}`);
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
        resumeToken: resumeTokenFor(sheetRows.filter((r) => r > 1)),
      });
    } catch (error: any) {
      console.error("일괄 결제 준비 실패:", error);
      if (error?.name === "ZodError") {
        return res.status(400).json({ message: "명단의 양식에 오류가 있어 신청이 보류되었습니다." });
      }
      res.status(500).json({ message: "결제 준비에 실패했습니다. 다시 시도해 주세요." });
    }
  });

  /**
   * ── 「결제 이어하기」 ────────────────────────────────────────────────
   * 결제를 끝내지 못한 분에게 링크 한 줄을 보내면, 아무것도 다시 입력하지 않고
   * 결제만 이어서 할 수 있다. 단체 신청은 명단 15명을 다시 타이핑해야 했다.
   *
   * 토큰에는 행 번호만 들어 있다. 금액·수신자·과목은 전부 **시트를 다시 읽어** 만든다.
   * 링크를 고쳐도 청구 금액은 바뀌지 않는다.
   */
  async function loadResumeItems(token: string) {
    const payload = verifyResumeToken(token);
    if (!payload) return { error: "만료되었거나 올바르지 않은 링크입니다. 내셔널 오피스로 문의해 주세요." as string };

    const rowMap = await googleSheetsService.getApplicationRowsByNumbers(payload.rows);
    const programs = await googleSheetsService.getSecondarySheetPrograms();

    const items: Array<{ row: number; title: string; name: string; phone: string; email: string; region: string; chapter: string; participationType: string; price: number; listPrice?: number; notes?: string; sponsorNote?: string }> = [];
    const alreadyPaid: string[] = [];
    const closed: string[] = [];

    // 결제자는 토큰에 담지 않는다(링크를 짧게 유지해야 문자로 보낼 수 있다).
    // 묶음의 첫 행에서 읽는다 - 단체 신청은 신청자 본인이 먼저 들어간다.
    const head = rowMap.get(payload.rows[0]);
    const payer = {
      name: String(head?.[4] || "").trim(),
      phone: String(head?.[5] || "").trim(),
      email: String(head?.[6] || "").trim() || undefined,
    };

    for (const rowNo of payload.rows) {
      const row = rowMap.get(rowNo);
      if (!row) continue;

      const title = String(row[1] || "").trim();
      const who = `${String(row[4] || "").trim()}(${title.replace(/^LTT\s*:\s*/, "")})`;

      // 그 사이에 결제됐거나 취소됐으면 조용히 뺀다. 두 번 청구하면 안 된다.
      if (!googleSheetsService.isRowPayable(row)) { alreadyPaid.push(who); continue; }

      const program = programs.find((p: any) => p.title === title);
      if (!program || !program.isAvailable || !program.price || program.price <= 0) {
        closed.push(who);
        continue;
      }

      items.push({
        row: rowNo,
        title,
        name: String(row[4] || "").trim(),
        phone: String(row[5] || "").trim(),
        email: String(row[6] || "").trim(),
        // 지원 판정에 지역·챕터가 필요하다. 열 위치는 스키마에서 가져온다.
        region: String(row[idx("지역")] || "").trim(),
        chapter: String(row[idx("챕터")] || "").trim(),
        participationType: String(row[7] || "").trim(),
        // I열 표기를 덧붙일 때 신청자가 쓴 내용을 지우지 않으려고 원문을 들고 간다.
        notes: String(row[idx("특이사항 & 문의")] || "").trim(),
        price: program.price,
      });
    }

    // 지원 대상은 여기서 깎는다. 화면에 보이는 금액과 실제 청구가 한 곳에서 나온다 —
    // 따로 계산하면 화면은 0원인데 청구는 정가인 사고가 난다.
    //
    // ⛔ 지원은 **개별 신청 한정**이다. 이어하기 링크에는 개별 행과 일괄(대리) 행이 섞여
    //    들어오므로 행마다 가른다 — 개별 신청은 결제자가 신청자 본인이라 두 연락처가 같고,
    //    일괄은 대신 내는 분이 따로 있어 다르다. 결제자 연락처가 아직 비어 있는 옛 행은
    //    본인 결제로 본다(개별 신청이 그 열을 채우기 전에 만들어진 행).
    const selfPaid = items.map((i) => {
      const payerPhone = normalizePhone(String(rowMap.get(i.row)?.[idx("결제자 연락처")] || ""));
      return !payerPhone || payerPhone === normalizePhone(i.phone);
    });
    const sponsored = await applySponsorToItems(
      items.map((i, n) => ({
        phone: selfPaid[n] ? i.phone : "",   // 대리 결제 건은 판정 자체를 하지 않는다
        name: i.name,
        region: i.region,
        chapter: i.chapter,
        programTitle: i.title,
        price: i.price,
      }))
    );
    items.forEach((item, i) => {
      item.listPrice = sponsored[i].listPrice;
      item.price = sponsored[i].price;
      // 이어하기 행은 신청 때 만들어져 표기가 없을 수 있다. 승인 시점에 채운다.
      if (sponsored[i].discount > 0) item.sponsorNote = withSponsorNote(item.notes || "");
    });

    return { payload, payer, items, alreadyPaid, closed };
  }

  // 링크를 열면 보이는 내역. 결제는 아직 만들지 않는다.
  app.get("/api/payments/resume/:token", async (req, res) => {
    try {
      const loaded = await loadResumeItems(String(req.params.token || ""));
      if ("error" in loaded && loaded.error) return res.status(404).json({ message: loaded.error });

      const { payload, payer, items, alreadyPaid, closed } = loaded as any;
      res.json({
        payer,
        amount: items.reduce((sum: number, i: any) => sum + i.price, 0),
        quantity: items.length,
        memberCount: new Set(items.map((i: any) => i.phone.replace(/\D/g, "") || i.name)).size,
        items: items.map((i: any) => ({
          row: i.row, name: i.name, title: i.title,
          participationType: i.participationType, price: i.price,
          listPrice: i.listPrice ?? i.price,
          sponsored: (i.listPrice ?? i.price) > i.price,
        })),
        listAmount: items.reduce((sum: number, i: any) => sum + (i.listPrice ?? i.price), 0),
        alreadyPaid,
        closed,
        expiresAt: payload.exp,
      });
    } catch (error) {
      console.error("결제 이어하기 조회 실패:", error);
      res.status(500).json({ message: "신청 내역을 불러오지 못했습니다." });
    }
  });

  // [결제하기] 를 누르면 주문을 만든다. 금액은 여기서 시트 값으로 다시 계산된다.
  app.post("/api/payments/resume/:token", applicationSubmitRateLimit, async (req, res) => {
    try {
      if (!isTossConfigured()) {
        return res.status(503).json({ message: "결제 설정이 완료되지 않았습니다. 관리자에게 문의해 주세요." });
      }

      const loaded = await loadResumeItems(String(req.params.token || ""));
      if ("error" in loaded && loaded.error) return res.status(404).json({ message: loaded.error });

      const { payload, payer, items: allItems, alreadyPaid } = loaded as any;

      // 주문서 수정: 결제할 건을 골라 보낼 수 있다. 링크가 담고 있는 행 안에서만 고를 수 있고,
      // 안 보내면 전부 결제한다. 제외한 건은 결제되지 않고 신청 대기로 남는다.
      const requested = Array.isArray(req.body?.rows) ? req.body.rows.map((n: any) => Number(n)) : null;
      const items = requested
        ? allItems.filter((i: any) => requested.includes(i.row))
        : allItems;

      if (requested && items.length !== new Set(requested).size) {
        return res.status(400).json({ message: "선택하신 항목이 올바르지 않습니다. 화면을 새로고침해 주세요." });
      }

      if (items.length === 0) {
        return res.status(409).json({
          message: alreadyPaid.length > 0
            ? "이미 결제가 완료된 신청입니다."
            : "결제할 수 있는 신청이 없습니다. 내셔널 오피스로 문의해 주세요.",
          alreadyPaid,
        });
      }

      const amount = items.reduce((sum: number, i: any) => sum + i.price, 0);
      const listAmount = items.reduce((sum: number, i: any) => sum + (i.listPrice ?? i.price), 0);
      const free = amount === 0;
      const distinctTitles = Array.from(new Set(items.map((i: any) => i.title))) as string[];
      const orderName = distinctTitles.length === 1
        ? `${distinctTitles[0]} ${items.length}건`
        : `${distinctTitles[0]} 외 ${items.length - 1}건`;
      const orderId = createOrderId("LTT-RESUME");

      saveOrder({
        orderId,
        amount,
        orderName,
        programTitle: distinctTitles.join(", "),
        name: payer.name,
        phone: payer.phone,
        email: payer.email || "",
        createdAt: Date.now(),
        // 승인되면 이 행들의 J열이 찍힌다 — 새 행이 아니라 **원래 신청 행**이다.
        sheetRows: items.map((i: any) => i.row),
        rowAmounts: items.map((i: any) => i.price),
        // 지원이 붙은 행만 값이 있다. 승인 때 I열에 `교육비 지원` 을 남긴다.
        rowNotes: items.map((i: any) => i.sponsorNote),
        quantity: items.length,
        free,
        listAmount,
        recipients: items.map((i: any) => ({
          name: i.name,
          phone: i.phone,
          email: i.email,
          programTitle: i.title,
          trainingType: i.participationType.includes("실시간") ? "live" : "recorded",
          // 발송 결과를 적을 행. 이게 빠지면 문자·메일은 나가는데 발송 기록 열만 통째로 빈다.
          sheetRow: i.row,
        })),
        payer,
        status: "pending",
      });

      console.log(`↻ 결제 이어하기 주문 생성: ${orderId} / ${items.length}건 / ${amount}원 / 행 ${items.map((i: any) => i.row).join(",")}`);

      res.status(201).json({
        orderId,
        amount,
        free,
        listAmount,
        quantity: items.length,
        orderName,
        clientKey: getClientKey(),
        customerName: payer.name,
        customerEmail: payer.email || "",
        customerMobilePhone: String(payer.phone || "").replace(/[^0-9]/g, ""),
        skipped: alreadyPaid,
      });
    } catch (error) {
      console.error("결제 이어하기 준비 실패:", error);
      res.status(500).json({ message: "결제 준비에 실패했습니다. 다시 시도해 주세요." });
    }
  });

  // 주문서 수정 - 참여 방식(실시간 <-> 녹화본) 변경. 링크가 담은 행만 바꿀 수 있다.
  app.patch("/api/payments/resume/:token", applicationSubmitRateLimit, async (req, res) => {
    try {
      const payload = verifyResumeToken(String(req.params.token || ""));
      if (!payload) return res.status(404).json({ message: "만료되었거나 올바르지 않은 링크입니다." });

      const row = Number(req.body?.row);
      const participationType = String(req.body?.participationType || "").trim();

      if (!payload.rows.includes(row)) {
        return res.status(403).json({ message: "변경할 수 없는 항목입니다." });
      }
      if (participationType !== "실시간 참여" && participationType !== "녹화본 시청(VOD)") {
        return res.status(400).json({ message: "참여 방식이 올바르지 않습니다." });
      }

      // 이미 결제됐거나 취소된 행은 못 바꾼다.
      const rowMap = await googleSheetsService.getApplicationRowsByNumbers([row]);
      const target = rowMap.get(row);
      if (!target || !googleSheetsService.isRowPayable(target)) {
        return res.status(409).json({ message: "이미 결제되었거나 취소된 신청입니다." });
      }

      await googleSheetsService.updateParticipationType(row, participationType);
      res.json({ ok: true, row, participationType });
    } catch (error) {
      console.error("참여 방식 변경 실패:", error);
      res.status(500).json({ message: "변경에 실패했습니다. 다시 시도해 주세요." });
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

      // ⛔ 0원 주문은 여기로 올 수 없다. 토스가 승인해 줄 수 없는 금액이라
      //    paymentKey 가 존재할 수 없고, 온다면 위조다.
      if (order.free || order.amount === 0) {
        console.error("❌ 0원 주문이 유료 승인으로 들어왔습니다:", orderId);
        return res.status(400).json({ message: "결제 정보가 올바르지 않습니다." });
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
      await markOrderRowsPaid(order, {
        paymentKey: String(paymentKey),
        method: result.method,
        approvedAt: result.approvedAt,
      });

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

  /**
   * 지원 대상 0원 확정.
   *
   * 토스는 0원을 승인하지 못한다(카드 최소 결제 금액 100원). 그래서 결제창을 띄우지 않고
   * 여기서 바로 확정한다. 승인 뒤 흐름은 유료 결제와 **같은 함수**를 탄다 —
   * J열 `완료` · 주문번호 · 결제완료 문자·이메일 · 리마인드 · 취소접수가 전부 그대로 산다.
   *
   * ⛔ 금액을 클라이언트에서 받지 않는다. 주문번호만 받고, 금액이 0원인지는 서버가 판단한다.
   *    지원 여부는 /api/payments/prepare 가 시트를 읽어 이미 결정해 뒀다.
   */
  app.post("/api/payments/confirm-free", async (req, res) => {
    try {
      const orderId = String(req.body?.orderId || "").trim();
      if (!orderId) {
        return res.status(400).json({ message: "주문 정보가 올바르지 않습니다." });
      }

      const order = getOrder(orderId);
      if (!order) {
        console.error("❌ 알 수 없는 주문(0원):", orderId);
        return res.status(404).json({
          message: "주문 정보를 찾을 수 없습니다. 신청 화면에서 다시 시도해 주세요.",
        });
      }

      // ⛔ 지원 대상이 아니면 여기서 확정하지 않는다. 결제를 건너뛰는 유일한 문이다.
      if (!order.free || order.amount !== 0) {
        console.error(`❌ 0원이 아닌 주문을 무료 확정하려 했습니다: ${orderId} (${order.amount}원)`);
        return res.status(400).json({ message: "결제가 필요한 신청입니다. 결제 화면에서 진행해 주세요." });
      }

      if (order.status === "paid") {
        return res.json({
          ok: true, alreadyConfirmed: true, free: true,
          orderId: order.orderId, orderName: order.orderName, amount: 0,
        });
      }

      order.status = "paid";
      const approvedAt = new Date().toISOString();

      console.log(`🎁 지원 0원 확정: ${orderId} / ${order.orderName} / 정가 ${(order.listAmount || 0).toLocaleString()}원`);

      await markOrderRowsPaid(order, { paymentKey: "", method: FREE_METHOD, approvedAt });

      // 참여 링크 문자·이메일. 실패해도 신청은 유효하므로 응답을 막지 않는다.
      const smsResult = await sendEnrollmentSms(order);

      res.json({
        ok: true,
        free: true,
        orderId: order.orderId,
        orderName: order.orderName,
        amount: 0,
        listAmount: order.listAmount || 0,
        method: FREE_METHOD,
        approvedAt,
        sms: smsResult,
      });
    } catch (error) {
      console.error("지원 0원 확정 실패:", error);
      res.status(500).json({ message: "신청 확정 중 오류가 발생했습니다. 내셔널 오피스로 문의해 주세요." });
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

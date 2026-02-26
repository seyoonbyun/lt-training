import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertApplicationSchema, insertBulkApplicationSchema } from "../shared/schema";
import { apiRateLimit, strictApiRateLimit, applicationSubmitRateLimit } from "./middleware/rateLimiting";
import { googleSheetsService } from "./services/google-sheets";

export async function registerRoutes(app: Express): Promise<Server> {
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

      // 신청 상태 조회 (I열의 "마감" 상태)
      const applicationStatus = await googleSheetsService.fetchApplicationStatus();

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
          isAvailable: applicationStatus[program.title] !== false // 기본값은 true (신청 가능)
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

import { type TrainingProgram, type Application, type Notice, type InsertApplication } from "../shared/schema";
import { googleSheetsService } from "./services/google-sheets";
import { randomUUID } from "crypto";

export interface IStorage {
  getTrainingPrograms(): Promise<TrainingProgram[]>;
  getNotices(): Promise<Notice[]>;
  submitApplication(application: InsertApplication): Promise<Application>;
  getAllApplications(): Promise<Application[]>;
  getApplication(id: string): Promise<Application | undefined>;
  bulkSubmitApplications(applications: InsertApplication[]): Promise<Application[]>;
}

export class MemStorage implements IStorage {
  private applications: Map<string, Application>;

  constructor() {
    this.applications = new Map();
  }

  async getTrainingPrograms(): Promise<TrainingProgram[]> {
    try {
      console.log("Fetching programs from Google Sheets...");
      const sheetsData = await googleSheetsService.getTrainingPrograms();
      const paidCounts = await googleSheetsService.getPaidApplicationCounts();
      console.log("Google Sheets data received:", sheetsData.length, "programs");
      
      // Convert Google Sheets data to our TrainingProgram format
      const programs = sheetsData.map(program => ({
        id: randomUUID(),
        title: program.title,
        description: program.description,
        date: new Date(program.date),
        location: program.location,
        trainer: program.trainer,
        maxParticipants: program.maxParticipants,
        currentParticipants: paidCounts[program.title] || 0, // 결제완료된 신청자 수로 업데이트
        status: program.status,
        type: program.type,
        paymentLink: program.paymentLink || null,
        recordingLink: program.recordingLink || null,
        isOnline: program.isOnline,
        createdAt: new Date(),
        updatedAt: new Date()
      }));
      
      // If we have Google Sheets data, use it; otherwise fallback to test data with paid counts
      if (programs.length > 0) {
        return programs;
      } else {
        return this.getTestProgramsWithPaidCounts(paidCounts);
      }
    } catch (error) {
      console.error("Failed to fetch training programs:", error);
      // Return test data as fallback
      return this.getTestPrograms();
    }
  }

  private getTestProgramsWithPaidCounts(paidCounts: { [programTitle: string]: number }): TrainingProgram[] {
    const testPrograms = this.getTestPrograms();
    return testPrograms.map(program => ({
      ...program,
      currentParticipants: paidCounts[program.title] || program.currentParticipants
    }));
  }

  private getTestPrograms(): TrainingProgram[] {
    return [
      {
        id: randomUUID(),
        title: "LT Training: 리더십업데이트",
        description: "리더십 영화를 바탕으로 비즈니스 네트워크 기술과 전략을 학습합니다.",
        date: new Date("2026-02-09T14:00:00"),
        location: "온라인 교육",
        trainer: "조영민",
        maxParticipants: 30,
        currentParticipants: 15,
        status: "upcoming",
        type: "foundation",
        paymentLink: "https://bnikorestore.com/cart/9621",
        recordingLink: null,
        isOnline: true,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: randomUUID(),
        title: "LT Training: 멤버십 업종옮김",
        description: "리더십의 중요성과 이익에 초점한 교육 프로그램입니다.",
        date: new Date("2026-02-09T18:00:00"),
        location: "온라인 교육",
        trainer: "이종철",
        maxParticipants: 30,
        currentParticipants: 18,
        status: "upcoming",
        type: "mentoring",
        paymentLink: "https://bnikorestore.com/cart/9672",
        recordingLink: null,
        isOnline: true,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: randomUUID(),
        title: "LT Training: PR 코디네이터",
        description: "효과적인 커뮤니케이션 전략과 성과 시점 강좌입니다.",
        date: new Date("2026-02-09T20:00:00"),
        location: "온라인 교육",
        trainer: "유준호",
        maxParticipants: 30,
        currentParticipants: 22,
        status: "upcoming",
        type: "education",
        paymentLink: "https://bnikorestore.com/cart/9673",
        recordingLink: null,
        isOnline: true,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: randomUUID(),
        title: "LT Training: 교육 코디네이터",
        description: "BNI 네트워킹 기술 이해 및 비즈니스 가치 창출 시점을 배웁니다.",
        date: new Date("2026-02-09T18:00:00"),
        location: "온라인 교육",
        trainer: "명주단",
        maxParticipants: 30,
        currentParticipants: 16,
        status: "upcoming",
        type: "pr",
        paymentLink: "https://bnikorestore.com/cart/9675",
        recordingLink: null,
        isOnline: true,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: randomUUID(),
        title: "LT Training: 성장 코디네이터",
        description: "팀원의 핵심적 상길 진정한 신뢰 구축을 통해 비즈니스 성과 증진을 배웁니다.",
        date: new Date("2026-02-09T20:00:00"),
        location: "온라인 교육",
        trainer: "조영민",
        maxParticipants: 30,
        currentParticipants: 14,
        status: "upcoming",
        type: "st-door",
        paymentLink: "https://bnikorestore.com/cart/9674",
        recordingLink: null,
        isOnline: true,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: randomUUID(),
        title: "LT Training: ST & 도어퍼슨",
        description: "리더십을 통해 팀원의 도어퍼슨 역할 이해 및 비즈니스 기회 창출을 학습합니다.",
        date: new Date("2026-02-09T18:00:00"),
        location: "온라인 교육",
        trainer: "오혜원",
        maxParticipants: 30,
        currentParticipants: 19,
        status: "upcoming",
        type: "st-door",
        paymentLink: "https://bnikorestore.com/cart/9676",
        recordingLink: null,
        isOnline: true,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: randomUUID(),
        title: "LT Training: 멤버십 위원회",
        description: "초기 과정 관찰 통한 공정한 양감의 비즈니스 네트워크 구축 가치 극대화를 배웁니다.",
        date: new Date("2026-02-09T18:00:00"),
        location: "온라인 교육",
        trainer: "정무일",
        maxParticipants: 30,
        currentParticipants: 21,
        status: "upcoming",
        type: "membership",
        paymentLink: "https://bnikorestore.com/cart/9677",
        recordingLink: null,
        isOnline: true,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: randomUUID(),
        title: "LT Training: 이벤트 코디네이터",
        description: "프로젝트 관리 및 BNI 네트워크 회원을 통한 리더십 혁신과 성장을 배웁니다.",
        date: new Date("2026-02-09T18:00:00"),
        location: "온라인 교육",
        trainer: "김철성",
        maxParticipants: 30,
        currentParticipants: 13,
        status: "upcoming",
        type: "event",
        paymentLink: "https://bnikorestore.com/cart/9678",
        recordingLink: null,
        isOnline: true,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: randomUUID(),
        title: "LT Training: 방문호 코디네이터",
        description: "본 클래스는 멤버의 위원회와 양감의 혁신 팀원 조화 과정을 통해 새로운 비즈니스 기회를 창출하는 네트워크 구축 시점을 제공합니다.",
        date: new Date("2026-02-09T18:00:00"),
        location: "온라인 교육",
        trainer: "김지수",
        maxParticipants: 30,
        currentParticipants: 17,
        status: "upcoming",
        type: "visitor",
        paymentLink: "https://bnikorestore.com/cart/9679",
        recordingLink: null,
        isOnline: true,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ];
  }

  async getNotices(): Promise<Notice[]> {
    // For now, return test data directly
    // Google Sheets integration will be added later with API keys
    return this.getTestNotices();
  }

  private getTestNotices(): Notice[] {
    return [
      {
        id: randomUUID(),
        title: "2026년 리더십 트레이닝 일정 확정",
        content: "총 9개 세션이 2월 9일에 진행됩니다. 각 세션별 시간과 담당자를 확인하고 미리 신청해주세요.",
        priority: 1,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: randomUUID(),
        title: "BNI 코리아 스토어 결제 링크 안내",
        content: "모든 트레이닝 결제는 BNI 코리아 스토어를 통해 진행됩니다. 각 세션별 전용 결제 링크를 확인해주세요.",
        priority: 0,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: randomUUID(),
        title: "세션 운영 시간 안내",
        content: "오후 2시부터 밤 9시까지 다양한 시간대에 세션이 진행됩니다. 본인 일정에 맞는 세션을 선택하여 참여해주세요.",
        priority: 0,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ];
  }

  async submitApplication(insertApplication: InsertApplication): Promise<Application> {
    try {
      const id = randomUUID();
      const application: Application = {
        ...insertApplication,
        id,
        programId: (insertApplication as any).programId || `single-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        status: "pending",
        createdAt: new Date(),
        chapter: insertApplication.chapter || null,
        notes: insertApplication.notes || null
      };

      // Store locally
      this.applications.set(id, application);

      await googleSheetsService.addApplicationToSheet({
        programTitle: insertApplication.programTitle,
        region: insertApplication.region || "",
        chapter: application.chapter || "",
        name: application.name,
        phone: application.phone,
        email: application.email,
        participationType: application.trainingType === 'live' ? '실시간 참여' : '녹화본 시청(VOD)',
        notes: application.notes || ""
      });

      return application;
    } catch (error) {
      console.error("Failed to submit application:", error);
      throw new Error("신청 제출에 실패했습니다. 다시 시도해주세요.");
    }
  }

  async getApplication(id: string): Promise<Application | undefined> {
    return this.applications.get(id);
  }

  async bulkSubmitApplications(insertApplications: InsertApplication[]): Promise<Application[]> {
    try {
      const applications: Application[] = [];
      
      for (const insertApp of insertApplications) {
        const id = randomUUID();
        const application: Application = {
          ...insertApp,
          id,
          programId: `bulk-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          status: "pending",
          createdAt: new Date(),
          chapter: insertApp.chapter || null,
          notes: insertApp.notes || null
        };
        
        // Store locally
        this.applications.set(id, application);
        applications.push(application);
      }

      // Submit to Google Sheets in bulk (개별 신청 방식 사용)
      try {
        for (const app of insertApplications) {
          await googleSheetsService.addApplicationToSheet({
            programTitle: app.programTitle,
            region: app.region || "",
            chapter: app.chapter || "",
            name: app.name,
            phone: app.phone,
            email: app.email,
            participationType: app.participationType || (app.trainingType === "live" ? "실시간 참여" : "녹화본 시청"),
            notes: app.notes || ""
          });
        }
      } catch (googleError) {
        console.error("Failed to add bulk applications to Google Sheets:", googleError);
      }

      return applications;
    } catch (error) {
      console.error("Failed to bulk submit applications:", error);
      throw new Error("일괄 신청 제출에 실패했습니다. 다시 시도해주세요.");
    }
  }

  async getAllApplications(): Promise<Application[]> {
    return Array.from(this.applications.values()).sort(
      (a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0)
    );
  }
}

export const storage = new MemStorage();

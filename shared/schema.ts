import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const trainingPrograms = pgTable("training_programs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  description: text("description"),
  date: timestamp("date").notNull(),
  location: text("location").notNull(),
  trainer: text("trainer").notNull(),
  maxParticipants: integer("max_participants").notNull().default(30),
  currentParticipants: integer("current_participants").notNull().default(0),
  status: text("status").notNull().default("upcoming"), // upcoming, ongoing, completed
  type: text("type").notNull(), // foundation, mentoring, pr, st-door, event, membership, education, visitor
  paymentLink: text("payment_link"),
  recordingLink: text("recording_link"),
  isOnline: boolean("is_online").notNull().default(false),
  createdAt: timestamp("created_at").default(sql`now()`),
  updatedAt: timestamp("updated_at").default(sql`now()`)
});

export const applications = pgTable("applications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  programId: varchar("program_id").notNull().references(() => trainingPrograms.id),
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull(),
  chapter: text("chapter"),
  region: text("region"),
  participationType: text("participation_type"),
  trainingType: text("training_type").notNull(), // live, recorded
  notes: text("notes"),
  status: text("status").notNull().default("pending"), // pending, approved, rejected
  createdAt: timestamp("created_at").default(sql`now()`)
});

export const notices = pgTable("notices", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  content: text("content").notNull(),
  priority: integer("priority").notNull().default(0), // 0: normal, 1: high
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").default(sql`now()`),
  updatedAt: timestamp("updated_at").default(sql`now()`)
});

export const insertTrainingProgramSchema = createInsertSchema(trainingPrograms).omit({
  id: true,
  createdAt: true,
  updatedAt: true
});

export const insertApplicationSchema = createInsertSchema(applications).omit({
  id: true,
  createdAt: true,
  status: true,
  programId: true  // programId를 완전히 제거하여 자동 생성되도록 함
}).extend({
  programTitle: z.string().min(1, "프로그램 제목이 필요합니다"),
  name: z.string().min(1, "멤버명을 입력해주세요"),
  phone: z.string().min(1, "연락처를 입력해주세요"),
  email: z.string().email("올바른 이메일 주소를 입력해주세요"),
  trainingType: z.enum(["live", "recorded"], {
    required_error: "참여 방식을 선택해주세요"
  }),
  region: z.string().min(1, "지역을 입력해주세요"),
  participationType: z.string().min(1, "참여 방식을 선택해주세요"),
  // notes 필드를 명시적으로 처리 - 숫자나 다른 타입을 문자열로 변환
  notes: z.any().transform((val) => {
    if (val === null || val === undefined || val === "") {
      return "";
    }
    return String(val);
  }).pipe(z.string())
});

// 일괄 업로드 전용 스키마 - 이메일을 선택사항으로 처리
export const insertBulkApplicationSchema = insertApplicationSchema.extend({
  email: z.string().optional().transform((val) => {
    // undefined, null, 빈 문자열 모두 빈 문자열로 처리
    if (!val || val.trim() === "") {
      return "";
    }
    return val.trim();
  }).pipe(z.string().refine((val) => {
    // 빈 문자열이면 통과, 아니면 이메일 형식 검증
    if (val === "") return true;
    try {
      z.string().email().parse(val);
      return true;
    } catch {
      return false;
    }
  }, {
    message: "올바른 이메일 주소를 입력해주세요"
  }))
});

export const insertNoticeSchema = createInsertSchema(notices).omit({
  id: true,
  createdAt: true,
  updatedAt: true
});

export type TrainingProgram = typeof trainingPrograms.$inferSelect;
export type InsertTrainingProgram = z.infer<typeof insertTrainingProgramSchema>;
export type Application = typeof applications.$inferSelect;
export type InsertApplication = z.infer<typeof insertApplicationSchema>;
export type Notice = typeof notices.$inferSelect;
export type InsertNotice = z.infer<typeof insertNoticeSchema>;

// Google Sheets data structure
export const googleSheetsDataSchema = z.object({
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

export type GoogleSheetsData = z.infer<typeof googleSheetsDataSchema>;

// Secondary Google Sheets program interface
export interface SecondaryProgram {
  id: string;
  title: string;
  date: string;
  time: string;
  location: string;
  description: string;
  currentParticipants: number;
  maxParticipants: number;
  isAvailable: boolean;
  trainer: string;
  trainingType: string;
  storeUrl?: string;
  isActive: boolean;
  sessionNumber?: number;
  instructor?: string;
  completedCount?: number; // 결제완료된 신청자 수
  notionUrl?: string; // Notion 링크
  classroomUrl?: string; // 온라인 강의실 URL (I열)
  venueUrl?: string; // 오프라인 강의실 URL (H열)
}

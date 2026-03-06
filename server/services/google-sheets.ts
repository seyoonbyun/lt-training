import { GoogleSheetsData, googleSheetsDataSchema } from "../../shared/schema";
import { createSign } from "crypto";

// 보안: 환경변수에서 API 키 로드 (배포 전 필수)
const GOOGLE_SHEETS_API_KEY = process.env.GOOGLE_SHEETS_API_KEY || "";
const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID || "";

// 모듈 레벨 액세스 토큰 캐시 (스코프별로 구분)
const _cachedTokens: Map<string, { token: string; expiresAt: number }> = new Map();

async function getServiceAccountAccessToken(scope: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const cached = _cachedTokens.get(scope);
  if (cached && cached.expiresAt > now + 60) {
    return cached.token;
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
    exp: now + 3600,
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
      assertion: jwt,
    }),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    throw new Error(`Token fetch failed: ${err}`);
  }

  const tokenData = await tokenRes.json() as { access_token: string; expires_in: number };
  _cachedTokens.set(scope, { token: tokenData.access_token, expiresAt: now + tokenData.expires_in });
  return tokenData.access_token;
}

function formatPhoneNumber(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 11) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return phone;
}

export class GoogleSheetsService {
  private baseUrl = "https://sheets.googleapis.com/v4/spreadsheets";
  private apiKey: string | undefined;
  private spreadsheetId: string | undefined;
  private secondarySpreadsheetId: string | undefined;
  private cache = new Map<string, { data: any; timestamp: number }>();
  private cacheTimeout = 150000; // 2.5분 캐시 (안전한 성능 최적화)

  constructor() {
    // 보안: 환경변수에서 설정 로드
    this.apiKey = GOOGLE_SHEETS_API_KEY;
    this.spreadsheetId = SPREADSHEET_ID;
    this.secondarySpreadsheetId = process.env.GOOGLE_SECONDARY_SPREADSHEET_ID || "";
    
    // 필수 설정 검증
    if (!this.apiKey) {
      console.error("❌ GOOGLE_SHEETS_API_KEY 환경변수가 설정되지 않았습니다.");
    }
    if (!this.spreadsheetId) {
      console.error("❌ GOOGLE_SPREADSHEET_ID 환경변수가 설정되지 않았습니다.");
    }
  }

  private getCachedData<T>(key: string): T | null {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }
    return null;
  }

  private setCachedData<T>(key: string, data: T): void {
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  isConfigured(): boolean {
    return !!(this.apiKey && this.spreadsheetId);
  }

  isSecondarySheetConfigured(): boolean {
    return !!(this.secondarySpreadsheetId);
  }

  async fetchProgramDescriptions(): Promise<{ [title: string]: string }> {
    const cacheKey = 'program-descriptions';
    const cached = this.getCachedData<{ [title: string]: string }>(cacheKey);
    if (cached) return cached;

    const descriptionSpreadsheetId = process.env.GOOGLE_DESCRIPTION_SPREADSHEET_ID || '';
    
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
        const ti = row.findIndex((h: string) => h?.includes('제목') || h?.includes('과목') || h?.includes('프로그램') || h?.includes('과정') || h?.includes('세션') || h?.includes('LTT'));
        const di = row.findIndex((h: string) => h?.includes('설명') || h?.includes('내용') || h?.includes('description') || h?.includes('안내'));
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
      
      const descriptions: { [title: string]: string } = {};
      
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

  async fetchApplicationStatus(): Promise<{ [title: string]: boolean }> {
    const cacheKey = 'applicationStatus';
    // 마감 상태는 15초 캐시 (어드민 변경 빠르게 반영)
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < 15000) {
      return cached.data;
    }

    if (!this.secondarySpreadsheetId) {
      console.error('❌ fetchApplicationStatus: secondarySpreadsheetId가 비어있습니다');
      return {};
    }
    
    try {
      // getSecondarySheetPrograms()와 동일한 URL 패턴 사용 (인코딩 없이)
      const url = `${this.baseUrl}/${this.secondarySpreadsheetId}/values/'LTT 세션등록'!D:K?key=${this.apiKey}`;
      console.log('📋 fetchApplicationStatus 호출:', url.replace(this.apiKey || '', '***'));
      const response = await fetch(url);
      
      if (!response.ok) {
        const errText = await response.text();
        console.error('❌ fetchApplicationStatus API 오류:', response.status, errText);
        return {};
      }
      
      const data = await response.json();
      const rows = data.values || [];
      console.log(`📋 fetchApplicationStatus: ${rows.length}행 조회됨`);
      
      if (rows.length < 3) {
        console.warn('⚠ fetchApplicationStatus: 데이터 행이 부족합니다 (rows:', rows.length, ')');
        return {};
      }
      
      const applicationStatus: { [title: string]: boolean } = {};
      
      // 데이터 행은 index 2부터 시작 (헤더 2행)
      // D:K 범위이므로 D=index 0, K=index 7
      for (let i = 2; i < rows.length; i++) {
        const row = rows[i];
        if (!row || !row[0]) continue;
        
        const title = String(row[0]).trim(); // D열 (범위 시작이 D이므로 index 0)
        const deadlineStatus = row[7] ? String(row[7]).trim() : ''; // K열 (D부터 7번째 = index 7)
        
        if (title) {
          const isOpen = deadlineStatus !== '마감';
          applicationStatus[title] = isOpen;
          if (!isOpen) {
            console.log(`🔒 마감 처리됨: "${title}" (K열값: "${deadlineStatus}")`);
          }
        }
      }
      
      console.log('📋 fetchApplicationStatus 결과:', JSON.stringify(applicationStatus));
      this.setCachedData(cacheKey, applicationStatus);
      return applicationStatus;
      
    } catch (error) {
      console.error('❌ fetchApplicationStatus 에러:', error);
      return {};
    }
  }

  getSheetInfo(): { primary: string; secondary?: string } {
    return {
      primary: this.spreadsheetId || '',
      secondary: this.secondarySpreadsheetId || undefined
    };
  }

  // Google Sheets에서 프로그램 데이터를 읽어올 때 사용할 범위 설정
  private getSheetRange(): string {
    return "A1:Z1000"; // 충분한 범위로 설정, 시트명 없이
  }

  private parseKoreanDate(dateStr: string, timeStr: string): string {
    if (!dateStr) return new Date().toISOString();
    
    // Parse date format like "9/2 (화)" to September 2, 2026
    const dateMatch = dateStr.match(/(\d+)\/(\d+)/);
    if (dateMatch) {
      const month = parseInt(dateMatch[1]);
      const day = parseInt(dateMatch[2]);
      const year = 2026;
      
      // Parse time like "14:00-17:00" or "18:00 - 21:00"
      const timeMatch = timeStr?.match(/(\d+):(\d+)/);
      const hours = timeMatch ? parseInt(timeMatch[1]) : 14;
      const minutes = timeMatch ? parseInt(timeMatch[2]) : 0;
      
      const date = new Date(year, month - 1, day, hours, minutes);
      return date.toISOString();
    }
    
    return new Date().toISOString();
  }

  private parseLocation(notes: string, title?: string): string {
    // 파운데이션 T.는 오프라인 강의로 고정
    if (title && title.includes("파운데이션")) {
      return "오프라인 : 스페이스 쉐어 삼성점";
    }
    
    if (!notes) return "온라인 : 강의실 입장 (1차, 2차 링크 동일)";
    
    if (notes.includes("오프라인")) {
      if (notes.includes("스페이스 쉐어 삼성점")) {
        return "오프라인 : 스페이스 쉐어 삼성점";
      }
      return "오프라인 교육";
    }
    
    return "온라인 : 강의실 입장 (1차, 2차 링크 동일)";
  }

  private parseLocationFromData(locationData: string, title?: string): string {
    if (!locationData) {
      return "온라인 : 강의실 입장 (1차, 2차 링크 동일)";
    }
    
    // 파운데이션 T.는 오프라인 세션 - 섬유센터 컨퍼런스홀
    if (title && title.includes("파운데이션")) {
      return "오프라인 : 섬유센터 컨퍼런스홀";
    }
    
    // Notion 링크가 있는 경우 온라인 강의실로 표시
    if (locationData.includes("notion.so")) {
      return "온라인 : 강의실 입장 (1차, 2차 링크 동일)";
    }
    
    // URL을 제거하고 텍스트만 추출
    const cleanLocation = locationData.replace(/(https?:\/\/[^\s]+)/gi, '').trim();
    
    if (cleanLocation.includes("오프라인") || cleanLocation.includes("스페이스 쉐어")) {
      if (cleanLocation.includes("스페이스 쉐어 삼성점") || cleanLocation.includes("삼성점")) {
        return "오프라인 : 스페이스 쉐어 삼성점";
      }
      return cleanLocation || "오프라인 교육";
    }
    
    // 온라인인 경우
    if (cleanLocation.includes("온라인") || cleanLocation.includes("강의실")) {
      return cleanLocation || "온라인 : 강의실 입장 (1차, 2차 링크 동일)";
    }
    
    return cleanLocation || "온라인 : 강의실 입장 (1차, 2차 링크 동일)";
  }

  private extractClassroomUrl(format: string): string {
    if (!format) return '';
    
    // URL 패턴 매칭 (http:// 또는 https://로 시작하는 URL)
    const urlMatch = format.match(/(https?:\/\/[^\s]+)/i);
    if (urlMatch) {
      let url = urlMatch[1];
      // URL 끝에 있는 구두점이나 기타 문자 제거
      url = url.replace(/[,\s\)]+$/, '');
      return url;
    }
    
    // 온라인이지만 URL이 없는 경우 기본 강의실 URL 반환
    if (format.includes('온라인')) {
      return 'https://bni-korea.zoom.us/classroom'; // 실제 강의실 URL로 교체 필요
    }
    
    return '';
  }

  private getTrainingType(subject: string): "foundation" | "mentoring" | "pr" | "st-door" | "event" | "membership" | "education" | "visitor" {
    if (!subject) return "foundation";
    
    const subjectLower = subject.toLowerCase();
    if (subjectLower.includes("멘토링") || subjectLower.includes("mentor")) return "mentoring";
    if (subjectLower.includes("pr") || subjectLower.includes("홍보")) return "pr";
    if (subjectLower.includes("st") || subjectLower.includes("door") || subjectLower.includes("도어")) return "st-door";
    if (subjectLower.includes("이벤트") || subjectLower.includes("event")) return "event";
    if (subjectLower.includes("멤버십") || subjectLower.includes("member")) return "membership";
    if (subjectLower.includes("교육") || subjectLower.includes("education")) return "education";
    if (subjectLower.includes("방문") || subjectLower.includes("visitor")) return "visitor";
    
    return "foundation";
  }

  async fetchSheetData(range: string): Promise<any[][]> {
    if (!this.isConfigured()) {
      return [];
    }

    try {
      // URL 인코딩을 적용하여 시트 이름을 안전하게 처리
      const encodedRange = encodeURIComponent(range);
      const url = `${this.baseUrl}/${this.spreadsheetId}/values/${encodedRange}?key=${this.apiKey}`;
      const response = await fetch(url);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('Google Sheets API error:', response.status, errorText);
        throw new Error(`Google Sheets API error: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      return data.values || [];
    } catch (error) {
      console.error("Failed to fetch Google Sheets data:", error);
      throw new Error("Google Sheets API connection failed. Please check your API key and spreadsheet ID.");
    }
  }

  async getTrainingPrograms(): Promise<GoogleSheetsData["programs"]> {
    try {
      // 첫 번째 시트를 범위로 지정 (시트명 없이)
      const rows = await this.fetchSheetData("A1:Z1000");
      
      // 헤더 행을 건너뛰고 데이터 처리
      const dataRows = rows.slice(1);
      
      // 실제 결제 완료된 신청자 수 계산 (J열에서 "완료" 개수)
      const paidApplications = dataRows.filter(row => row[9] === "완료").length;
      
      // 프로그램별로 그룹화하고 카운트
      const programCounts: { [key: string]: number } = {};
      dataRows.forEach(row => {
        const programName = row[1]; // B열: 과목명
        if (programName && row[9] === "완료") {
          programCounts[programName] = (programCounts[programName] || 0) + 1;
        }
      });

      // 기본 프로그램 목록 반환 (실제 Google Sheets에서 프로그램 정보를 가져올 수 있도록 수정 필요)
      const defaultPrograms = [
        {
          title: "LT Training: 파운데이션",
          description: "BNI 네트워킹의 기초를 배우는 파운데이션 트레이닝",
          date: "2026-09-02T14:00:00.000Z",
          location: "온라인 교육",
          trainer: "BNI Korea",
          maxParticipants: 30,
          currentParticipants: programCounts["LT Training: 파운데이션"] || 0,
          status: "upcoming" as const,
          type: "foundation" as const,
          paymentLink: "https://store.bnikorea.com/product/foundation-training",
          recordingLink: "",
          isOnline: true
        },
        {
          title: "LT Training: 멘토링 코디네이터",
          description: "효과적인 멘토링 기술을 배우는 전문 트레이닝",
          date: "2026-09-05T14:00:00.000Z",
          location: "온라인 교육",
          trainer: "BNI Korea",
          maxParticipants: 30,
          currentParticipants: programCounts["LT Training: 멘토링 코디네이터"] || 0,
          status: "upcoming" as const,
          type: "mentoring" as const,
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

  async getNotices(): Promise<GoogleSheetsData["notices"]> {
    try {
      // For now, return static notices since we don't have a Notices sheet
      // In production, you would create a separate "Notices" sheet
      return [
        {
          title: "🎯 2026 LTT 프로그램 오픈",
          content: "BNI Korea Leadership Training 2026이 시작됩니다. 순차적으로 진행되는 세션에 참여하세요!",
          priority: 1,
          isActive: true
        },
        {
          title: "📅 세션별 일정 확인",
          content: "각 세션은 9월 2일부터 9월 19일까지 진행되며, 온라인과 오프라인 세션이 혼합되어 있습니다.",
          priority: 2,
          isActive: true
        },
        {
          title: "💳 결제 안내",
          content: "각 세션별 개별 결제 또는 전체 세션 일괄 결제가 가능합니다. BNI Korea Store에서 결제해주세요.",
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
  async addApplicationToSheet(applicationData: {
    programTitle: string;
    region: string;
    chapter: string;
    name: string;
    phone: string;
    email: string;
    participationType: string;
    notes: string;
  }): Promise<void> {
    // 현재 시간 (한국 시간)
    const now = new Date();
    const koreaTime = new Intl.DateTimeFormat('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZone: 'Asia/Seoul'
    }).format(now);


    const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    
    if (!serviceAccountJson) {
      console.error('❌ GOOGLE_SERVICE_ACCOUNT_JSON 환경변수가 설정되지 않아 Google Sheets 저장을 건너뜁니다.');
      throw new Error('Google Sheets Service Account가 설정되지 않았습니다.');
    }

    try {
      const token = await getServiceAccountAccessToken('https://www.googleapis.com/auth/spreadsheets');
      
      const now = new Date();
      const submittedAt = new Intl.DateTimeFormat('ko-KR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZone: 'Asia/Seoul'
      }).format(now);

      const values = [[
        submittedAt,
        applicationData.programTitle,
        applicationData.region,
        applicationData.chapter,
        applicationData.name,
        formatPhoneNumber(applicationData.phone),
        applicationData.email,
        applicationData.participationType,
        applicationData.notes || ''
      ]];

      const range = encodeURIComponent("'2026 LTT 신청명단'!A:I");
      const url = `${this.baseUrl}/${this.spreadsheetId}/values/${range}:append?valueInputOption=RAW`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ Google Sheets API 응답 오류 (${response.status}):`, errorText);
        throw new Error(`Google Sheets 저장 실패: ${response.status} - ${errorText}`);
      }

      const result = await response.json();
      console.log(`✅ Google Sheets 저장 성공: ${applicationData.name} (${applicationData.programTitle})`);
    } catch (error) {
      console.error('❌ Google Sheets 저장 실패:', error);
      throw error;
    }
  }

  async getAllData(): Promise<GoogleSheetsData> {
    try {
      const [programs, notices] = await Promise.all([
        this.getTrainingPrograms(),
        this.getNotices()
      ]);

      return { programs, notices };
    } catch (error) {
      console.error("Failed to fetch all Google Sheets data:", error);
      return { programs: [], notices: [] };
    }
  }

  private getNotionLink(title: string): string {
    const notionLinks: { [key: string]: string } = {
      'LT Training: 파운데이션 T.': 'https://www.notion.so/bnikorea-joy/LT-T_-e464035f91024e29b5fceb805b92ce2a?source=copy_link',
      'LT Training: 멤버십 위원회 T.': 'https://www.notion.so/bnikorea-joy/LT-T_-a8f5e312d6de4593aa79fcb2d260ebe6?source=copy_link',
      'LT Training: PR 코디네이터T.': 'https://www.notion.so/bnikorea-joy/LT-PR-T_-cba1fddc755d46c8a16631fde26bbb2f?source=copy_link',
      'LT Training: 교육 코디네이터 T.': 'https://www.notion.so/bnikorea-joy/LT-T_-e1a5b3d5b6b648a789aad93f0105cfc0?source=copy_link',
      'LT Training: 성장 코디네이터 T.': 'https://www.notion.so/bnikorea-joy/LT-T_-7f274bdd80474ddea3548d70a87ed56f?source=copy_link',
      'LT Training: ST T.': 'https://www.notion.so/bnikorea-joy/LT-ST-T_-7137c4231d6d497ba2c28f1ba0af282b?source=copy_link',
      'LT Training: 비지터 호스트 T.': 'https://www.notion.so/bnikorea-joy/LT-T_-2b4192ea14d941489753208b4e02d0f8?source=copy_link',
      'LT Training: 이벤트 코디네이터 T.': 'https://www.notion.so/bnikorea-joy/LT-T_-fc56de81e616415b8efcd299b66ebdae?source=copy_link',
      'LT Training: 멘토링 코디네이터 T.': 'https://www.notion.so/bnikorea-joy/LT-T_-d8bea5f2f98140eeaa2cc6dc6c83ecfe?source=copy_link'
    };
    
    return notionLinks[title] || '';
  }



  async checkDuplicateApplication(programTitle: string, phone: string, name: string): Promise<boolean> {
    if (!this.spreadsheetId) return false;

    try {
      const token = await getServiceAccountAccessToken('https://www.googleapis.com/auth/spreadsheets.readonly');
      const range = encodeURIComponent("'2026 LTT 신청명단'!A:J");
      const url = `${this.baseUrl}/${this.spreadsheetId}/values/${range}`;
      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!response.ok) {
        console.error('중복 확인 API 오류:', response.status);
        return false;
      }
      const data = await response.json() as { values?: string[][] };
      const rows = data.values || [];
      const normalizedPhone = phone.replace(/\D/g, '');

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const rowProgram = row[1] || '';
        const rowPhone = (row[5] || '').replace(/\D/g, '');
        if (rowProgram === programTitle && normalizedPhone && rowPhone === normalizedPhone) {
          return true;
        }
      }
      return false;
    } catch (error) {
      console.error('중복 확인 실패 (신청 계속 진행):', error);
      return false;
    }
  }

  async checkBulkDuplicates(applications: { programTitle: string; phone: string; name: string }[]): Promise<{ name: string; programTitle: string; phone: string }[]> {
    if (!this.spreadsheetId) return [];

    try {
      const token = await getServiceAccountAccessToken('https://www.googleapis.com/auth/spreadsheets.readonly');
      const range = encodeURIComponent("'2026 LTT 신청명단'!A:J");
      const url = `${this.baseUrl}/${this.spreadsheetId}/values/${range}`;
      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!response.ok) {
        console.error('일괄 중복 확인 API 오류:', response.status);
        return [];
      }
      const data = await response.json() as { values?: string[][] };
      const rows = data.values || [];
      const existingEntries = new Set<string>();

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const rowProgram = row[1] || '';
        const rowPhone = (row[5] || '').replace(/\D/g, '');
        if (rowProgram && rowPhone) {
          existingEntries.add(`${rowProgram}|${rowPhone}`);
        }
      }

      const duplicates: { name: string; programTitle: string; phone: string }[] = [];
      for (const app of applications) {
        const normalizedPhone = app.phone.replace(/\D/g, '');
        const key = `${app.programTitle}|${normalizedPhone}`;
        if (existingEntries.has(key)) {
          duplicates.push({ name: app.name, programTitle: app.programTitle, phone: app.phone });
        }
      }
      return duplicates;
    } catch (error) {
      console.error('일괄 중복 확인 실패 (신청 계속 진행):', error);
      return [];
    }
  }

  // 실제 신청 데이터를 Google Sheets에서 가져오는 메서드
  async getApplicationsFromSheet(): Promise<any[]> {
    if (!this.spreadsheetId) {
      return [];
    }

    try {
      // A-J 열에서 신청 데이터 가져오기 (A:신청일시, B:과목명, C:지역, D:챕터, E:멤버명, F:연락처, G:이메일, H:참여방식, I:특이사항, J:결제완료)
      const rows = await this.fetchSheetData("A2:J1000"); // 시트명 없이 기본 시트에서 가져오기
      
      if (!rows || rows.length === 0) {
        return [];
      }

      const applications = rows
        .filter(row => row && row.length > 1 && row[1]) // 빈 행 제외, B열(과목명)이 있는 행만
        .map((row, index) => {
          const [submittedAt, programTitle, region, chapter, name, phone, email, participationType, notes, paymentStatus] = row;
          
          return {
            id: `app-${index + 1}`,
            programTitle: programTitle || '',
            region: region || '',
            chapter: chapter || '',
            name: name || '',
            phone: phone || '',
            email: email || '',
            participationType: participationType || '',
            notes: notes || '',
            paymentStatus: paymentStatus || '',
            isPaid: paymentStatus === '완료',
            createdAt: submittedAt || new Date().toISOString()
          };
        });


      return applications;
      
    } catch (error) {
      console.error("신청 데이터 가져오기 실패:", error);
      return [];
    }
  }

  async getLocationData(): Promise<{ [title: string]: string }> {
    const cacheKey = 'location-data';
    const cached = this.getCachedData<{ [title: string]: string }>(cacheKey);
    if (cached) return cached;

    const locationSheetId = this.secondarySpreadsheetId || '1ksNpdM_3AZLyMvmSXG8GLf_dZMxcxXvx5PHNOrKujH8';
    
    try {
      // I열 위치 정보를 가져오기
      const response = await fetch(`${this.baseUrl}/${locationSheetId}/values/'LTT 세션등록'!A1:I100?key=${this.apiKey}`);
      
      if (!response.ok) {
        console.error(`위치 데이터 시트 접근 실패: ${response.status}`);
        return {};
      }
      
      const data = await response.json();
      const rows = data.values;
      
      if (!rows || rows.length < 2) {
        return {};
      }

      const locationData: { [title: string]: string } = {};
      
      // 헤더 행(인덱스 1)을 건너뛰고 데이터 행들을 처리
      for (let i = 2; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length < 4) continue;
        
        const title = row[3] || ''; // D열: 과목명
        const location = row[8] || ''; // I열: 위치 정보
        
        if (title && location) {
          locationData[title] = location;
        }
      }
      
      this.setCachedData(cacheKey, locationData);
      return locationData;
      
    } catch (error) {
      console.error('위치 데이터 가져오기 실패:', error);
      return {};
    }
  }

  async getSecondarySheetPrograms(): Promise<any[]> {
    const cacheKey = 'secondary-sheet-programs';
    const cached = this.getCachedData<any[]>(cacheKey);
    if (cached) return cached;

    if (!this.secondarySpreadsheetId) {
      throw new Error("Secondary spreadsheet not configured");
    }

    try {
      // 병렬로 프로그램 데이터, 상세 설명, 위치 데이터 가져오기
      const [programResponse, descriptions, locationData] = await Promise.all([
        fetch(`${this.baseUrl}/${this.secondarySpreadsheetId}/values/'LTT 세션등록'!A1:Z100?key=${this.apiKey}`),
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

      const headerI1Value = rows[0] && rows[0][8] ? rows[0][8] : '';

      const programs = [];
      for (let i = 2; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length < 4 || !row[0] || !row[3]) continue;

        const title = row[3] || '';
        
        const venueLink = row[7] || '';
        const onlineLink = row[8] || '';
        
        // K열(index 10): 어드민이 '마감' 입력 시 신청 불가
        const deadlineStatus = row[10] ? String(row[10]).trim() : '';
        const isClosed = deadlineStatus === '마감';

        const program = {
          id: `secondary-${i}`,
          sessionNumber: row[0] || '',
          date: row[1] || '',
          time: row[2] || '',
          title: title,
          instructor: row[4] || '',
          description: descriptions[title] || row[5] || '',
          storeUrl: row[6] || '',
          format: venueLink ? '오프라인' : '온라인',
          isAvailable: !isClosed,
          maxParticipants: 50,
          currentParticipants: 0,
          formattedDate: this.parseKoreanDate(row[1], row[2]),
          location: this.parseLocationFromData(venueLink || onlineLink, title),
          venueUrl: venueLink || '',
          classroomUrl: onlineLink || '',
          notionUrl: this.getNotionLink(title)
        };

        programs.push(program);
      }

      this.setCachedData(cacheKey, programs);
      return programs;
      
    } catch (error) {
      console.error("두 번째 시트 데이터 가져오기 실패:", error);
      return [];
    }
  }

  async submitApplication(applicationData: {
    programTitle: string;
    name: string;
    email: string;
    phone: string;
    chapter?: string;
    trainingType: string;
    notes?: string;
  }): Promise<boolean> {

    // 실제 Google Sheets 연동은 향후 Service Account 인증 설정 후 활성화
    return true;
  }

  async bulkSubmitApplications(applications: ApplicationSubmission[]): Promise<void> {
    if (!this.isConfigured()) {
      return;
    }

    try {
      const now = new Date();
      const koreaTime = new Intl.DateTimeFormat('ko-KR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZone: 'Asia/Seoul'
      }).format(now);

      const values = applications.map(app => [
        koreaTime, // A열: 신청일시
        app.programTitle, // B열: 프로그램명
        app.name, // C열: 이름
        formatPhoneNumber(app.phone), // D열: 연락처
        app.email, // E열: 이메일
        app.chapter || '', // F열: 소속 챕터
        app.trainingType === 'live' ? '실시간 강의 참여' : '녹화본 시청', // G열: 참여 방식
        app.notes || '', // H열: 특이사항
        '미납', // I열: 결제상태 (기본값: 미납)
      ]);

      const url = `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/2026 LTT 신청명단:append?valueInputOption=RAW&key=${this.apiKey}`;
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          values: values,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Google Sheets API error:', errorText);
        throw new Error(`Google Sheets 일괄 업로드 실패: ${response.status}`);
      }

      const result = await response.json();
    } catch (error) {
      console.error("Failed to bulk submit applications:", error);
      throw new Error("Google Sheets 일괄 연동 실패");
    }
  }

  // 결제완료된 신청자 수를 프로그램별로 카운트
  async getPaidApplicationCounts(): Promise<{ [programTitle: string]: number }> {
    if (!this.isConfigured()) {
      return {};
    }

    try {
      const url = `${this.baseUrl}/${this.spreadsheetId}/values/2026 LTT 신청명단?key=${this.apiKey}`;
      const response = await fetch(url);

      if (!response.ok) {
        console.error("Failed to fetch application data for counting");
        return {};
      }

      const data = await response.json();
      const rows = data.values || [];
      
      // 헤더 행 제외하고 데이터 행만 처리
      const dataRows = rows.slice(1);
      const counts: { [programTitle: string]: number } = {};

      dataRows.forEach((row: string[]) => {
        if (row.length >= 10) {
          const programTitle = row[1]; // B열: 과목명
          const paymentStatus = row[9]; // J열: 결제완료상태
          
          // 결제완료인 경우만 카운트
          if (paymentStatus === '완료') {
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
  async getDashboardData(): Promise<{
    totalApplications: number;
    paidApplications: number;
    pendingApplications: number;
    programStats: { [program: string]: { total: number; paid: number; pending: number } };
    regionStats: { [region: string]: { total: number; paid: number; pending: number } };
    chapterStats: { [chapter: string]: { total: number; paid: number; pending: number } };
    recentApplications: any[];
  }> {
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
      const url = `${this.baseUrl}/${this.spreadsheetId}/values/'2026 LTT 신청명단'!A:J?key=${this.apiKey}`;
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

      // 헤더 행 제외하고 데이터 행만 처리
      const dataRows = rows.slice(1);
      
      let totalApplications = 0;
      let paidApplications = 0;
      let pendingApplications = 0;
      
      const programStats: { [program: string]: { total: number; paid: number; pending: number } } = {};
      const regionStats: { [region: string]: { total: number; paid: number; pending: number } } = {};
      const chapterStats: { [chapter: string]: { total: number; paid: number; pending: number } } = {};
      const recentApplications: any[] = [];

      // 과목명 별칭을 정식 과목명으로 매핑하는 함수
      const normalizeCourseName = (courseName: string): string => {
        if (!courseName) return courseName;
        
        // 이미 정식 과목명이면 그대로 반환
        const formalNames = [
          'LTT : 파운데이션 T.',
          'LTT : 멤버십 위원회 T.',
          'LTT : PR 코디네이터T.',
          'LTT : 교육 코디네이터 T.',
          'LTT : 성장 코디네이터 T.',
          'LTT : ST T.',
          'LTT : 비지터 호스트 T.',
          'LTT : 이벤트 코디네이터 T.',
          'LTT : 멘토링 코디네이터 T.'
        ];
        
        if (formalNames.includes(courseName)) {
          return courseName;
        }

        if (courseName === 'LTT : ST & 도어퍼슨 T.') {
          return 'LTT : ST T.';
        }
        
        // 패턴 기반 매핑 - 키워드로 식별
        const lowerCourseName = courseName.toLowerCase();
        
        // 파운데이션 매핑
        if (lowerCourseName.includes('파운데이션') || 
            lowerCourseName.includes('foundation')) {
          return 'LTT : 파운데이션 T.';
        }
        
        // 멤버십 위원회 매핑
        if (lowerCourseName.includes('멤버십') && lowerCourseName.includes('위원회')) {
          return 'LTT : 멤버십 위원회 T.';
        }
        
        // PR 코디네이터 매핑
        if ((lowerCourseName.includes('pr') || lowerCourseName.includes('피알')) &&
            lowerCourseName.includes('코디')) {
          return 'LTT : PR 코디네이터T.';
        }
        
        // 교육 코디네이터 매핑
        if (lowerCourseName.includes('교육') && lowerCourseName.includes('코디')) {
          return 'LTT : 교육 코디네이터 T.';
        }
        
        // 성장 코디네이터 매핑
        if (lowerCourseName.includes('성장') && lowerCourseName.includes('코디')) {
          return 'LTT : 성장 코디네이터 T.';
        }
        
        // ST 매핑 (ST T. 및 이전 ST & 도어퍼슨 포함)
        if (lowerCourseName.includes('도어퍼슨') ||
            (lowerCourseName.includes('st') && !lowerCourseName.includes('호스트'))) {
          return 'LTT : ST T.';
        }
        
        // 비지터 호스트 매핑
        if (lowerCourseName.includes('비지터')) {
          return 'LTT : 비지터 호스트 T.';
        }
        
        // 이벤트 코디네이터 매핑
        if (lowerCourseName.includes('이벤트') && lowerCourseName.includes('코디')) {
          return 'LTT : 이벤트 코디네이터 T.';
        }
        
        // 멘토링 코디네이터 매핑 (정확한 매칭만, 지역 정보가 있는 것은 제외)
        if (lowerCourseName.includes('멘토링') && lowerCourseName.includes('코디') && 
            !lowerCourseName.includes('고양') && !lowerCourseName.includes('강남') && 
            !lowerCourseName.includes('송파') && !lowerCourseName.includes('인천')) {
          return 'LTT : 멘토링 코디네이터 T.';
        }
        
        // 정확한 매칭 (기존 매핑 유지)
        const courseNameMap: Record<string, string> = {
          '파운데이션': 'LTT : 파운데이션 T.',
          '파운데이션 T.': 'LTT : 파운데이션 T.',
          '파운데이션트레이닝': 'LTT : 파운데이션 T.',
          '파운데이션 트레이닝': 'LTT : 파운데이션 T.',
          '멤버십위원회': 'LTT : 멤버십 위원회 T.',
          '멤버십 위원회': 'LTT : 멤버십 위원회 T.',
          '멤버십 위원회 T.': 'LTT : 멤버십 위원회 T.',
          'PR코디': 'LTT : PR 코디네이터T.',
          'PR 코디': 'LTT : PR 코디네이터T.',
          'PR코디네이터': 'LTT : PR 코디네이터T.',
          'PR 코디네이터': 'LTT : PR 코디네이터T.',
          'PR 코디네이터T.': 'LTT : PR 코디네이터T.',
          '교육코디네이터': 'LTT : 교육 코디네이터 T.',
          '교육 코디네이터': 'LTT : 교육 코디네이터 T.',
          '교육 코디네이터 T.': 'LTT : 교육 코디네이터 T.',
          '성장코디네이터': 'LTT : 성장 코디네이터 T.',
          '성장 코디네이터': 'LTT : 성장 코디네이터 T.',
          'ST도어퍼슨': 'LTT : ST T.',
          'ST & 도어퍼슨': 'LTT : ST T.',
          'ST': 'LTT : ST T.',
          'ST T.': 'LTT : ST T.',
          'ST & 도어퍼슨 T.': 'LTT : ST T.',
          '비지터호스트': 'LTT : 비지터 호스트 T.',
          '비지터 호스트': 'LTT : 비지터 호스트 T.',
          '이벤트코디네이터': 'LTT : 이벤트 코디네이터 T.',
          '이벤트 코디네이터': 'LTT : 이벤트 코디네이터 T.',
          '멘토링코디네이터': 'LTT : 멘토링 코디네이터 T.',
          '멘토링 코디네이터': 'LTT : 멘토링 코디네이터 T.'
        };
        
        return courseNameMap[courseName] || courseName;
      };

      // 먼저 모든 정식 과목 목록을 가져와서 0명으로 초기화
      try {
        const allPrograms = await this.getSecondarySheetPrograms();
        allPrograms.forEach(program => {
          programStats[program.title] = { total: 0, paid: 0, pending: 0 };
        });
      } catch (error) {
        console.error("Failed to fetch all programs for dashboard:", error);
        // 실패 시 기본 과목 목록으로 초기화
        const defaultPrograms = [
          'LTT : 파운데이션 T.',
          'LTT : 멤버십 위원회 T.',
          'LTT : PR 코디네이터T.',
          'LTT : 교육 코디네이터 T.',
          'LTT : 성장 코디네이터 T.',
          'LTT : ST T.',
          'LTT : 비지터 호스트 T.',
          'LTT : 이벤트 코디네이터 T.',
          'LTT : 멘토링 코디네이터 T.'
        ];
        defaultPrograms.forEach(program => {
          programStats[program] = { total: 0, paid: 0, pending: 0 };
        });
      }

      dataRows.forEach((row: string[], index: number) => {
        if (row.length >= 5) {
          const submittedAt = row[0] || '';        // A열: 신청일시
          const rawProgram = row[1] || '미지정';   // B열: 과목명
          const program = normalizeCourseName(rawProgram); // 정식 과목명으로 변환
          const region = row[2] || '미지정';      // C열: 지역
          const chapter = row[3] || '미지정';     // D열: 챕터
          const name = row[4] || '';             // E열: 멤버명
          const phone = row[5] || '';            // F열: 연락처
          const email = row[6] || '';            // G열: 이메일
          const participationType = row[7] || ''; // H열: 참여방식
          const notes = row[8] || '';            // I열: 특이사항
          const paymentStatus = row[9] || '대기'; // J열: 결제완료상태

          totalApplications++;
          const isPaid = paymentStatus === '완료' || paymentStatus === '결제완료';
          
          if (isPaid) {
            paidApplications++;
          } else {
            pendingApplications++;
          }

          // 프로그램별 통계 - 정식 과목명으로 집계
          if (!programStats[program]) {
            programStats[program] = { total: 0, paid: 0, pending: 0 };
          }
          programStats[program].total++;
          if (isPaid) {
            programStats[program].paid++;
          } else {
            programStats[program].pending++;
          }

          // 지역별 통계
          if (!regionStats[region]) {
            regionStats[region] = { total: 0, paid: 0, pending: 0 };
          }
          regionStats[region].total++;
          if (isPaid) {
            regionStats[region].paid++;
          } else {
            regionStats[region].pending++;
          }

          // 챕터별 통계
          if (!chapterStats[chapter]) {
            chapterStats[chapter] = { total: 0, paid: 0, pending: 0 };
          }
          chapterStats[chapter].total++;
          if (isPaid) {
            chapterStats[chapter].paid++;
          } else {
            chapterStats[chapter].pending++;
          }

          // 최근 신청 (최대 10개) - 정식 과목명으로 표시
          if (recentApplications.length < 10) {
            recentApplications.push({
              program, // 이미 normalizeCourseName으로 변환된 정식 과목명
              region,
              chapter,
              name,
              phone,
              email,
              participationType,
              paymentStatus,
              rowIndex: index + 2 // 시트에서 실제 행 번호 (헤더 포함)
            });
          }
        }
      });

      // 프로그램별 통계에서 별칭들을 정식 과목명으로 통합
      const consolidatedProgramStats: { [program: string]: { total: number; paid: number; pending: number } } = {};
      
      // 먼저 모든 정식 과목명으로 초기화
      const formalCourseNames = [
        'LTT : 파운데이션 T.',
        'LTT : 멤버십 위원회 T.',
        'LTT : PR 코디네이터T.',
        'LTT : 교육 코디네이터 T.',
        'LTT : 성장 코디네이터 T.',
        'LTT : ST T.',
        'LTT : 비지터 호스트 T.',
        'LTT : 이벤트 코디네이터 T.',
        'LTT : 멘토링 코디네이터 T.'
      ];
      
      formalCourseNames.forEach(courseName => {
        consolidatedProgramStats[courseName] = { total: 0, paid: 0, pending: 0 };
      });
      
      // programStats의 모든 항목을 정식 과목명으로 매핑해서 합산
      Object.entries(programStats).forEach(([courseName, stats]) => {
        const normalizedName = normalizeCourseName(courseName);
        if (consolidatedProgramStats[normalizedName]) {
          consolidatedProgramStats[normalizedName].total += stats.total;
          consolidatedProgramStats[normalizedName].paid += stats.paid;
          consolidatedProgramStats[normalizedName].pending += stats.pending;
        } else if (formalCourseNames.includes(normalizedName)) {
          // 정식 과목명인 경우 직접 추가
          consolidatedProgramStats[normalizedName] = { ...stats };
        }
      });

      return {
        totalApplications,
        paidApplications,
        pendingApplications,
        programStats: consolidatedProgramStats, // 통합된 통계 사용
        regionStats,
        chapterStats,
        recentApplications: recentApplications.reverse() // 최신순으로 정렬
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
  async getCompletedApplicationsCount(programTitle: string): Promise<number> {
    const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    
    if (!serviceAccountJson) {
      return 0;
    }

    try {
      const token = await getServiceAccountAccessToken('https://www.googleapis.com/auth/spreadsheets.readonly');
      const url = `${this.baseUrl}/${this.spreadsheetId}/values/'2026 LTT 신청명단'!A:J`;
      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!response.ok) throw new Error(`Sheets API error: ${response.status}`);
      const data = await response.json() as { values?: string[][] };
      const rows = data.values || [];
      let count = 0;

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const courseName = row[1] || "";
        const paymentStatus = row[9] || "";
        if (courseName === programTitle && paymentStatus === "완료") {
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
  async getAllProgramsCompletedCounts(): Promise<Record<string, number>> {
    const cacheKey = 'completed-counts';
    const cached = this.getCachedData<Record<string, number>>(cacheKey);
    if (cached) return cached;

    try {
      const token = await getServiceAccountAccessToken('https://www.googleapis.com/auth/spreadsheets.readonly');
      const url = `${this.baseUrl}/${this.spreadsheetId}/values/'2026 LTT 신청명단'!A:J`;
      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!response.ok) throw new Error(`Sheets API error: ${response.status}`);
      const data = await response.json() as { values?: string[][] };
      const rows = data.values || [];
      const counts: Record<string, number> = {};

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const courseName = row[1] || "";
        const paymentStatus = row[9] || "";
        if (courseName && paymentStatus === "완료") {
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
}

interface ApplicationSubmission {
  programTitle: string;
  name: string;
  email: string;
  phone: string;
  chapter?: string;
  trainingType: string;
  notes?: string;
}

export const googleSheetsService = new GoogleSheetsService();

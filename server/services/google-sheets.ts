import { GoogleSheetsData, googleSheetsDataSchema } from "../../shared/schema";
import { createSign } from "crypto";

// 보안: 환경변수에서 API 키 로드 (배포 전 필수)
const GOOGLE_SHEETS_API_KEY = process.env.GOOGLE_SHEETS_API_KEY || "";
const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID || "";

// 모듈 레벨 액세스 토큰 캐시 (스코프별로 구분)
const _cachedTokens: Map<string, { token: string; expiresAt: number }> = new Map();

export async function getServiceAccountAccessToken(scope: string): Promise<string> {
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
      
      // 시트의 시각은 KST 다. new Date(y,m,d,...) 는 **서버 로컬 타임존**으로 해석하는데
      // 운영(Railway)은 UTC 라 18:00 이 UTC 18:00 이 되고, 서울 기준으로 환산하면
      // 다음 날 03:00 이 된다 -> 캘린더 칸과 당일 리마인드가 하루씩 밀렸다.
      // 서버 타임존과 무관하게 같은 순간이 되도록 +09:00 을 명시한다.
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${year}-${pad(month)}-${pad(day)}T${pad(hours)}:${pad(minutes)}:00+09:00`;
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
    /**
     * 결제자. 개별 신청은 신청자 본인, 일괄 신청은 대신 결제하는 분이다.
     * 결제 **전에** 남겨야 한다 - 결제가 끝나지 않으면 누구에게 연락해야 할지
     * 알 수 없게 된다(2026-08-22 단체 2건에서 실제로 그랬다. 주문이 메모리에만
     * 있었고 30분 뒤 사라져 결제자를 영영 알 수 없다).
     */
    payer?: { name: string; phone: string; email?: string };
  }, reuseRow?: number): Promise<number> {
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

      // A~I 신청 내용 + (J~R 결제/취소 열은 비운다) + S~U 결제자.
      // 한 번에 쓰면 호출이 늘지 않는다. 재사용 대상은 미결제·미취소 행뿐이라
      // J~R 을 빈값으로 덮어도 잃을 값이 없다.
      const payer = applicationData.payer;
      const values = [[
        submittedAt,
        applicationData.programTitle,
        applicationData.region,
        applicationData.chapter,
        applicationData.name,
        formatPhoneNumber(applicationData.phone),
        applicationData.email,
        applicationData.participationType,
        applicationData.notes || '',
        '', '', '', '', '', '', '', '', '',
        payer?.name || '',
        payer?.phone ? formatPhoneNumber(payer.phone) : '',
        payer?.email || '',
      ]];

      // 이탈했다 돌아온 분은 **자기 행을 다시 쓴다**. 새 행을 만들면 결제대기가 사람 수보다
      // 부풀고, 나중에 어느 행이 진짜인지 알 수 없게 된다.
      const isReuse = typeof reuseRow === 'number' && reuseRow > 1;
      const range = isReuse
        ? encodeURIComponent(`'2026 LTT 신청명단'!A${reuseRow}:U${reuseRow}`)
        : encodeURIComponent("'2026 LTT 신청명단'!A:U");
      const url = isReuse
        ? `${this.baseUrl}/${this.spreadsheetId}/values/${range}?valueInputOption=RAW`
        : `${this.baseUrl}/${this.spreadsheetId}/values/${range}:append?valueInputOption=RAW`;
      const response = await fetch(url, {
        method: isReuse ? 'PUT' : 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ Google Sheets API 응답 오류 (${response.status}):`, errorText);
        throw new Error(`Google Sheets 저장 실패: ${response.status} - ${errorText}`);
      }

      const result = await response.json();
      console.log(
        `✅ Google Sheets ${isReuse ? '재사용' : '저장'} 성공: ${applicationData.name} (${applicationData.programTitle})`
        + (isReuse ? ` -> ${reuseRow}행` : '')
      );

      if (isReuse) return reuseRow as number;

      // 결제 승인 후 이 행의 J열(결제완료)을 갱신해야 하므로 행 번호를 돌려준다.
      // updatedRange 예: '2026 LTT 신청명단'!A15:I15
      const updatedRange: string = result?.updates?.updatedRange || '';
      const rowMatch = updatedRange.match(/![A-Z]+(\d+)/);
      return rowMatch ? parseInt(rowMatch[1], 10) : 0;
    } catch (error) {
      console.error('❌ Google Sheets 저장 실패:', error);
      throw error;
    }
  }

  /**
   * 결제 승인이 떨어진 신청 행에 결제 정보를 기록한다.
   * J열 '완료'가 신청자 수 집계의 기준이므로 이 값이 곧 카운트에 반영된다.
   */
  /**
   * 신청명단 시트를 그대로 읽는다. 당일 리마인드가 정본으로 삼는 경로.
   * API 키(읽기 전용)로 충분하고, 캐시를 타지 않는다 — 방금 결제한 행도 보여야 한다.
   */
  /**
   * 취소된 신청인지. 신청명단 **R열(index 17)** 에 값이 있으면 취소다.
   * 담당자가 취소·환불 접수 응답 시트에서 '환불처리 = 완료' 를 넣으면 스크립트가 여기에 시각을 적는다.
   *
   * 집계·중복판정에서 이 행을 빼지 않으면 취소한 사람이 계속 정원에 잡히고
   * 같은 과목을 다시 신청할 수도 없다.
   */
  private isCancelledRow(row: string[]): boolean {
    return String(row[17] || '').trim().length > 0;
  }

  /**
   * 결제가 끝난 행인가. J열이 '완료'일 때만 참이다.
   *
   * 중복 판정에 쓴다. 신청 행은 **결제 전에** 먼저 쓰이므로(routes.ts prepare),
   * 결제창을 못 띄웠거나 닫은 분의 행이 미결제 상태로 남는다. 그 행을 중복으로 보면
   * 본인이 다시 신청할 때마다 409 로 튕겨 결제창 자체가 열리지 않는다
   * (2026-08-22 장애: 미결제 57건 전원이 재신청 불가 상태로 잠김).
   * 돈을 낸 적 없는 행은 신청을 막지 않는다.
   */
  private isPaidRow(row: string[]): boolean {
    const status = String(row[9] || '').trim();
    return status === '완료' || status === '결제완료';
  }

  /**
   * 재사용 대상 행을 찾기 위한 키.
   *
   * **지역·챕터·이름·연락처·과목명이 전부 같을 때만** 같은 신청으로 본다.
   * 덮어쓰기(PUT)에 쓰이는 키라 느슨하면 남의 신청을 지운다 — 동명이인이나
   * 부분일치로 잡히면 안 된다. 과목명만 달라도 다른 신청이다.
   *
   * 공백과 전화번호 표기(010-1234-5678 / 01012345678)만 정규화한다.
   * 이건 느슨하게 보는 게 아니라 같은 값을 같게 보는 것이다.
   */
  private reuseKey(entry: {
    programTitle: string; region: string; chapter: string; name: string; phone: string;
  }): string {
    const t = (v: string) => String(v || '').trim().replace(/\s+/g, ' ');
    const digits = String(entry.phone || '').replace(/\D/g, '');
    return [t(entry.programTitle), t(entry.region), t(entry.chapter), t(entry.name), digits].join('|');
  }

  /**
   * 결제를 끝내지 못하고 이탈한 분의 **기존 행 번호**를 찾는다.
   *
   * 신청 행은 결제 전에 먼저 쓰이므로, 이탈했다 돌아온 분에게 새 행을 만들면
   * 결제대기 건수가 실제 사람 수보다 계속 부풀어 오른다. 자기 행으로 되돌려보낸다.
   *
   * 재사용 조건 세 가지가 모두 맞아야 한다:
   *   1) reuseKey 5개 항목 완전일치
   *   2) 미결제 (J열이 '완료'가 아님)   - 결제한 행을 덮으면 결제 기록이 날아간다
   *   3) 미취소 (R열이 비어 있음)       - 취소 행은 기록이라 보존하고 새 행을 만든다
   *
   * 시트는 한 번만 읽는다. 같은 키가 여럿이면 가장 위(먼저 만들어진) 행을 쓴다.
   */
  async findReusableRows(entries: Array<{
    programTitle: string; region: string; chapter: string; name: string; phone: string;
  }>): Promise<Map<string, number>> {
    const found = new Map<string, number>();
    if (!this.spreadsheetId || entries.length === 0) return found;

    try {
      const token = await getServiceAccountAccessToken('https://www.googleapis.com/auth/spreadsheets.readonly');
      const range = encodeURIComponent("'2026 LTT 신청명단'!A:R");
      const response = await fetch(`${this.baseUrl}/${this.spreadsheetId}/values/${range}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!response.ok) {
        // 못 찾으면 새 행을 만든다. 재사용은 최적화지 필수 경로가 아니다.
        console.error('재사용 행 조회 API 오류:', response.status);
        return found;
      }

      const rows = ((await response.json()) as { values?: string[][] }).values || [];
      const wanted = new Set(entries.map((e) => this.reuseKey(e)));

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (this.isCancelledRow(row)) continue;
        if (this.isPaidRow(row)) continue;

        const key = this.reuseKey({
          programTitle: row[1] || '', region: row[2] || '', chapter: row[3] || '',
          name: row[4] || '', phone: row[5] || '',
        });
        if (!wanted.has(key)) continue;
        if (found.has(key)) continue;   // 같은 키가 여럿이면 가장 위 행
        found.set(key, i + 1);          // 시트 행 번호는 1-based, 헤더가 1행
      }

      if (found.size > 0) {
        console.log(`↻ 이탈 후 재신청 ${found.size}건 - 기존 행 재사용: ${Array.from(found.values()).join(', ')}행`);
      }
      return found;
    } catch (error) {
      console.error('재사용 행 조회 실패 (새 행으로 진행):', error);
      return found;
    }
  }

  /**
   * 「결제 이어하기」용. 지정한 행 번호들을 신청명단에서 읽어 온다.
   *
   * 링크로 결제를 이어받을 때 쓴다. 토큰이 가리키는 행이 그 사이에 결제되거나
   * 취소됐을 수 있으므로, **여기서 읽은 현재 값**으로만 판단한다.
   * 반환은 요청한 행 순서를 지킨다(금액·수신자 순서가 어긋나면 안 된다).
   */
  async getApplicationRowsByNumbers(rowNumbers: number[]): Promise<Map<number, string[]>> {
    const out = new Map<number, string[]>();
    if (!this.spreadsheetId || rowNumbers.length === 0) return out;

    const token = await getServiceAccountAccessToken('https://www.googleapis.com/auth/spreadsheets.readonly');
    const range = encodeURIComponent("'2026 LTT 신청명단'!A:R");
    const response = await fetch(`${this.baseUrl}/${this.spreadsheetId}/values/${range}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!response.ok) {
      throw new Error(`신청명단 읽기 실패: ${response.status}`);
    }

    const rows = ((await response.json()) as { values?: string[][] }).values || [];
    for (const n of rowNumbers) {
      const row = rows[n - 1];   // 시트 1행 = 배열 0번
      if (row) out.set(n, row);
    }
    return out;
  }

  /**
   * 참여 방식(H열)을 바꾼다. 「결제 이어하기」 화면에서 실시간 <-> 녹화본을 고를 때 쓴다.
   * 금액은 같고, 결제 후 안내 문자에 들어갈 링크가 갈리므로 결제 **전에** 정해져야 한다.
   */
  async updateParticipationType(row: number, participationType: string): Promise<void> {
    const token = await getServiceAccountAccessToken('https://www.googleapis.com/auth/spreadsheets');
    const range = encodeURIComponent(`'2026 LTT 신청명단'!H${row}`);
    const response = await fetch(
      `${this.baseUrl}/${this.spreadsheetId}/values/${range}?valueInputOption=RAW`,
      {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: [[participationType]] }),
      }
    );
    if (!response.ok) {
      throw new Error(`참여 방식 변경 실패: ${response.status}`);
    }
    console.log(`✎ 참여 방식 변경: ${row}행 -> ${participationType}`);
  }

  /** 행이 결제 가능한 상태인가 (미결제 + 미취소). 「결제 이어하기」가 매번 다시 본다. */
  isRowPayable(row: string[]): boolean {
    return !this.isCancelledRow(row) && !this.isPaidRow(row);
  }

  /** routes/storage 가 같은 키를 쓰도록 공개한다. */
  buildReuseKey(entry: {
    programTitle: string; region: string; chapter: string; name: string; phone: string;
  }): string {
    return this.reuseKey(entry);
  }

  async readApplicationRows(range: string): Promise<string[][]> {
    const url = `${this.baseUrl}/${this.spreadsheetId}/values/${encodeURIComponent(range)}?key=${this.apiKey}`;
    const response = await fetch(url);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`신청명단 읽기 실패 ${response.status}: ${text.slice(0, 200)}`);
    }
    const data = await response.json();
    return (data.values || []) as string[][];
  }

  /**
   * 신청명단의 특정 셀들에 값을 쓴다 (리마인드 발송 표시 등).
   * 쓰기는 API 키로 못 하므로 서비스 계정 토큰을 쓴다.
   */
  async writeApplicationCells(data: Array<{ range: string; values: any[][] }>): Promise<void> {
    if (!data.length) return;
    const token = await getServiceAccountAccessToken('https://www.googleapis.com/auth/spreadsheets');
    const url = `${this.baseUrl}/${this.spreadsheetId}/values:batchUpdate`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ valueInputOption: 'RAW', data }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`신청명단 쓰기 실패 ${response.status}: ${text.slice(0, 200)}`);
    }
  }

  async markApplicationPaid(row: number, info: {
    orderId: string;
    paymentKey: string;
    method?: string;
    approvedAt?: string;
    amount?: number;
    /** 승인 시점에도 한 번 더 남긴다 - 「결제 이어하기」는 행이 이미 있어 신청 때 못 썼을 수 있다. */
    payer?: { name: string; phone: string; email?: string };
  }): Promise<void> {
    if (!row || row < 2) {
      console.warn('⚠ markApplicationPaid: 행 번호가 없어 시트 기록을 건너뜁니다.', info.orderId);
      return;
    }

    const token = await getServiceAccountAccessToken('https://www.googleapis.com/auth/spreadsheets');

    const approvedAtKst = info.approvedAt
      ? new Intl.DateTimeFormat('ko-KR', {
          year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', second: '2-digit',
          timeZone: 'Asia/Seoul'
        }).format(new Date(info.approvedAt))
      : '';

    const data = [
      { range: `'2026 LTT 신청명단'!J${row}`, values: [['완료']] },
      {
        range: `'2026 LTT 신청명단'!M${row}:P${row}`,
        values: [[info.orderId, info.paymentKey, info.method || '', approvedAtKst]],
      },
    ];

    if (info.payer?.name) {
      data.push({
        range: `'2026 LTT 신청명단'!S${row}:U${row}`,
        values: [[info.payer.name, formatPhoneNumber(info.payer.phone || ''), info.payer.email || '']],
      });
    }

    const url = `${this.baseUrl}/${this.spreadsheetId}/values:batchUpdate`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ valueInputOption: 'RAW', data }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ 결제완료 기록 실패 (${response.status}):`, errorText);
      throw new Error(`결제완료 기록 실패: ${response.status}`);
    }

    // 신청자 수가 즉시 반영되도록 카운트 캐시를 비운다.
    this.cache.delete('completed-counts');
    console.log(`✅ 결제완료 기록: ${row}행 / ${info.orderId}`);
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
      // 취소된 신청은 중복으로 보지 않는다 → R열(취소)까지 읽는다.
      const range = encodeURIComponent("'2026 LTT 신청명단'!A:R");
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
        if (this.isCancelledRow(row)) continue;   // 취소했으면 다시 신청할 수 있어야 한다
        if (!this.isPaidRow(row)) continue;      // 미결제는 확정이 아니다 -> 다시 신청할 수 있어야 한다
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
      // 취소된 신청은 중복으로 보지 않는다 → R열(취소)까지 읽는다.
      const range = encodeURIComponent("'2026 LTT 신청명단'!A:R");
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
        if (this.isCancelledRow(row)) continue;   // 취소했으면 다시 신청할 수 있어야 한다
        if (!this.isPaidRow(row)) continue;      // 미결제는 확정이 아니다 -> 다시 신청할 수 있어야 한다
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
        // H열은 '표기 + URL' 형태를 허용한다. href 로 쓸 수 있는 건 URL 부분뿐이다.
        const venueUrl = (String(venueLink).match(/https?:\/\/[^\s]+/i) || [''])[0];
        // I열(온라인 강의실)이 비어 있으면 J열(줌링크)을 강의실 링크로 사용
        const onlineLink = row[8] || row[9] || '';
        
        // K열(index 10): 어드민이 '마감' 입력 시 신청 불가
        const deadlineStatus = row[10] ? String(row[10]).trim() : '';
        const isClosed = deadlineStatus === '마감';

        // L열(index 11): 결제 금액(원). 어드민이 시트에서 직접 관리한다.
        const price = parseInt(String(row[11] ?? '').replace(/[^0-9]/g, ''), 10) || 0;

        const program = {
          id: `secondary-${i}`,
          sessionNumber: row[0] || '',
          date: row[1] || '',
          time: row[2] || '',
          title: title,
          instructor: row[4] || '',
          description: descriptions[title] || row[5] || '',
          storeUrl: row[6] || '',
          price,
          format: venueLink ? '오프라인' : '온라인',
          isAvailable: !isClosed,
          maxParticipants: 50,
          currentParticipants: 0,
          formattedDate: this.parseKoreanDate(row[1], row[2]),
          location: this.parseLocationFromData(venueLink || onlineLink, title),
          venueUrl: venueUrl,
          classroomUrl: onlineLink || '',
          // 문자 발송은 둘을 구분해야 한다. 실시간=J열(줌), VOD=I열(강의실).
          // 오프라인 과목은 J열이 비어 있어 장소(H열)로 안내한다.
          zoomUrl: String(row[9] || ''),
          // M열(index 12): VOD 열람비번. 비어 있으면 문자에서 그 줄이 빠진다.
          classroomPw: String(row[12] || '').trim(),
          venueText: String(venueLink || ''),
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
      // ⛔ A:J 까지만 읽으면 R열(취소)을 못 본다 — 취소한 신청이 대시보드에 계속 잡힌다.
      const url = `${this.baseUrl}/${this.spreadsheetId}/values/'2026 LTT 신청명단'!A:R?key=${this.apiKey}`;
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
        // 취소된 신청은 집계·최근 신청 어디에도 넣지 않는다.
        // 정원·마감 집계와 같은 기준(R열)을 써야 화면끼리 숫자가 안 어긋난다.
        if (this.isCancelledRow(row)) return;
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
      const url = `${this.baseUrl}/${this.spreadsheetId}/values/'2026 LTT 신청명단'!A:R`;
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
        if (courseName === programTitle && paymentStatus === "완료" && !this.isCancelledRow(row)) {
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
      const url = `${this.baseUrl}/${this.spreadsheetId}/values/'2026 LTT 신청명단'!A:R`;
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
        if (courseName && paymentStatus === "완료" && !this.isCancelledRow(row)) {
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

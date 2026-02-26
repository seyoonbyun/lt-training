// Frontend utility for Google Sheets integration
// This file can be used for any client-side Google Sheets operations if needed

export interface GoogleSheetsConfig {
  apiKey: string;
  spreadsheetId: string;
}

export class GoogleSheetsClient {
  private config: GoogleSheetsConfig;

  constructor(config: GoogleSheetsConfig) {
    this.config = config;
  }

  // This can be used if direct client-side integration is needed
  // Currently, we're using server-side integration through our API
  async fetchRange(range: string): Promise<any[][]> {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${this.config.spreadsheetId}/values/${range}?key=${this.config.apiKey}`;
    
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch Google Sheets data: ${response.statusText}`);
    }
    
    const data = await response.json();
    return data.values || [];
  }
}

// Export a default client instance if needed
export const createGoogleSheetsClient = (config: GoogleSheetsConfig) => {
  return new GoogleSheetsClient(config);
};

// Application interface for form submissions
export interface ApplicationSubmission {
  name: string;
  email: string;
  phone: string;
  chapter?: string;
  trainingType: 'live' | 'recorded';
  notes?: string;
  programTitle: string;
  programId: string;
}

// Add application to Google Sheets
export async function addApplicationToSheets(application: ApplicationSubmission): Promise<void> {
  const API_KEY = import.meta.env.VITE_GOOGLE_SHEETS_API_KEY;
  const SPREADSHEET_ID = import.meta.env.VITE_GOOGLE_SPREADSHEET_ID;
  
  if (!API_KEY || !SPREADSHEET_ID) {
    throw new Error('Google Sheets API 설정이 필요합니다.');
  }

  // Get current timestamp in Korean timezone
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

  const values = [
    [
      koreaTime, // 신청일시
      application.programTitle, // 프로그램명
      application.name, // 이름
      application.phone, // 연락처
      application.email, // 이메일
      application.chapter || '', // 소속 챕터
      application.trainingType === 'live' ? '실시간 강의 참여' : '녹화본 시청', // 참여 방식
      application.notes || '', // 특이사항
      '대기', // 상태
    ]
  ];

  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/신청자목록:append?valueInputOption=RAW&key=${API_KEY}`;
  
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
    throw new Error(`Google Sheets 저장 실패: ${response.status}`);
  }

  const result = await response.json();
  console.log('Application added to Google Sheets:', result);
}

// Bulk upload applications from Excel file
export async function bulkUploadApplications(applications: ApplicationSubmission[]): Promise<void> {
  const API_KEY = import.meta.env.VITE_GOOGLE_SHEETS_API_KEY;
  const SPREADSHEET_ID = import.meta.env.VITE_GOOGLE_SPREADSHEET_ID;
  
  if (!API_KEY || !SPREADSHEET_ID) {
    throw new Error('Google Sheets API 설정이 필요합니다.');
  }

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
    koreaTime, // 신청일시
    app.programTitle, // 프로그램명
    app.name, // 이름
    app.phone, // 연락처
    app.email, // 이메일
    app.chapter || '', // 소속 챕터
    app.trainingType === 'live' ? '실시간 강의 참여' : '녹화본 시청', // 참여 방식
    app.notes || '', // 특이사항
    '대기', // 상태
  ]);

  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/신청자목록:append?valueInputOption=RAW&key=${API_KEY}`;
  
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
  console.log('Bulk applications added to Google Sheets:', result);
}

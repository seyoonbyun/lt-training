# Google Apps Script 웹앱 설정 가이드

## 목적
Google Sheets API 키로는 쓰기가 불가능하므로, Google Apps Script 웹앱을 통해 신청 데이터를 Google Sheets에 자동 저장합니다.

## 설정 단계

### 1. Google Apps Script 프로젝트 생성
1. https://script.google.com 접속
2. "새 프로젝트" 클릭
3. 프로젝트 이름을 "BNI LTT Application Handler"로 변경

### 2. Apps Script 코드 작성
아래 코드를 복사하여 Code.gs에 붙여넣기:

```javascript
function doPost(e) {
  try {
    // 스프레드시트 ID 설정
    const SPREADSHEET_ID = '1LWEo74APBI3QxaexSWq_SnlQgmLPYCDl0YWVwhY8tbA';
    const SHEET_NAME = '시트1'; // 실제 시트명으로 변경
    
    // POST 데이터 파싱
    const postData = JSON.parse(e.postData.contents);
    
    // 스프레드시트 열기
    const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = spreadsheet.getSheetByName(SHEET_NAME) || spreadsheet.getActiveSheet();
    
    // 현재 시간 (한국 시간)
    const now = new Date();
    const koreaTime = Utilities.formatDate(now, 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss');
    
    // A-G 열 구조에 맞게 데이터 구성
    const rowData = [
      postData.region,           // A: 지역
      postData.chapter,          // B: 챕터  
      postData.name,             // C: 멤버명
      postData.phone,            // D: 연락처(H.P)
      postData.email,            // E: 이메일
      postData.participationType, // F: 참여 방식
      postData.notes || '',      // G: 특이사항 & 문의
      '',                        // H: (빈 열)
      '신청완료',                 // I: 결제 상태
      postData.programTitle,     // J: 프로그램명
      koreaTime                  // K: 신청 시간
    ];
    
    // 시트에 데이터 추가
    sheet.appendRow(rowData);
    
    // 성공 응답
    return ContentService
      .createTextOutput(JSON.stringify({
        success: true,
        message: '신청이 성공적으로 저장되었습니다.',
        timestamp: koreaTime
      }))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (error) {
    // 오류 응답
    return ContentService
      .createTextOutput(JSON.stringify({
        success: false,
        message: '저장 중 오류가 발생했습니다: ' + error.toString()
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  return ContentService
    .createTextOutput('BNI LTT Application Handler is running')
    .setMimeType(ContentService.MimeType.TEXT);
}
```

### 3. 웹앱 배포
1. 코드 저장 후 "배포" > "새 배포" 클릭
2. 설정:
   - 유형: 웹앱
   - 실행자: 나 (본인의 Google 계정)
   - 액세스 권한: 모든 사용자
3. "배포" 클릭하고 권한 승인
4. **웹앱 URL 복사** (예: https://script.google.com/macros/s/AKfycby.../exec)

### 4. 이 URL을 환경변수로 설정
복사한 웹앱 URL을 `GOOGLE_APPS_SCRIPT_URL` 환경변수로 설정합니다.

## 장점
- API 키 불필요
- OAuth2 인증 불필요  
- 간단한 HTTP POST로 데이터 저장
- Google Sheets에 직접 쓰기 권한
- 무료 사용 가능

## 테스트 방법
웹앱 URL에 POST 요청으로 다음 JSON 데이터를 전송:

```json
{
  "region": "서울",
  "chapter": "강남",
  "name": "홍길동",
  "phone": "010-1234-5678", 
  "email": "test@example.com",
  "participationType": "실시간 참여",
  "notes": "테스트 신청",
  "programTitle": "LT Training: 파운데이션"
}
```
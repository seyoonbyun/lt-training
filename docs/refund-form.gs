/**
 * 취소·환불 접수 폼 만들기 — 한 번만 실행한다.
 *
 * `ltt_mail_relay` 프로젝트(또는 아무 Apps Script 프로젝트)에 이 파일을 같이 넣고
 * **`createRefundForm` 을 한 번 실행**하면 폼이 만들어지고 실행 로그에 주소 두 개가 찍힌다.
 *   - 공개 주소(published)  → 서버 `shared/refund-policy.ts` 의 REFUND_FORM_URL 에 넣는다
 *   - 편집 주소(edit)       → 담당자가 문항을 고칠 때 쓴다
 *
 * 응답은 신청명단 스프레드시트에 새 탭으로 붙는다(담당자가 신청 현황과 같은 파일에서 본다).
 * hq 계정에 그 파일 편집 권한이 없으면 자동으로 **폼 전용 시트를 새로 만들고** 그 주소를 찍는다.
 *
 * ⭐ 일괄(대리) 신청 취소는 **어느 과목의 누구**인지가 반드시 필요하다 —
 *    결제자 한 명이 여러 사람 몫을 냈기 때문에, 이름 없이는 어느 행을 취소할지 알 수 없다.
 *    그래서 '취소할 수강자' 를 필수로 두고, 예시까지 붙여 둔다.
 */

/** 신청명단 스프레드시트 ID (응답을 여기에 붙인다) */
var APPLICATION_SHEET_ID = '1ksNpdM_3AZLyMvmSXG8GLf_dZMxcxXvx5PHNOrKujH8';

/** 세션등록 스프레드시트 ID (과목 목록을 여기서 읽는다) */
var SESSION_SHEET_ID = '1An8PTweRqmDsHeClpenaPxp2BagNy-osRlSg6tTHdXM';

var SUBJECT_FALLBACK = [
  'LTT : 의장 T.',
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

function createRefundForm() {
  var subjects = readSubjects_();

  var form = FormApp.create('BNI Korea LT Training · 취소 · 환불 접수');
  form.setDescription(
    '트레이닝 수강 취소 및 환불을 접수합니다.\n\n' +
    '· 수강 시작 3일 전까지 요청하신 건은 전액 환불됩니다.\n' +
    '· 수강 시작일 당일 또는 강의 시작 후에는 환불이 불가합니다.\n' +
    '· 접수 후 담당자가 확인하여 확인 이메일을 보내드리면 취소 절차가 완료됩니다.\n\n' +
    '문의 : BNI코리아 내셔널 오피스 CS팀 02-6261-8838'
  );
  form.setCollectEmail(false);
  form.setProgressBar(false);
  form.setConfirmationMessage(
    '접수되었습니다. 담당자 확인 후 확인 이메일을 보내드립니다.\n문의 : 02-6261-8838'
  );

  form.addTextItem().setTitle('신청(결제)하신 분 성명').setRequired(true);
  form.addTextItem().setTitle('연락처').setHelpText('결제 시 입력하신 번호를 적어주세요.').setRequired(true);
  form.addTextItem().setTitle('이메일').setHelpText('취소 확인 안내를 보내드릴 주소입니다.').setRequired(true);

  form.addMultipleChoiceItem()
    .setTitle('신청 유형')
    .setChoiceValues(['개별 신청 (본인이 수강)', '일괄(대리) 신청 (여러 명을 대신 신청)'])
    .setRequired(true);

  form.addCheckboxItem()
    .setTitle('취소할 과목')
    .setHelpText('취소를 원하시는 과목을 모두 선택해 주세요.')
    .setChoiceValues(subjects)
    .setRequired(true);

  form.addParagraphTextItem()
    .setTitle('취소할 수강자')
    .setHelpText(
      '누구의 신청을 취소하는지 과목별로 적어주세요. 이 정보가 없으면 처리해 드릴 수 없습니다.\n' +
      '예) 파운데이션 T. - 홍길동, 김영희 / 의장 T. - 박철수\n' +
      '본인 한 분만 취소하시는 경우에도 성명을 적어주세요.'
    )
    .setRequired(true);

  form.addTextItem()
    .setTitle('주문번호')
    .setHelpText('결제 완료 문자·이메일에 적힌 번호입니다. 모르시면 비워두셔도 됩니다.')
    .setRequired(false);

  form.addTextItem()
    .setTitle('환불 계좌')
    .setHelpText('은행 / 계좌번호 / 예금주 순으로 적어주세요. 카드 결제 건은 승인 취소되므로 비워두셔도 됩니다.')
    .setRequired(false);

  form.addParagraphTextItem().setTitle('취소 사유').setRequired(false);

  form.addCheckboxItem()
    .setTitle('환불 규정 확인')
    .setChoiceValues(['수강 시작일 당일 및 강의 시작 후에는 환불이 불가함을 확인했습니다.'])
    .setRequired(true);

  // ── 응답 시트 연결
  var destination = '';
  try {
    form.setDestination(FormApp.DestinationType.SPREADSHEET, APPLICATION_SHEET_ID);
    destination = SpreadsheetApp.openById(APPLICATION_SHEET_ID).getUrl();
  } catch (err) {
    var ss = SpreadsheetApp.create('LTT 취소·환불 접수 응답');
    form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());
    destination = ss.getUrl();
    Logger.log('⚠ 신청명단에 붙이지 못해 새 시트를 만들었습니다: ' + err);
  }

  Logger.log('── 폼이 만들어졌습니다 ──');
  Logger.log('공개 주소 (REFUND_FORM_URL 에 넣을 값): ' + form.getPublishedUrl());
  Logger.log('편집 주소: ' + form.getEditUrl());
  Logger.log('응답 시트: ' + destination);

  return {
    published: form.getPublishedUrl(),
    edit: form.getEditUrl(),
    responses: destination
  };
}

/** 세션등록 시트에서 과목명을 읽는다. 못 읽으면 위의 고정 목록을 쓴다. */
function readSubjects_() {
  try {
    var sheet = SpreadsheetApp.openById(SESSION_SHEET_ID).getSheetByName('LTT 세션등록');
    var values = sheet.getRange('D3:D20').getValues();
    var out = [];
    for (var i = 0; i < values.length; i++) {
      var v = String(values[i][0] || '').trim();
      if (v) out.push(v);
    }
    if (out.length) return out;
  } catch (err) {
    Logger.log('과목 목록을 읽지 못해 고정 목록을 씁니다: ' + err);
  }
  return SUBJECT_FALLBACK;
}

/**
 * 취소·환불 처리 — 담당자가 응답 시트 `환불처리` 열에 **완료** 를 넣으면 돌아간다.
 *
 * 하는 일
 *   1) 신청명단(`2026 LTT 신청명단`)에서 그 접수에 해당하는 행을 찾아 **S열(취소)** 에 시각을 적는다
 *      → 사이트의 신청자 수·`신청 현황` 탭·대시보드에서 그만큼 빠진다(서버가 S열을 보고 거른다)
 *   2) 접수자와 **취소된 수강자 전원**에게 환불 완료 안내 문자 (T열에 발송 시각)
 *   3) 정산 담당자(탐)에게 **처리 통보 문자**
 *   4) 어느 행을 취소했는지 응답 시트 `처리결과` 열에 남긴다
 *
 * ⛔ 매칭에 실패하면 **아무것도 취소하지 않고** `처리결과` 에 실패로 적고 탐에게 알린다.
 *    엉뚱한 사람의 신청을 취소하는 것이 처리 지연보다 훨씬 나쁘다.
 *
 * ── 설치
 *   1) 이 파일을 `LT26_취소환불신청` 프로젝트에 Code2.gs 로 추가
 *   2) 스크립트 속성에 SOLAPI_API_KEY · SOLAPI_API_SECRET · SOLAPI_SENDER 를 넣는다
 *      (값은 서버 .env 와 같은 것. 발신번호 0262618838)
 *   3) 트리거 추가 → 함수 `onRefundEdit` · 이벤트 소스 `스프레드시트에서` · 이벤트 유형 `수정 시`
 *      ⚠ 단순 트리거(onEdit)로는 외부 호출·다른 파일 쓰기가 막히므로 **설치형 트리거**여야 한다
 */

var APP_SHEET_ID = '1ksNpdM_3AZLyMvmSXG8GLf_dZMxcxXvx5PHNOrKujH8';
/**
 * 취소·환불 접수 응답 탭.
 *
 * ⛔ **이름으로만 찾으면 탭 이름을 바꾸는 순간 조용히 죽는다.**
 *    2026-08-22 실제로 `설문지 응답 시트1` → `취소 환불 접수` 로 바뀌면서
 *    onRefundEdit 이 첫 줄에서 되돌아 나가 처리결과가 통째로 비었다(오류도 안 남았다).
 *    → 아래 후보 이름을 먼저 보고, 없으면 **1행 헤더로** 찾는다.
 */
var RESPONSE_TAB_NAMES = ['취소 환불 접수', '설문지 응답 시트1'];
var RESPONSE_TAB = RESPONSE_TAB_NAMES[0];   // 로그·안내에 쓸 대표 이름

/** 응답 탭을 찾는다. 이름이 바뀌어도 헤더(`환불처리`·`처리결과`)로 찾아낸다. */
function getResponseSheet_(ss) {
  for (var i = 0; i < RESPONSE_TAB_NAMES.length; i++) {
    var byName = ss.getSheetByName(RESPONSE_TAB_NAMES[i]);
    if (byName) return byName;
  }
  var all = ss.getSheets();
  for (var j = 0; j < all.length; j++) {
    var head = all[j].getRange(1, 1, 1, Math.max(all[j].getLastColumn(), C_RESULT)).getValues()[0];
    var joined = head.join('|');
    if (joined.indexOf('환불처리') !== -1 && joined.indexOf('처리결과') !== -1) return all[j];
  }
  return null;
}

/** 편집된 시트가 응답 탭인가 — 이름이 아니라 시트 id 로 대조한다. */
function isResponseSheet_(sheet) {
  var target = getResponseSheet_(sheet.getParent());
  return !!target && target.getSheetId() === sheet.getSheetId();
}
var APPLICATION_TAB = '2026 LTT 신청명단';

/** 정산 담당자 */
var SETTLEMENT_CONTACTS = [
  { name: '탐',   phone: '01089401172' },
  { name: '조이', phone: '01028033021' }
];

/** 처리 통보를 담당자 전원에게. 한 명이 실패해도 나머지는 보낸다. */
function notifySettlement_(text) {
  for (var i = 0; i < SETTLEMENT_CONTACTS.length; i++) {
    try {
      sendSms_(SETTLEMENT_CONTACTS[i].phone, text);
    } catch (err) {
      Logger.log('담당자 통보 실패 (' + SETTLEMENT_CONTACTS[i].name + '): ' + err);
    }
  }
}

/** 응답 시트 열 (1-based) */
var C_TIMESTAMP = 1, C_PAYER = 2, C_PHONE = 3, C_EMAIL = 4, C_TYPE = 5,
    C_SUBJECTS = 6, C_ATTENDEES = 7, C_ORDER = 8, C_ACCOUNT = 9, C_REASON = 10,
    C_AGREE = 11, C_STATUS = 12, C_RESULT = 13;

/** 신청명단 열 (0-based, 배열 인덱스) */
var A_TITLE = 1, A_NAME = 4, A_PHONE = 5, A_PAID = 9, A_ORDER = 11,
    A_CANCEL = 18, A_CANCEL_SMS = 19;

/**
 * 이 스크립트가 만지는 열의 **기대 머리글**.
 *
 * 서버는 sheet-schema.ts 가 이름으로 열을 찾지만, Apps Script 는 그 코드를 못 쓰고
 * 위 숫자를 손으로 박아야 한다. 시트에서 열을 하나만 넣거나 옮겨도 이 숫자가 전부
 * 어긋나고, 그대로 두면 **엉뚱한 열에 취소를 적는다**. 그래서 쓰기 직전에 머리글을
 * 확인하고 하나라도 다르면 아무것도 하지 않고 멈춘다.
 * (2026-08-23 에 열이 11칸 밀려 기록됐는데 아무 경보가 없었다.)
 */
var A_EXPECT = {
  1: '과목명', 4: '멤버명', 5: '연락처(H.P)', 9: '신청현황',
  11: '주문번호', 18: '취소', 19: '취소 안내 문자 발송'
};

/** 0-based 인덱스 -> 열 문자 */
function colLetter_(i) {
  var n = i, out = '';
  do { out = String.fromCharCode(65 + (n % 26)) + out; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return out;
}

/** 신청명단 머리글이 코드와 맞는지. 다르면 사유를 돌려준다(맞으면 빈 문자열). */
function headerProblem_(apps) {
  var head = apps.getRange(1, 1, 1, apps.getLastColumn()).getValues()[0];
  var bad = [];
  for (var key in A_EXPECT) {
    var i = Number(key);
    var got = String(head[i] || '').trim();
    if (got !== A_EXPECT[key]) bad.push(colLetter_(i) + '열: 기대 "' + A_EXPECT[key] + '" / 실제 "' + got + '"');
  }
  return bad.join(' · ');
}

/**
 * 설치 점검 — 발송하지 않는다. 속성이 들어갔는지, 트리거가 걸렸는지만 본다.
 * 값은 앞 4자만 찍는다(로그에 키를 남기지 않기 위해).
 */
function zzCheckSetup() {
  var props = PropertiesService.getScriptProperties();
  var need = ['SOLAPI_API_KEY', 'SOLAPI_API_SECRET', 'SOLAPI_SENDER'];
  for (var i = 0; i < need.length; i++) {
    var v = props.getProperty(need[i]);
    Logger.log(need[i] + ' : ' + (v ? v.slice(0, 4) + '… (' + v.length + '자)' : '❌ 없음'));
  }

  var trg = ScriptApp.getProjectTriggers().map(function (t) {
    return t.getHandlerFunction() + ' / ' + t.getEventType();
  });
  Logger.log('트리거 ' + trg.length + '개: ' + trg.join(', '));

  // 응답 시트·신청명단 열 배치가 코드와 맞는지
  var ss = SpreadsheetApp.openById(APP_SHEET_ID);
  var resp = getResponseSheet_(ss);
  var apps = ss.getSheetByName(APPLICATION_TAB);
  Logger.log('응답 시트 ' + C_STATUS + '열 머리글 : ' + resp.getRange(1, C_STATUS).getValue() + ' (기대: 환불처리)');
  Logger.log('응답 시트 ' + C_RESULT + '열 머리글 : ' + resp.getRange(1, C_RESULT).getValue() + ' (기대: 처리결과)');
  Logger.log('신청명단 S열(취소) 머리글 : ' + apps.getRange(1, A_CANCEL + 1).getValue() + ' (기대: 취소)');
}

/** 문자 경로 시험 — **실제로 1통 나간다.** 받는 번호를 확인하고 돌릴 것. */
function zzTestSms() {
  var ok = sendSms_('01028033021',
    '[BNI Korea LT Training]\n취소·환불 알림 경로 시험입니다. 이 문자가 보이면 정상입니다.');
  Logger.log(ok ? '시험 발송 접수됨' : '시험 발송 실패 — 위 로그 확인');
}

/**
 * 트리거 설치 — **한 번만 실행한다.**
 *
 * 이 프로젝트는 스프레드시트에 바인딩돼 있지 않아(standalone) UI 의 `이벤트 소스 = 스프레드시트에서`
 * 를 고를 수 없다. 코드로 대상 스프레드시트를 지정해 설치형 트리거를 만든다.
 *
 * 같은 이름의 트리거가 있으면 지우고 다시 만든다 — 두 번 돌려도 중복되지 않는다.
 */
function setupTriggers() {
  var wanted = ['onRefundEdit', 'onRefundSubmit'];
  var existing = ScriptApp.getProjectTriggers();
  for (var i = 0; i < existing.length; i++) {
    if (wanted.indexOf(existing[i].getHandlerFunction()) !== -1) {
      ScriptApp.deleteTrigger(existing[i]);
    }
  }

  ScriptApp.newTrigger('onRefundEdit').forSpreadsheet(APP_SHEET_ID).onEdit().create();
  ScriptApp.newTrigger('onRefundSubmit').forSpreadsheet(APP_SHEET_ID).onFormSubmit().create();

  var now = ScriptApp.getProjectTriggers().map(function (t) {
    return t.getHandlerFunction() + ' / ' + t.getEventType();
  });
  Logger.log('설치된 트리거 ' + now.length + '개: ' + now.join(', '));
  return now;
}

function onRefundEdit(e) {
  if (!e || !e.range) return;
  var sheet = e.range.getSheet();
  if (!isResponseSheet_(sheet)) return;

  // 편집 범위가 `환불처리`(L) 열을 걸치는지. 여러 칸을 한 번에 바꾸는 경우가 있어 범위로 본다.
  if (C_STATUS < e.range.getColumn() || C_STATUS > e.range.getLastColumn()) return;

  // ⛔ e.value 는 **한 칸을 직접 고쳤을 때만** 들어온다.
  //    붙여넣기 · 아래로 끌어 채우기 · 여러 칸 편집에는 값이 안 실린다.
  //    예전엔 여기서 조용히 빠져나가 처리결과가 통째로 비었다 → 셀에서 직접 읽는다.
  for (var row = Math.max(e.range.getRow(), 2); row <= e.range.getLastRow(); row++) {
    if (String(sheet.getRange(row, C_STATUS).getValue() || '').trim() !== '완료') continue;
    // 이미 처리한 행은 건너뛴다 — 같은 행을 두 번 취소하지 않는다.
    if (String(sheet.getRange(row, C_RESULT).getValue() || '').trim()) continue;

    try {
      processRefund_(row);
    } catch (err) {
      sheet.getRange(row, C_RESULT).setValue('오류: ' + err);
      notifySettlement_('[LTT] 환불 처리 중 오류가 났습니다.\n응답 시트 ' + row + '행\n' + err);
    }
  }
}

/**
 * 트리거가 못 돈 행을 손으로 돌린다.
 * 편집기에서 ROW 를 처리할 응답 시트 행 번호로 바꾸고 실행하면 된다.
 * (처리결과가 이미 차 있으면 아무것도 하지 않는다)
 */
function runRefundForRow() {
  var ROW = 3;

  var sheet = getResponseSheet_(SpreadsheetApp.openById(APP_SHEET_ID));
  if (String(sheet.getRange(ROW, C_RESULT).getValue() || '').trim()) {
    Logger.log(ROW + '행은 이미 처리됐습니다: ' + sheet.getRange(ROW, C_RESULT).getValue());
    return;
  }
  processRefund_(ROW);
  Logger.log(ROW + '행 처리결과: ' + sheet.getRange(ROW, C_RESULT).getValue());
}

function processRefund_(row) {
  var ss = SpreadsheetApp.openById(APP_SHEET_ID);
  var resp = getResponseSheet_(ss);
  var apps = ss.getSheetByName(APPLICATION_TAB);

  var r = resp.getRange(row, 1, 1, C_RESULT).getValues()[0];
  var payer = String(r[C_PAYER - 1] || '').trim();
  var phone = digits_(r[C_PHONE - 1]);
  var subjects = String(r[C_SUBJECTS - 1] || '').split(',').map(trim_).filter(String);
  var attendeeText = String(r[C_ATTENDEES - 1] || '');
  var orderNo = String(r[C_ORDER - 1] || '').trim();

  var data = apps.getDataRange().getValues();
  var matched = [];   // {rowNumber, title, name}

  for (var i = 1; i < data.length; i++) {
    var d = data[i];
    var title = String(d[A_TITLE] || '').trim();
    var name = String(d[A_NAME] || '').trim();
    var rowPhone = digits_(d[A_PHONE]);
    var rowOrder = String(d[A_ORDER] || '').trim();

    if (String(d[A_CANCEL] || '').trim()) continue;          // 이미 취소된 행
    if (String(d[A_PAID] || '').trim() !== '완료') continue;  // 결제 안 된 행은 취소할 것이 없다
    if (subjects.length && subjects.indexOf(title) === -1) continue;

    // 신원 확인 — 셋 중 하나라도 맞아야 한다
    var byOrder = orderNo && rowOrder && rowOrder === orderNo;
    var byPhone = phone && rowPhone && rowPhone === phone;
    var byName = name && attendeeText.indexOf(name) !== -1;
    if (!byOrder && !byPhone && !byName) continue;

    matched.push({ rowNumber: i + 1, title: title, name: name, phone: rowPhone });
  }

  if (!matched.length) {
    resp.getRange(row, C_RESULT).setValue('매칭 실패 — 수동 확인 필요');
    notifySettlement_(
      '[LTT] 환불 처리했으나 신청 행을 찾지 못했습니다.\n' +
      '접수자 ' + payer + ' / ' + subjects.join(', ') + '\n' +
      '대상 ' + attendeeText + '\n신청명단에서 직접 S열(취소)에 시각을 적어주세요.');
    return;
  }

  // 쓰기 직전 머리글 확인. 어긋나면 아무것도 건드리지 않고 멈춘다.
  var hp = headerProblem_(apps);
  if (hp) {
    resp.getRange(row, C_RESULT).setValue('중단 - 신청명단 열 구조가 코드와 다릅니다: ' + hp);
    notifySettlement_(
      '[LTT] 취소 처리를 중단했습니다.\n' +
      '신청명단 열 구조가 스크립트와 다릅니다.\n' + hp + '\n' +
      '열을 되돌리거나 스크립트의 A_* 숫자를 맞춘 뒤 다시 처리해 주세요.');
    return;
  }

  // 취소 표시
  var stamp = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss');
  for (var m = 0; m < matched.length; m++) {
    apps.getRange(matched[m].rowNumber, A_CANCEL + 1).setValue(stamp);
    // 결제완료(J) 열도 같이 바꾼다 — S열만 보면 명단을 눈으로 훑을 때 취소 건이 '완료' 로 보인다.
    // 집계는 전부 S열로 판정하므로(신청 현황 탭 수식 · 서버) 이 값을 바꿔도 숫자는 달라지지 않는다.
    // 결제 사실 자체는 주문번호·결제키·승인일시(L~O)에 그대로 남는다.
    apps.getRange(matched[m].rowNumber, A_PAID + 1).setValue('취소완료');
  }

  var summary = matched.map(function (x) { return x.title + ' - ' + x.name; }).join(' / ');
  resp.getRange(row, C_RESULT).setValue(stamp + ' 취소 ' + matched.length + '건 (' + summary + ')');

  // 신청자 안내
  sendSms_(phone,
    '[BNI Korea LT Training]\n' +
    payer + '님, 요청하신 취소·환불이 처리되었습니다.\n\n' +
    '취소 내역\n' + matched.map(function (x) { return '· ' + x.title + ' - ' + x.name; }).join('\n') + '\n\n' +
    '환불금은 결제 수단에 따라 입금됩니다.\n' +
    '· 신용카드 : 승인 취소 후 카드사 정책에 따라 1~2개월 소요\n' +
    '· 계좌이체 : 환불 승인 후 5~7영업일 내 처리\n\n' +
    '문의 : BNI코리아 내셔널 오피스 02-6261-8838');

  // ── 취소된 수강자 각자에게도 보낸다.
  // 중복이라고 건너뛰지 않는다. 접수자와 수강자가 같은 번호여도 각자 받는다.
  // (결제자가 수강자 명단에 있으면 결제자 안내를 건너뛰던 규칙 때문에 8/22 단체 2건의
  //  결제자가 아무 안내도 못 받았다. 같은 실수를 반복하지 않는다.)
  for (var k = 0; k < matched.length; k++) {
    var mp = matched[k].phone;
    if (!mp) continue;
    var ok = sendSms_(mp,
      '[BNI Korea LT Training]\n' +
      matched[k].name + '님, 신청하신 교육이 취소 처리되었습니다.\n\n' +
      '· ' + matched[k].title + '\n\n' +
      '환불금은 결제 수단에 따라 입금됩니다.\n' +
      '· 신용카드 : 승인 취소 후 카드사 정책에 따라 1~2개월 소요\n' +
      '· 계좌이체 : 환불 승인 후 5~7영업일 내 처리\n\n' +
      '문의 : BNI코리아 내셔널 오피스 02-6261-8838');
    // 발송 시각을 신청명단 '취소 안내 문자 발송' 열에 남긴다.
    apps.getRange(matched[k].rowNumber, A_CANCEL_SMS + 1)
        .setValue(ok === false ? stamp + ' 발송실패' : stamp);
  }

  // 정산 담당자 통보
  notifySettlement_(
    '[LTT] 환불 처리 완료\n' +
    '접수자 ' + payer + ' (' + formatPhone_(phone) + ')\n' +
    (orderNo ? '주문번호 ' + orderNo + '\n' : '') +
    '취소 ' + matched.length + '건\n' + summary);
}

/** 접수되는 즉시(폼 제출) 나가는 안내 — 트리거: 함수 onRefundSubmit · 이벤트 유형 `양식 제출 시` */
function onRefundSubmit(e) {
  try {
    var ss = SpreadsheetApp.openById(APP_SHEET_ID);
    var resp = getResponseSheet_(ss);
    var row = e && e.range ? e.range.getRow() : resp.getLastRow();
    var r = resp.getRange(row, 1, 1, C_AGREE).getValues()[0];

    var payer = String(r[C_PAYER - 1] || '').trim();
    var phone = digits_(r[C_PHONE - 1]);
    var subjects = String(r[C_SUBJECTS - 1] || '').trim();
    var attendees = String(r[C_ATTENDEES - 1] || '').trim();

    sendSms_(phone,
      '[BNI Korea LT Training]\n' +
      payer + '님, 취소·환불 접수가 완료되었습니다.\n\n' +
      '접수 내역\n· 과목 : ' + subjects + '\n· 대상 : ' + attendees + '\n\n' +
      '담당자 확인 후 처리 결과를 안내드립니다.\n' +
      '환불금은 신용카드 승인 취소 후 카드사 정책에 따라 1~2개월, 계좌이체는 승인 후 5~7영업일 내 입금됩니다.\n\n' +
      '문의 : BNI코리아 내셔널 오피스 02-6261-8838');

    notifySettlement_(
      '[LTT] 취소·환불 접수\n' +
      '접수자 ' + payer + ' (' + formatPhone_(phone) + ')\n' +
      '과목 : ' + subjects + '\n대상 : ' + attendees + '\n\n' +
      '응답 시트 ' + row + '행에서 처리 후 환불처리 열에 완료를 입력해 주세요.');
  } catch (err) {
    Logger.log('접수 안내 실패: ' + err);
  }
}

// ──────────────────────────────────────── 도우미

function trim_(s) { return String(s || '').trim(); }
function digits_(s) { return String(s || '').replace(/[^0-9]/g, ''); }

function formatPhone_(p) {
  var d = digits_(p);
  if (d.length === 11) return d.slice(0, 3) + '-' + d.slice(3, 7) + '-' + d.slice(7);
  return d;
}

/**
 * 솔라피 문자. 실패해도 예외를 던지지 않는다 — 문자 때문에 취소 처리가 멈추면 안 된다.
 * ⚠ 키는 서버·다른 자동화와 공용이다. 재발급하면 그쪽이 같이 죽는다.
 */
function sendSms_(to, text) {
  var digits = digits_(to);
  if (!digits) return false;

  var props = PropertiesService.getScriptProperties();
  var apiKey = props.getProperty('SOLAPI_API_KEY');
  var apiSecret = props.getProperty('SOLAPI_API_SECRET');
  var sender = digits_(props.getProperty('SOLAPI_SENDER'));
  if (!apiKey || !apiSecret || !sender) {
    Logger.log('문자 설정이 없어 건너뜁니다 (SOLAPI_* 스크립트 속성)');
    return false;
  }

  try {
    var date = Utilities.formatDate(new Date(), 'UTC', "yyyy-MM-dd'T'HH:mm:ss'Z'");
    var salt = Utilities.getUuid().replace(/-/g, '');
    var raw = Utilities.computeHmacSha256Signature(date + salt, apiSecret);
    var signature = raw.map(function (b) {
      return ('0' + (b < 0 ? b + 256 : b).toString(16)).slice(-2);
    }).join('');

    var res = UrlFetchApp.fetch('https://api.solapi.com/messages/v4/send-many/detail', {
      method: 'post',
      contentType: 'application/json',
      muteHttpExceptions: true,
      headers: {
        Authorization: 'HMAC-SHA256 apiKey=' + apiKey + ', date=' + date +
          ', salt=' + salt + ', signature=' + signature
      },
      payload: JSON.stringify({
        messages: [{ to: digits, from: sender, text: text, type: byteLen_(text) > 90 ? 'LMS' : 'SMS' }],
        allowDuplicates: true   // 같은 번호로 두 통 이상 보낼 때 뒤엣것이 조용히 실패하는 것을 막는다
      })
    });

    if (res.getResponseCode() >= 400) {
      Logger.log('문자 실패 ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 300));
      return false;
    }
    return true;
  } catch (err) {
    Logger.log('문자 오류: ' + err);
    return false;
  }
}

/** SMS/LMS 판정용 길이. 한글은 EUC-KR 기준 2바이트로 센다(UTF-8 로 재면 과대계산). */
function byteLen_(text) {
  var n = 0;
  for (var i = 0; i < text.length; i++) n += text.charCodeAt(i) > 127 ? 2 : 1;
  return n;
}

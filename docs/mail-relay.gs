/**
 * LTT 참여 안내 메일 릴레이 — hq@joy-bnikorea.com Apps Script 웹앱.
 *
 * ltt-bnikorea.com 서버가 결제 승인 직후(그리고 트레이닝 당일 오전 10시) 여기로 POST 하면
 * hq 계정 이름으로 메일을 보낸다.
 *
 * ── 왜 GmailApp 이 아니라 Gmail API 인가 (MTL 발송에서 이미 겪은 것)
 *   1) GmailApp 은 Apps Script 메일 일일 캡에 걸린다
 *      ("Service invoked too many times for one day: email")
 *   2) GmailApp 으로 보낸 메일은 네이버 수신자가 링크를 누를 때 리디렉션 경고가 뜬다
 *   Gmail API(users.messages.send) 경로는 둘 다 없다. 반드시 이 경로만 쓴다.
 *
 * ── 배포
 *   1) script.google.com 에서 hq@joy-bnikorea.com 계정으로 새 프로젝트 (이름: ltt_mail_relay)
 *   2) 이 파일 내용을 Code.gs 에 붙여넣기
 *   3) 서비스 추가(+) → Gmail API 를 식별자 `Gmail` 로 추가 (고급 서비스)
 *   4) 프로젝트 설정 → 스크립트 속성에 `RELAY_SECRET` 을 넣는다 (서버 .env 의 MAIL_RELAY_SECRET 과 같은 값)
 *   5) 배포 → 새 배포 → 웹 앱
 *        - 실행 계정: 나(hq@joy-bnikorea.com)
 *        - 액세스 권한: 모든 사용자          ← 서버가 로그인 없이 POST 해야 한다
 *   6) 나온 /exec URL 을 서버 환경변수 MAIL_RELAY_URL 에 넣는다
 *
 * ⚠ 코드를 고친 뒤에는 반드시 **새 버전으로 배포**해야 반영된다(저장만으로는 안 바뀐다).
 */

var SENDER_NAME = 'BNI Korea LT Training';

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);

    var expected = PropertiesService.getScriptProperties().getProperty('RELAY_SECRET');
    if (!expected || body.secret !== expected) {
      return json({ ok: false, error: 'unauthorized' });
    }

    var messages = body.messages || [];
    if (!messages.length) return json({ ok: true, sent: 0, failed: 0, errors: [] });

    var sent = 0;
    var errors = [];

    for (var i = 0; i < messages.length; i++) {
      var m = messages[i];
      try {
        sendViaGmailApi_(m.to, m.subject, m.html, m.text);
        sent++;
      } catch (err) {
        errors.push({ to: m.to, error: String(err) });
      }
    }

    return json({ ok: true, sent: sent, failed: errors.length, errors: errors });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

/** 연결 확인용. 브라우저로 /exec 를 열면 살아 있는지 보인다. */
function doGet() {
  return json({ ok: true, service: 'ltt_mail_relay' });
}

/**
 * Gmail API 로 발송. MIME 을 직접 조립해 text/html 두 벌을 함께 보낸다.
 * (HTML 을 못 읽는 환경에서도 내용이 보이게)
 */
function sendViaGmailApi_(to, subject, html, text) {
  var boundary = '----ltt' + Utilities.getUuid();
  var from = Session.getActiveUser().getEmail();

  var raw = [
    'From: =?UTF-8?B?' + Utilities.base64Encode(SENDER_NAME, Utilities.Charset.UTF_8) + '?= <' + from + '>',
    'To: ' + to,
    'Subject: =?UTF-8?B?' + Utilities.base64Encode(subject, Utilities.Charset.UTF_8) + '?=',
    'MIME-Version: 1.0',
    'Content-Type: multipart/alternative; boundary="' + boundary + '"',
    '',
    '--' + boundary,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    Utilities.base64Encode(text || '', Utilities.Charset.UTF_8),
    '',
    '--' + boundary,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    Utilities.base64Encode(html || '', Utilities.Charset.UTF_8),
    '',
    '--' + boundary + '--',
    ''
  ].join('\r\n');

  var encoded = Utilities.base64EncodeWebSafe(raw, Utilities.Charset.UTF_8);
  Gmail.Users.Messages.send({ raw: encoded }, 'me');
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** 배포 뒤 여기서 한 번 눌러 본인에게 시험 발송해 본다. */
function zzSelfTest() {
  sendViaGmailApi_(
    Session.getActiveUser().getEmail(),
    '[LTT] 메일 릴레이 시험',
    '<p>릴레이가 살아 있습니다. <a href="https://ltt-bnikorea.com">ltt-bnikorea.com</a></p>',
    '릴레이가 살아 있습니다.'
  );
}

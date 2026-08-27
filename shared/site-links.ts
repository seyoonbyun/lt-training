/**
 * 바깥으로 나가는 링크를 한 곳에 모은다.
 * 화면·이메일·문자가 같은 주소를 쓰도록 하기 위한 것이다.
 */

/**
 * Training Summary 제출처. 이걸 내야 이수로 등록된다.
 * (사이트 공지 카드의 "Summary 제출하고 ... 이수 완료" 버튼과 같은 주소)
 */
export const TRAINING_SUMMARY_URL = "https://apply-bnikorea.com/";

/** 취소·환불 접수 폼이 아직 없을 때 안내할 CS 창구 */
export const CS_KAKAO_URL = "http://pf.kakao.com/_xewxmrT/chat";

/**
 * 만족도 설문(Airtable 폼)의 공개 주소.
 *
 * ⛔ 이 주소를 문자·QR 에 **직접 싣지 않는다.** 아래 `SURVEY_URL` 을 쓴다.
 *    - 문자: 이 주소에 `?prefill_과목=...` 을 붙이면 130자가 넘는다. 링크가 길면
 *      문자 줄바꿈에 잘린다(「결제 이어하기」 링크를 250자로 만들었다가 겪은 일).
 *    - QR: 종이·화면에 박히면 못 바꾼다. 과목마다 다른 주소를 담을 수도 없다.
 *    둘 다 우리 도메인을 거치면 과목은 서버가 그때그때 채운다.
 */
export const SURVEY_FORM_URL = "https://airtable.com/app1K25AF4bAhA24S/shrkqFhTTr7ZFk9Ds";

/** 설문 폼의 `과목` 필드 이름. prefill 파라미터가 이 이름을 그대로 쓴다. */
export const SURVEY_PROGRAM_FIELD = "과목";

/**
 * 사이트가 대신 받아 과목을 채워 넘기는 짧은 주소. 문자·QR 은 이것만 쓴다.
 *
 * ⛔ 여기서 `process.env` 를 읽지 않는다. 이 파일은 **화면(브라우저 번들)도 함께 읽는다** —
 *    Vite 는 `process.env.NODE_ENV` 말고는 치환해 주지 않아서, 브라우저에서
 *    `process is not defined` 로 페이지가 통째로 죽는다. 서버 쪽 주소 덮어쓰기는
 *    `server/services/survey.ts` 가 한다.
 */
export const SURVEY_PATH = "/survey";
export const SURVEY_URL = `https://ltt-bnikorea.com${SURVEY_PATH}`;

/**
 * 설문 폼 주소에 과목을 실어 준다.
 * 과목이 없으면(그날 과목을 못 찾았을 때) 빈 폼으로 보낸다 — 링크를 막지 않는다.
 */
export function surveyFormUrl(programTitle?: string): string {
  const title = String(programTitle || "").trim();
  if (!title) return SURVEY_FORM_URL;
  return `${SURVEY_FORM_URL}?prefill_${encodeURIComponent(SURVEY_PROGRAM_FIELD)}=${encodeURIComponent(title)}`;
}

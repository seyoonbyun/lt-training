/**
 * 발송 기록 시각 — 서식은 여기 한 곳에만 있다.
 *
 * 왜 있나
 *   시각을 적는 코드가 다섯 자리에 흩어져 서식이 네 벌이었다. 서로를 대체한 게
 *   아니라, 시각이 필요할 때마다 그 자리에서 한 줄씩 새로 쓴 결과다(2/27 신청일시 ·
 *   8/22 리마인드 · 8/22 취소처리 · 8/23 결제완료 · 8/23 재결제 체인).
 *   각 서식이 자기 열에만 살아서 아무도 못 느끼다가, 두 주체가 같은 열에 쓴
 *   U·V(결제완료 발송)에서 처음 드러났다 — 60건은 ISO, 1건은 점 서식.
 *
 * 서식
 *   2026. 8. 24. PM 12:47:05   (KST)
 *
 * ⛔ toLocaleString("ko-KR") 을 그대로 쓰지 않는다.
 *   그 결과는 실행 환경의 ICU 로케일 데이터에 달려 있다 — Railway 는 "PM" 을,
 *   로컬 Node 는 "오후" 를 준다. 한 함수가 환경에 따라 두 서식을 만들면 지금 고친
 *   문제가 그대로 되돌아온다. 그래서 en-US 로 조각을 뽑아 손으로 조립한다.
 *
 * ⚠ 월·일·시에 0 패딩이 없다(`8. 24.` · `PM 2:47:05`).
 *   **문자열 정렬로는 시간순이 되지 않는다.** 비교·정렬·경과시간 계산은 반드시
 *   parseStamp() 로 숫자를 만들어서 한다.
 */
export function sendStamp(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric", month: "numeric", day: "numeric",
    hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true,
  }).formatToParts(now);
  const v = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${v("year")}. ${v("month")}. ${v("day")}. ${v("dayPeriod")} ${v("hour")}:${v("minute")}:${v("second")}`;
}

/**
 * 시트에 적힌 시각을 epoch ms 로. 못 읽으면 NaN.
 *
 * ⛔ 옛 서식도 계속 읽어야 한다. 통일 이전에 적힌 값이 시트에 남아 있고,
 *   미결제 12시간 체인(2차 안내 -> 결제거부)이 이 값을 읽어 "몇 시간 지났나"를
 *   판단한다. 여기서 NaN 이 나오면 안내가 안 나가거나 두 번 나간다.
 *
 *   받는 것
 *     2026. 8. 24. PM 12:47:05   현재 서식
 *     2026. 08. 22. PM 05:58:17  신청일시(A열) — 0 패딩
 *     2026-08-23 10:00:08        (구) sendStamp · 백필로 채운 값
 *     2026-08-22 14:22           (구) 메일 발송 기록 — 초 없음
 */
export function parseStamp(v: string): number {
  const s = String(v ?? "").trim();
  if (!s) return NaN;

  const dotted = s.match(
    /^(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.\s*(AM|PM|오전|오후)\s*(\d{1,2}):(\d{2})(?::(\d{2}))?$/
  );
  if (dotted) {
    const [, y, mo, d, ap, hh, mi, sec] = dotted;
    let hour = parseInt(hh, 10);
    const pm = ap === "PM" || ap === "오후";
    if (pm && hour !== 12) hour += 12;
    if (!pm && hour === 12) hour = 0;
    return iso(y, mo, d, String(hour), mi, sec);
  }

  const plain = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (plain) {
    const [, y, mo, d, hh, mi, sec] = plain;
    return iso(y, mo, d, hh, mi, sec);
  }

  return NaN;
}

const p2 = (n: string) => n.padStart(2, "0");
const iso = (y: string, mo: string, d: string, h: string, mi: string, sec?: string) =>
  Date.parse(`${y}-${p2(mo)}-${p2(d)}T${p2(h)}:${mi}:${sec ?? "00"}+09:00`);

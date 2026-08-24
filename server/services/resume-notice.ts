/**
 * 재결제 안내 — 결제를 끝내지 못한 신청을 찾고, 「결제 이어하기」 문자를 만든다.
 *
 * 서버 자동 발송(unpaid-nudge)과 수기 발송 스크립트(scripts/send-resume-links.ts)가
 * **같은 모듈**을 쓴다. 문구와 묶음 기준이 두 곳에 흩어지면 반드시 어긋난다.
 *
 * 신청 행은 결제 **전에** 쓰이므로(routes prepare), 결제창에서 이탈하면 미결제 행이 남는다.
 * 예전에는 그 상태에서 다시 신청하면 자기 행에 걸려 튕겼고, 단체 신청은 명단 15명을
 * 다시 입력해야 했다. 이제는 링크 한 줄로 결제만 이어서 하면 된다.
 */
import { get as getCol, cell, sheetRange } from "./sheet-schema";
import { googleSheetsService, EXPIRED_MARK } from "./google-sheets";
import { createResumeToken } from "./resume-token";
import { sendStamp, parseStamp } from "../../shared/stamp";

const SITE = process.env.PUBLIC_SITE_URL || "https://ltt-bnikorea.com";

/** 본인이 직접 문의를 준 분. 아무 일 없었던 듯한 문면은 무시로 읽힌다. */
const INQUIRED_PHONES = new Set(["01095147961"]); // 권혁성 (2026-08-22)

export interface UnpaidGroup {
  region: string;
  chapter: string;
  /** 신청명단 행 번호 (1-based, 오름차순) */
  rows: number[];
  /** 접수 시각 (시트 A열 원문) */
  submittedAt: string;
  submittedAtMs: number;
  payerName: string;
  payerPhone: string;
  /** 이미 1차(재결제) 안내를 보낸 묶음인가 */
  alreadyNotified: boolean;
  /** 1차 안내 발송 시각(ms). 없거나 못 읽으면 NaN. */
  nudgedAtMs: number;
  /** 2차(미결제) 안내 발송 시각(ms). 없거나 못 읽으면 NaN. */
  finalNoticeAtMs: number;
  /** 행별 원본 (요약 계산에 쓴다) */
  raw: string[][];
}

export interface GroupSummary {
  items: Array<{
    name: string; title: string; participationType: string; price: number;
    /** 시트 B열 원문 (예: "8/27(목)") — 문자에 그대로 쓴다 */
    date: string;
    /** 시작 시각(ms). 임박 안내를 붙일지 판단하는 데만 쓴다 */
    startsAt: number;
  }>;
  amount: number;
  quantity: number;
  memberCount: number;
  /** 마감 등으로 결제할 수 없어 뺀 건 */
  closed: string[];
}

/** 1차(재결제) 안내 발송 시각을 적는 열. 값이 있으면 다시 보내지 않는다. */
export const NUDGE_COL = "재결제 안내" as const;
/** 2차(미결제) 안내 발송 시각을 적는 열. */
export const FINAL_COL = "미결제 안내 문자 발송" as const;
const SHEET_NAME = "2026 LTT 신청명단";

/** "2026. 08. 22. PM 05:58:17" -> epoch ms. 못 읽으면 NaN. */
export function parseSubmittedAt(v: string): number {
  const m = String(v || "").match(
    /(\d{4})\.\s*(\d{2})\.\s*(\d{2})\.\s*(AM|PM)\s*(\d{2}):(\d{2}):(\d{2})/
  );
  if (!m) return NaN;
  let hour = parseInt(m[5], 10);
  if (m[4] === "PM" && hour !== 12) hour += 12;
  if (m[4] === "AM" && hour === 12) hour = 0;
  return new Date(
    `${m[1]}-${m[2]}-${m[3]}T${String(hour).padStart(2, "0")}:${m[6]}:${m[7]}+09:00`
  ).getTime();
}

/**
 * 미결제 묶음을 찾는다.
 *
 * 묶음 = 같은 지역/챕터 + **연속된 행** + 앞 행과의 접수 간격 3초 이내.
 * 단체 신청은 한 번에 들어와 행이 1초 안팎으로 붙고, 서로 다른 사람이 각자 신청한 건은
 * 최소 수 초씩 벌어진다.
 *
 * ⛔ 분 단위로 묶으면 안 된다 — 같은 챕터의 두 사람이 10초 차이로 신청한 것을 한 건으로
 *    합쳐, 한 분이 남의 신청까지 결제하고 그 내역까지 보게 된다
 *    (2026-08-22 권혁성/피경화 건에서 실제로 그렇게 묶였다).
 */
export async function findUnpaidGroups(): Promise<UnpaidGroup[]> {
  const rows = await googleSheetsService.readApplicationRows(sheetRange(SHEET_NAME));
  const groups: UnpaidGroup[] = [];
  let current: UnpaidGroup | null = null;
  let lastAt = NaN;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const paid = String(row[9] || "").trim();
    const cancelled = getCol(row, "취소");
    // 만료 처리한 행은 다시 안내하지 않는다. 2차 안내까지 나간 뒤 정리한 행이다
    // (그래도 결제는 막히지 않는다 — 링크로 결제하시면 그대로 확정된다).
    if (paid === "완료" || paid === "결제완료" || paid === EXPIRED_MARK || cancelled) {
      current = null; // 결제/취소/만료된 행을 만나면 묶음을 끊는다
      continue;
    }

    const at = parseSubmittedAt(String(row[0] || ""));
    const region = String(row[2] || "").trim();
    const chapter = String(row[3] || "").trim();

    const continues =
      current !== null &&
      current.region === region &&
      current.chapter === chapter &&
      Number.isFinite(at) &&
      Number.isFinite(lastAt) &&
      at - lastAt <= 3000;

    if (!continues) {
      current = {
        region,
        chapter,
        rows: [],
        submittedAt: String(row[0] || ""),
        submittedAtMs: at,
        payerName: String(row[4] || "").trim(),
        payerPhone: String(row[5] || "").replace(/\D/g, ""),
        alreadyNotified: false,
        nudgedAtMs: NaN,
        finalNoticeAtMs: NaN,
        raw: [],
      };
      groups.push(current);
    }

    current!.rows.push(i + 1);
    current!.raw.push(row);
    // 묶음 안에서 가장 이른 발송 시각을 쓴다 - 묶음은 한 번에 보내므로 모두 같아야 하지만,
    // 하나라도 못 찍힌 경우가 있어 있는 값 중 가장 이른 것으로 판단한다.
    const nAt = parseStamp(getCol(row, NUDGE_COL));
    if (Number.isFinite(nAt)) current!.nudgedAtMs = Number.isFinite(current!.nudgedAtMs) ? Math.min(current!.nudgedAtMs, nAt) : nAt;
    const fAt = parseStamp(getCol(row, FINAL_COL));
    if (Number.isFinite(fAt)) current!.finalNoticeAtMs = Number.isFinite(current!.finalNoticeAtMs) ? Math.min(current!.finalNoticeAtMs, fAt) : fAt;
    // 묶음 안에 한 행이라도 안내 기록이 있으면 그 묶음은 이미 보낸 것으로 본다.
    if (getCol(row, NUDGE_COL)) current!.alreadyNotified = true;
    lastAt = at;
  }

  return groups;
}

export function buildResumeLink(rows: number[]): string {
  return `${SITE}/pay/${createResumeToken(rows)}`;
}

/** 묶음의 금액·인원을 시트 단가(L열)로 계산한다. 금액은 어디서도 클라이언트를 믿지 않는다. */
export async function summarizeGroup(group: UnpaidGroup): Promise<GroupSummary> {
  const programs = (await googleSheetsService.getSecondarySheetPrograms()) as any[];
  const items: GroupSummary["items"] = [];
  const closed: string[] = [];

  for (const row of group.raw) {
    const title = String(row[1] || "").trim();
    const name = String(row[4] || "").trim();
    const program = programs.find((p) => p.title === title);
    if (!program || !program.isAvailable || !program.price || program.price <= 0) {
      closed.push(`${name}(${shortTitle(title)})`);
      continue;
    }
    items.push({
      name,
      title,
      participationType: String(row[7] || "").trim(),
      price: program.price,
      date: String(program.date || "").trim(),
      startsAt: Date.parse(program.formattedDate || ""),
    });
  }

  return {
    items,
    amount: items.reduce((sum, i) => sum + i.price, 0),
    quantity: items.length,
    memberCount: new Set(items.map((i) => i.name)).size,
    closed,
  };
}

export const shortTitle = (t: string) => String(t || "").replace(/^LTT\s*:\s*/, "");
const won = (n: number) => n.toLocaleString("ko-KR");

/** 며칠 안에 첫 과목이 있으면 그 사실을 덧붙인다. 날짜를 계산하므로 언제 보내도 맞는다. */
const URGENT_WITHIN_DAYS = 7;
function urgencyLine(s: GroupSummary, now: Date): string {
  const upcoming = s.items
    .filter((i) => Number.isFinite(i.startsAt) && i.startsAt > now.getTime())
    .sort((a, b) => a.startsAt - b.startsAt)[0];
  if (!upcoming) return "";

  const days = (upcoming.startsAt - now.getTime()) / 86400000;
  if (days > URGENT_WITHIN_DAYS) return "";
  return `
첫 과목인 '${shortTitle(upcoming.title)}'가 ${upcoming.date}로 임박하여 함께 안내드립니다.`;
}

/**
 * 재결제 안내 문자 본문.
 *
 * ⭐ 문면에 원인(시스템 오류 등)을 적지 않는다 — 운영 방침.
 *    결제가 완료되지 않았다는 사실과 이어서 결제하는 방법만 안내한다.
 */
export function composeResumeSms(
  group: UnpaidGroup,
  s: GroupSummary,
  link: string,
  now = new Date()
): string {
  const bulk = s.memberCount > 1;
  const when = submittedDateLabel(group.submittedAtMs);
  const urgent = urgencyLine(s, now);

  if (!bulk) {
    const item = s.items[0];
    const opening = INQUIRED_PHONES.has(group.payerPhone)
      ? `문의 주신 내용 확인했습니다. 번거롭게 해 드려 죄송합니다.\n\n${when} 신청하신 '${shortTitle(item.title)}'는 결제가 완료되지 않은 상태이며, 신청 내역은 그대로 남아 있습니다.`
      : `${when} 신청하신 '${shortTitle(item.title)}'의 결제가 완료되지 않은 것으로 확인되어 안내드립니다. 신청 내역은 그대로 남아 있습니다.`;

    return `[BNI Korea] LT 트레이닝 결제 안내

${group.payerName} 대표님, 안녕하세요.
BNI 코리아 내셔널 오피스입니다.

${opening}

아래 링크를 누르시면 신청하신 내역이 그대로 나오고, 버튼 한 번으로 결제하실 수 있습니다. 다시 입력하실 내용은 없습니다.

▶ ${link}

과목 : ${shortTitle(item.title)}
참여 : ${item.participationType}
금액 : ${won(s.amount)}원

참여 방식 변경도 링크에서 하실 수 있습니다.${urgent}
문의 : 02-6261-8838`;
  }

  return `[BNI Korea] LT 트레이닝 단체 신청 결제 안내

${group.payerName} 대표님, 안녕하세요.
BNI 코리아 내셔널 오피스입니다.

${when} ${group.chapter} 챕터에서 단체로 신청해 주신 ${s.memberCount}명 / ${s.quantity}건의 결제가 완료되지 않은 것으로 확인되어 안내드립니다. 신청 명단은 그대로 남아 있습니다.

아래 링크를 누르시면 신청하신 명단이 그대로 나오고, 버튼 한 번으로 결제하실 수 있습니다. 명단을 다시 입력하실 필요는 없습니다.

▶ ${link}

인원 : ${s.memberCount}명 / ${s.quantity}건
금액 : ${won(s.amount)}원

일부만 결제하시거나 참여 방식을 바꾸시는 것도 링크에서 하실 수 있습니다.
결제를 다른 분이 하신다면 이 링크를 그대로 전달해 주시면 됩니다.
${urgent}
문의 : 02-6261-8838`;
}

/** "8/22" 처럼 짧게. 접수 시각을 못 읽으면 날짜 언급을 뺀다. */
function submittedDateLabel(ms: number): string {
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
  }).formatToParts(d);
  const get = (t: string) => String(parts.find((p) => p.type === t)?.value || "");
  // en-CA 는 "08-22" 처럼 0을 붙여 준다. 시트의 과목 날짜 표기(8/27)와 맞춘다.
  return `${Number(get("month"))}/${Number(get("day"))}`;
}

/**
 * 검수용 사본을 받는 번호. 실제 발송과 **같은 본문**을 한 통 더 받는다.
 * 끄려면 SMS_COPY_TO=off.
 *
 * ⚠ 사본에도 진짜 결제 링크가 들어 있다. 사본에서 결제 버튼을 누르면 실제로 청구된다.
 */
const DEFAULT_COPY_TO = "01028033021";

export function adminCopyPhone(): string | null {
  const raw = (process.env.SMS_COPY_TO ?? DEFAULT_COPY_TO).trim();
  if (!raw || raw.toLowerCase() === "off") return null;
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 9 ? digits : null;
}

/**
 * 보낼 문자마다 검수용 사본을 하나씩 만든다.
 * 누구에게 간 문자인지 첫 줄에 적어 둔다 — 사본만 보고는 알 수 없다.
 */
export function buildAdminCopies(
  messages: Array<{ to: string; text: string; label?: string }>
): Array<{ to: string; text: string; label: string }> {
  const copyTo = adminCopyPhone();
  if (!copyTo || messages.length === 0) return [];

  return messages
    // 사본을 또 복사하지 않는다.
    .filter((m) => m.to.replace(/\D/g, "") !== copyTo)
    .map((m) => ({
      to: copyTo,
      text: `[검수용 사본] ${m.label || ""} ${m.to}\n\n${m.text}`,
      label: `검수사본(${m.label || m.to})`,
    }));
}

/**
 * 발송 표시로 적는 값 = **발송 시각**.
 *
 * ⛔ 예전에는 "문자발송완" 이라는 글자만 적었다. 값이 있으면 다시 안 보낸다는 목적에는
 *   맞았지만, **언제 보냈는지를 모르니 "n시간 뒤"를 계산할 수 없었다.**
 *   2차 안내(12시간 뒤)·결제거부 표기(다시 12시간 뒤)가 이 시각을 읽는다.
 *
 * 서식은 shared/stamp 한 곳에만 있다. 여기서 다시 만들지 않는다.
 */
export { sendStamp, parseStamp } from "../../shared/stamp";

/** (구) 값. 시각 없이 이 글자만 있는 행이 남아 있다 - 그 묶음은 시각을 알 수 없다. */
export const NUDGE_MARK = "문자발송완";

/**
 * 안내를 보낸 묶음의 모든 행에 발송 표시를 남긴다. 재발송을 막는 유일한 장치다.
 * 묶음 단위로 보내므로 그 묶음의 **모든 행**에 찍어야 한다 — 한 행만 찍으면
 * 다음 실행에서 나머지 행이 새 묶음으로 잡혀 같은 사람에게 또 나간다.
 */
export async function stampNudged(rows: number[], now = new Date()): Promise<void> {
  const stamp = sendStamp(now);
  await googleSheetsService.writeApplicationCells(
    rows.map((row) => ({ range: cell(SHEET_NAME, row, NUDGE_COL), values: [[stamp]] }))
  );
}

/** 2차(미결제) 안내 발송 시각을 묶음의 모든 행에 남긴다. */
export async function stampFinalNotice(rows: number[], now = new Date()): Promise<void> {
  const stamp = sendStamp(now);
  await googleSheetsService.writeApplicationCells(
    rows.map((row) => ({ range: cell(SHEET_NAME, row, FINAL_COL), values: [[stamp]] }))
  );
}

/**
 * 묶음의 모든 행을 신청현황 열에 '결제거부'로 표시한다.
 *
 * ⛔ 이 표시는 **집계에서 빼기 위한 것**이지 잠금이 아니다. 이 행은 여전히
 *   결제 가능(isRowPayable) 상태이고, 2차 안내 문자의 링크로 결제하시면 '완료'로 바뀐다.
 * ⛔ 묶음의 **모든 행**에 찍어야 한다. 한 행만 남기면 다음 실행에서 그 행이 새 묶음으로
 *   잡혀 같은 분에게 안내가 또 나간다 (V열 표시와 같은 함정).
 */
export async function markExpired(rows: number[]): Promise<void> {
  await googleSheetsService.writeApplicationCells(
    rows.map((row) => ({
      range: cell(SHEET_NAME, row, '신청현황'),
      values: [[EXPIRED_MARK]],
    }))
  );
}

/**
 * 2차(마지막) 안내 문자.
 *
 * ⭐ 정리한다는 사실을 알리되, **결제 경로가 닫히지 않는다**는 것을 분명히 적는다.
 *   "만료됐다"만 읽고 포기하시면 안 된다.
 */
export function composeFinalNoticeSms(
  group: UnpaidGroup,
  s: GroupSummary,
  link: string,
  now = new Date()
): string {
  const bulk = s.memberCount > 1;
  const when = submittedDateLabel(group.submittedAtMs);
  const urgent = urgencyLine(s, now);
  const what = bulk
    ? `${group.chapter} 챕터 단체 신청 ${s.memberCount}명 / ${s.quantity}건`
    : `'${shortTitle(s.items[0].title)}'`;

  return `[BNI Korea] LT 트레이닝 결제 안내 (재안내)

${group.payerName} 대표님, 안녕하세요.
BNI 코리아 내셔널 오피스입니다.

${when} 신청하신 ${what}의 결제가 아직 완료되지 않았습니다.

신청 내역은 그대로 남아 있으며, 아래 링크에서 지금도 결제하실 수 있습니다. 다시 입력하실 내용은 없습니다.

▶ ${link}

금액 : ${won(s.amount)}원

결제가 확인되지 않은 건은 신청 현황 집계에서 제외되나, 링크로 결제하시면 그대로 확정됩니다.${urgent}
문의 : 02-6261-8838`;
}

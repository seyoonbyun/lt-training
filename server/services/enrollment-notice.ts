/**
 * 결제 완료 안내의 **내용**을 한 곳에서 만든다.
 *
 * 문자와 이메일이 같은 내용이어야 한다는 요구라, 본문을 각각 짜면 반드시 어긋난다.
 * 여기서 구조(블록)만 만들고, 문자는 `enrollment-sms`, 이메일은 `enrollment-email` 이
 * 각자의 형식으로 그린다.
 *
 * 링크는 **온라인 강의실(세션등록 I열, 노션)** 하나로 통일한다.
 * 그 페이지가 실시간 입장과 이후 녹화본을 함께 담는 단일 진입점이고,
 * CS팀이 강의 뒤 녹화본 링크를 같은 페이지에 걸어 둔다. (J열 줌링크는 쓰지 않는다)
 *   실시간 참여 · 온라인 과목  → 온라인 강의실 (I열) + VOD 열람비번(M열, 있으면)
 *   실시간 참여 · 오프라인 과목 → 온라인이 아니다. 현장 장소를 안내한다 (H열)
 *   녹화본(VOD)               → 온라인 강의실 (I열) + VOD 열람비번(M열, 있으면)
 */

/** 신청 행 하나 = 수강자 한 명의 과목 하나 */
export interface SmsRecipient {
  name: string;
  phone: string;
  programTitle: string;
  /** 'live' = 실시간 참여, 'recorded' = 녹화본(VOD) */
  trainingType: string;
  /** 이메일 발송 대상. 없으면 문자만 나간다 */
  email?: string;
  /**
   * 주문번호. 취소·환불 접수 폼이 "결제 완료 문자·이메일에 적힌 번호"라고 안내하므로
   * 문자·이메일 양쪽에 반드시 실려야 한다. 담당자가 이 번호로 신청 행을 찾는다.
   */
  orderId?: string;
  /**
   * 이 수강자의 신청명단 행 번호. 발송 결과를 그 행에 적기 위해 들고 다닌다.
   * 없으면 발송은 하되 기록만 못 남긴다(리마인드처럼 시트에서 읽어 만든 경우).
   */
  sheetRow?: number;
}

/** 한 통에 묶인 신청들의 주문번호. 중복은 없애고 순서는 유지한다. */
export function collectOrderIds(list: SmsRecipient[]): string[] {
  const seen: string[] = [];
  for (const r of list) {
    const id = String(r.orderId || "").trim();
    if (id && !seen.includes(id)) seen.push(id);
  }
  return seen;
}

/** 세션등록 시트에서 읽어 온 과목 정보 중 안내에 필요한 부분만 */
export interface ProgramInfo {
  title: string;
  date?: string;
  time?: string;
  format?: string;
  /** J열 줌링크. 지금은 안내에 쓰지 않는다(강의실 링크로 통일). 시트에는 남아 있어 함께 읽어만 둔다 */
  zoomUrl?: string;
  classroomUrl?: string;
  venueText?: string;
  classroomPw?: string;
}

/** 안내 한 줄. url 이 있으면 이메일에서 링크로 그린다. */
export interface NoticeRow {
  label: string;
  value: string;
  url?: string;
  /** 이메일에서 이 줄은 표 대신 버튼으로 그린다(문자는 그대로 URL 을 싣는다) */
  isCta?: boolean;
}

/** 과목 한 건의 안내 블록 */
export interface NoticeBlock {
  title: string;
  rows: NoticeRow[];
  /** ※ 로 시작하는 부가 안내 */
  notes: string[];
  /** 이메일 본문의 주 버튼. 링크가 있을 때만 생긴다 */
  cta?: { label: string; url: string };
}

export const CONTACT_NAME = "BNI코리아 내셔널 오피스";
export const CONTACT_TEL = "02-6261-8838";
export const BRAND = "BNI Korea LT Training";

function isOffline(p?: ProgramInfo): boolean {
  return (p?.format || "") === "오프라인";
}

/** H열은 '표기 + URL' 이 한 칸에 들어 있다. 표기와 URL 을 갈라 낸다. */
function splitVenue(p?: ProgramInfo): { text: string; url?: string } {
  const raw = String(p?.venueText || "").trim().replace(/\s+/g, " ");
  if (!raw) return { text: "장소는 별도 안내드립니다" };
  const m = raw.match(/https?:\/\/\S+/i);
  if (!m) return { text: raw };
  const text = raw.replace(m[0], "").trim().replace(/[:·\-\s]+$/, "").trim();
  return { text: text || m[0], url: m[0] };
}

export function buildBlock(title: string, trainingType: string, program?: ProgramInfo): NoticeBlock {
  const rows: NoticeRow[] = [];
  const notes: string[] = [];

  const when = [program?.date, program?.time].filter(Boolean).join(" ").trim();
  if (when) rows.push({ label: "일시", value: when });

  if (trainingType === "recorded") {
    rows.push({ label: "참여", value: "녹화본(VOD)" });
    const url = String(program?.classroomUrl || "").trim();
    let cta: { label: string; url: string } | undefined;
    if (url) {
      rows.push({ label: "강의실", value: url, url, isCta: true });
      cta = { label: "온라인 강의실 입장", url };
      const pw = String(program?.classroomPw || "").trim();
      if (pw) rows.push({ label: "VOD 열람비번", value: pw });
    } else {
      rows.push({ label: "강의실", value: "링크는 별도 안내드립니다" });
    }
    // 업로드 시각은 사이트 안내와 같은 기준으로만 적는다(온라인 익일 13시 / 오프라인 익일 15시).
    notes.push(isOffline(program) ? "강의 익일 오후 3시부터 시청 가능" : "강의 익일 오후 1시부터 시청 가능");
    notes.push("Training Summary 제출 시 이수 처리됩니다");
    return { title, rows, notes, cta };
  }

  // 실시간 참여
  if (isOffline(program)) {
    rows.push({ label: "참여", value: "오프라인 현장" });
    const venue = splitVenue(program);
    rows.push({ label: "장소", value: venue.text, url: venue.url });
    return {
      title,
      rows,
      notes,
      cta: venue.url ? { label: "장소 보기", url: venue.url } : undefined,
    };
  }

  rows.push({ label: "참여", value: "실시간 LIVE" });
  const liveUrl = String(program?.classroomUrl || "").trim();
  if (liveUrl) {
    rows.push({ label: "강의실", value: liveUrl, url: liveUrl, isCta: true });
    const pw = String(program?.classroomPw || "").trim();
    if (pw) rows.push({ label: "VOD 열람비번", value: pw });
    notes.push("강의 종료 후 같은 강의실에 녹화본이 올라갑니다");
    return { title, rows, notes, cta: { label: "온라인 강의실 입장", url: liveUrl } };
  }
  // I열이 비어 있는 과목. 링크를 지어내지 않고 사실대로 알린다.
  rows.push({ label: "강의실", value: "링크는 별도 안내드립니다" });
  return { title, rows, notes };
}

/** 연락처(휴대폰) 기준으로 같은 사람의 신청을 묶는다. 한 사람에게 한 통만 가게 한다. */
export function groupByPhone(recipients: SmsRecipient[]): {
  groups: Array<{ phone: string; list: SmsRecipient[] }>;
  noPhone: string[];
} {
  const byPhone = new Map<string, SmsRecipient[]>();
  const noPhone: string[] = [];
  for (const r of recipients) {
    const key = String(r.phone || "").replace(/\D/g, "");
    if (!key) {
      noPhone.push(r.name || "(이름 없음)");
      continue;
    }
    const list = byPhone.get(key) || [];
    list.push(r);
    byPhone.set(key, list);
  }
  return {
    groups: Array.from(byPhone, ([phone, list]) => ({ phone, list })),
    noPhone,
  };
}

/** 이메일 주소 기준으로 묶는다. 주소가 없는 사람은 빠진다. */
export function groupByEmail(recipients: SmsRecipient[]): {
  groups: Array<{ email: string; list: SmsRecipient[] }>;
  noEmail: string[];
} {
  const byEmail = new Map<string, SmsRecipient[]>();
  const noEmail: string[] = [];
  for (const r of recipients) {
    const key = String(r.email || "").trim().toLowerCase();
    if (!key || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(key)) {
      noEmail.push(r.name || "(이름 없음)");
      continue;
    }
    const list = byEmail.get(key) || [];
    list.push(r);
    byEmail.set(key, list);
  }
  return {
    groups: Array.from(byEmail, ([email, list]) => ({ email, list })),
    noEmail,
  };
}

/** 결제자용 — 과목 + 참여방식 조합마다 한 블록. 같은 조합이면 링크가 하나다. */
export function groupByProgram(recipients: SmsRecipient[]): Array<{
  title: string;
  trainingType: string;
  names: string[];
}> {
  const seen = new Map<string, SmsRecipient[]>();
  for (const r of recipients) {
    const key = `${r.programTitle}|${r.trainingType}`;
    const list = seen.get(key) || [];
    list.push(r);
    seen.set(key, list);
  }
  return Array.from(seen, ([key, list]) => {
    const [title, trainingType] = key.split("|");
    return { title, trainingType, names: list.map((r) => r.name || "(이름 없음)") };
  });
}

/** 수강자 몇 명인지 — 연락처(없으면 이름)로 센다 */
export function countPeople(recipients: SmsRecipient[]): number {
  return new Set(
    recipients.map((r) => String(r.phone || "").replace(/\D/g, "") || String(r.name || "").trim())
  ).size;
}

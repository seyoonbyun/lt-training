/**
 * 지원 대상 명단 — 교육비를 회사/지역이 대신 내주는 분들.
 *
 * 신청명단 파일의 `지원 대상` 탭에 적힌 분은 결제 금액이 0원이 된다.
 * 0원은 **토스로 승인할 수 없다**(카드 최소 결제 금액 100원). 그래서 결제창을 띄우지 않고
 * 서버가 자체 승인한다. 승인 뒤 흐름(J열 완료·문자·이메일·리마인드·취소접수)은
 * 유료 결제와 **완전히 같은 경로**를 탄다 — 갈래를 늘리면 그 중 하나가 조용히 빠진다.
 *
 * 판정 기준
 *   **연락처 하나로 판정한다**(2026-08-25). 명단에 번호가 있으면 어느 지역·챕터에서
 *   어느 과목을 고르든 지원이 붙는다.
 *   ⛔ 지역·챕터는 **거부권을 갖지 않는다.** 한때는 셋이 다 맞아야 했는데(2026-08-24),
 *      담당자가 적는 표기와 신청 폼의 값이 원래 다르다 — `ADMIN`(폼에 없는 값)·
 *      `부산`(폼은 `부산1`)·`파이오니아`(폼은 `파이어니어`)·`션샤인`(폼은 `선샤인`).
 *      실제 명단 97줄 중 21줄이 이 한 글자 차이로 조용히 정가 결제될 상태였다.
 *      약한 신호에 거부권을 주지 않는다 — **순위(어느 줄을 쓸지)에만** 쓴다.
 *   ⭐ 이름도 대조하지 않는다. 오타 한 글자로 지원이 안 먹으면 그분이 돈을 내버리고,
 *      되돌리려면 토스 상점관리자에서 사람이 카드 취소까지 해야 한다. 다르면 로그로만 남긴다.
 *   ⭐ 지원 과목 칸을 **비워 두면 전 과목**이다(지금 명단은 97줄 전부 비어 있다).
 *      적어 두면 그 과목만 지원한다 — 담당자가 일부러 좁힌 것이므로 그건 지킨다.
 *      여러 줄이 맞으면 **더 구체적인 줄**을 쓴다.
 *
 * ⛔ 명단을 못 읽었을 때 결제를 막지 않는다.
 *   막으면 지원 대상이 아닌 분들까지 전부 신청을 못 한다. 대신 **직전에 성공한 명단**을
 *   그대로 쓰고(캐시), 관리자에게 경보를 보낸다. 캐시조차 없으면 빈 명단으로 진행한다
 *   (= 그날 지원 대상자가 정가로 결제하게 되는데, 전면 중단보다는 낫고 환불 경로가 있다).
 */
import { getServiceAccountAccessToken } from "./google-sheets";
import { alertAdmin } from "./admin-alert";

export const SPONSOR_TAB = "지원 대상";

/** 탭 1행 헤더. 순서가 곧 열 순서다 (A~G). */
export const SPONSOR_COLUMNS = [
  "지역", "챕터", "멤버명", "연락처", "지원 과목", "지원 금액(원)", "비고",
] as const;

/** 2026-08-24 이전 열 구성. 남아 있으면 새 구성으로 옮긴다 (`build-sponsor-tab.ts`). */
export const SPONSOR_COLUMNS_V1 = ["멤버명", "연락처", "지원 과목", "지원 금액(원)", "비고"] as const;

export interface SponsorEntry {
  /** 지역. 판정에서 거부권이 없다 — 여러 줄이 맞을 때 순위에만 쓴다. */
  region: string;
  /** 챕터. 지역과 마찬가지로 순위에만 쓴다. */
  chapter: string;
  /** 시트에 적힌 이름. 대조에는 쓰지 않고 로그·경보에만 쓴다. */
  name: string;
  /** 숫자만 남긴 연락처. 판정의 축. */
  phone: string;
  /** 지원 과목. 비어 있으면 전 과목. */
  programs: string[];
  /** 지원 금액. null 이면 전액. */
  supportAmount: number | null;
  note: string;
  /** 시트 행 번호 (로그용) */
  row: number;
}

export interface SponsorApplied {
  /** 실제로 청구할 금액 */
  price: number;
  /** 원래 금액 */
  listPrice: number;
  /** 깎인 금액 */
  discount: number;
  sponsor?: SponsorEntry;
}

/**
 * 연락처에서 숫자만 남긴다. `+82 10 …` 도 `010…` 으로 맞춘다.
 *
 * ⛔ 엑셀·시트에서 붙여넣으면 `01028033021` 이 숫자로 읽혀 **앞자리 0 이 날아간다.**
 *    `10`·`11`(011 등)로 시작하는 10자리는 0 이 떨어진 것으로 보고 되살린다.
 *    안 그러면 명단과 신청서가 한 글자 차이로 안 맞아 지원이 조용히 빠진다.
 */
export function normalizePhone(value: string): string {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("82") && digits.length >= 11) digits = "0" + digits.slice(2);
  if (digits.length === 10 && /^1[0169]/.test(digits)) digits = "0" + digits;
  return digits;
}

/**
 * 과목명 비교용 정규화.
 *
 * 담당자는 `LTT : 파운데이션 T.` 를 그냥 `파운데이션` 이라고 적는다(실제로 그랬다).
 * 앞의 `LTT :` 와 뒤의 `T.` 를 둘 다 떼야 같은 과목으로 본다 — 안 그러면
 * **지원이 조용히 안 붙고 그분이 정가를 결제한다.**
 *
 * ⛔ 뒤의 `T` 는 **점이 있거나 앞에 공백이 있을 때만** 뗀다.
 *    그냥 `/T$/` 로 떼면 `ST` 가 `S` 가 되어 ST T. 과목이 영영 안 맞는다.
 */
export function normalizeTitle(value: string): string {
  return String(value || "")
    .replace(/^LTT\s*[:：]\s*/i, "")
    .replace(/(\s+T\.?|T\.)\s*$/i, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

/** 지역·챕터 비교용. 공백을 털고 소문자로 맞춘다. */
export function normalizeLabel(value: string): string {
  return String(value || "").replace(/\s+/g, "").toLowerCase();
}

/** `120,000` `120000원` 모두 받는다. 빈 값·0 이하·숫자가 아니면 null(=전액 지원). */
function parseSupportAmount(value: string): number | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const n = Number(raw.replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

/**
 * 신청명단 I열(`특이사항 & 문의`)에 남기는 표기.
 * 지원 대상자가 신청하면 담당자가 한눈에 알아보게 이 문구를 붙인다.
 */
export const SPONSOR_NOTE = "교육비 지원";

/**
 * 신청자가 쓴 특이사항을 지우지 않고 표기만 앞에 붙인다.
 * 이미 붙어 있으면 그대로 둔다 (이어하기·재결제로 두 번 지나갈 수 있다).
 */
export function withSponsorNote(notes: string): string {
  const current = String(notes || "").trim();
  if (!current) return SPONSOR_NOTE;
  if (current.includes(SPONSOR_NOTE)) return current;
  return `${SPONSOR_NOTE} / ${current}`;
}

// ── 명단 읽기 ────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 60 * 1000;
let cache: { entries: SponsorEntry[]; at: number } | null = null;
/** 같은 실패로 경보가 쏟아지지 않게 한 번만 보낸다. 성공하면 다시 풀린다. */
let alerted = false;

async function fetchSponsorRows(): Promise<string[][]> {
  const id = process.env.GOOGLE_SPREADSHEET_ID || "";
  if (!id) throw new Error("GOOGLE_SPREADSHEET_ID 가 없습니다.");

  // ⚠ 개인정보(이름·연락처)라 공개 API 키가 아니라 서비스 계정으로 읽는다.
  const token = await getServiceAccountAccessToken("https://www.googleapis.com/auth/spreadsheets.readonly");
  // ⛔ 범위는 열 수에서 계산한다. 열이 늘었는데 여기가 그대로면 뒤쪽 열이 조용히 잘리고
  //    (지원 금액이 안 읽혀 전원 전액 지원이 된다) 헤더 검증에서야 터진다.
  const lastCol = String.fromCharCode(64 + SPONSOR_COLUMNS.length);
  const range = encodeURIComponent(`'${SPONSOR_TAB}'!A1:${lastCol}1000`);
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${range}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${text.slice(0, 200)}`);
  }
  const data: any = await res.json();
  return (data.values || []) as string[][];
}

/** 시트에서 읽은 원시 행 -> 명단. 헤더 검증 포함 (검증 스크립트가 직접 부른다). */
export function parseSponsorRows(rows: string[][]): SponsorEntry[] {
  if (rows.length === 0) return [];

  // 헤더가 기대와 다르면 열이 밀린 것이다. 추측해서 진행하지 않는다.
  const header = (rows[0] || []).map((v) => String(v || "").trim());
  for (let i = 0; i < SPONSOR_COLUMNS.length; i++) {
    if (header[i] !== SPONSOR_COLUMNS[i]) {
      throw new Error(
        `'${SPONSOR_TAB}' 탭 헤더가 다릅니다. ${i + 1}번째 열이 "${header[i] || ""}" 인데 "${SPONSOR_COLUMNS[i]}" 여야 합니다.`
      );
    }
  }

  const entries: SponsorEntry[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const phone = normalizePhone(row[3] || "");
    if (phone.length < 10) continue;   // 빈 줄·잘못 적은 줄은 조용히 넘긴다

    entries.push({
      region: String(row[0] || "").trim(),
      chapter: String(row[1] || "").trim(),
      name: String(row[2] || "").trim(),
      phone,
      programs: String(row[4] || "")
        .split(/[,;\n]/)
        .map((t) => t.trim())
        .filter(Boolean),
      supportAmount: parseSupportAmount(row[5] || ""),
      note: String(row[6] || "").trim(),
      row: r + 1,
    });
  }
  return entries;
}

/** 지원 대상 명단. 60초 캐시 + 실패 시 직전 성공본으로 버틴다. */
export async function loadSponsorList(): Promise<SponsorEntry[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.entries;

  try {
    const entries = parseSponsorRows(await fetchSponsorRows());
    cache = { entries, at: Date.now() };
    alerted = false;
    return entries;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`⚠ 지원 대상 명단을 읽지 못했습니다: ${message}`);

    if (!alerted) {
      alerted = true;
      // 경보가 실패해도 결제를 막지 않는다.
      alertAdmin(
        "지원 대상 명단을 읽지 못했습니다",
        `신청명단 파일의 '${SPONSOR_TAB}' 탭을 읽지 못했습니다.\n` +
          `${cache ? "직전 명단으로 계속 처리 중입니다." : "지원 대상자가 정가로 결제될 수 있습니다."}\n\n` +
          `사유: ${message}`
      ).catch(() => {});
    }

    return cache?.entries ?? [];
  }
}

/** 캐시를 비운다 (명단을 고친 직후 바로 반영하고 싶을 때). */
export function clearSponsorCache(): void {
  cache = null;
}

// ── 판정 ────────────────────────────────────────────────────────────────────

export interface SponsorQuery {
  phone: string;
  region?: string;
  chapter?: string;
  programTitle: string;
}

/**
 * 지원 대상 한 건을 찾는다. 못 찾으면 undefined.
 *
 * 거부권을 가진 축은 **연락처**뿐이다. 지원 과목을 적어 둔 줄은 그 과목에만 쓰이고,
 * 지역·챕터는 **어느 줄을 쓸지 고르는 순위**로만 쓴다 (표기가 폼과 달라도 지원은 붙는다).
 * 여러 줄이 맞으면 지금 신청과 더 많이 겹치는 줄이 이긴다.
 */
export function findSponsor(
  entries: SponsorEntry[],
  query: SponsorQuery
): SponsorEntry | undefined {
  const target = normalizePhone(query.phone);
  if (target.length < 10) return undefined;   // 연락처가 없으면 판정할 수 없다

  const region = normalizeLabel(query.region || "");
  const chapter = normalizeLabel(query.chapter || "");
  const title = normalizeTitle(query.programTitle);

  const matched = entries.filter((e) => {
    if (e.phone !== target) return false;
    // 지원 과목을 적어 둔 줄은 그 과목에만 쓴다. 비어 있으면 전 과목.
    if (e.programs.length && !e.programs.some((p) => normalizeTitle(p) === title)) return false;
    return true;
  });
  if (matched.length === 0) return undefined;

  // 순위 — 과목을 콕 집은 줄 > 지역이 맞는 줄 > 챕터가 맞는 줄.
  // 지역·챕터가 어긋난 줄도 후보에서 빠지지 않는다. 밀릴 뿐이다.
  const rank = (e: SponsorEntry) =>
    (e.programs.length ? 4 : 0) +
    (e.region && normalizeLabel(e.region) === region ? 2 : 0) +
    (e.chapter && normalizeLabel(e.chapter) === chapter ? 1 : 0);

  return matched.reduce((best, e) => (rank(e) > rank(best) ? e : best));
}

/**
 * 한 건의 청구 금액을 계산한다.
 * 지원 금액이 원가보다 크면 원가까지만 깎는다(음수 청구는 없다).
 */
export function applySponsor(
  entries: SponsorEntry[],
  item: { phone: string; name?: string; region?: string; chapter?: string; programTitle: string; price: number }
): SponsorApplied {
  const sponsor = findSponsor(entries, {
    phone: item.phone,
    region: item.region,
    chapter: item.chapter,
    programTitle: item.programTitle,
  });
  if (!sponsor) return { price: item.price, listPrice: item.price, discount: 0 };

  const discount = sponsor.supportAmount === null
    ? item.price
    : Math.min(sponsor.supportAmount, item.price);

  // 이름·지역·챕터가 달라도 지원은 그대로 적용하고, 사람이 확인할 수 있게 남기기만 한다.
  // 여기서 막으면 그분이 정가를 결제하고 되돌리는 데 사람 손이 든다.
  const applicant = String(item.name || "").replace(/\s+/g, "");
  if (sponsor.name && applicant && sponsor.name.replace(/\s+/g, "") !== applicant) {
    console.warn(
      `⚠ 지원 대상 이름 불일치 (지원은 적용): 명단 ${sponsor.row}행 "${sponsor.name}" / 신청 "${item.name}" / ${item.programTitle}`
    );
  }
  const mismatch: string[] = [];
  if (sponsor.region && normalizeLabel(sponsor.region) !== normalizeLabel(item.region || ""))
    mismatch.push(`지역 명단 "${sponsor.region}" / 신청 "${item.region || ""}"`);
  if (sponsor.chapter && normalizeLabel(sponsor.chapter) !== normalizeLabel(item.chapter || ""))
    mismatch.push(`챕터 명단 "${sponsor.chapter}" / 신청 "${item.chapter || ""}"`);
  if (mismatch.length) {
    console.warn(`⚠ 지원 대상 소속 불일치 (지원은 적용): 명단 ${sponsor.row}행 — ${mismatch.join(" · ")}`);
  }

  console.log(
    `🎁 지원 적용: ${item.name || sponsor.name} / ${item.programTitle} / ` +
      `${item.price.toLocaleString()}원 → ${(item.price - discount).toLocaleString()}원 (명단 ${sponsor.row}행)`
  );

  return { price: item.price - discount, listPrice: item.price, discount, sponsor };
}

/** 여러 건을 한 번에. 명단은 한 번만 읽는다. */
export async function applySponsorToItems<
  T extends { phone: string; name?: string; region?: string; chapter?: string; programTitle: string; price: number }
>(
  items: T[]
): Promise<SponsorApplied[]> {
  if (items.length === 0) return [];
  const entries = await loadSponsorList();
  if (entries.length === 0) {
    return items.map((i) => ({ price: i.price, listPrice: i.price, discount: 0 }));
  }
  return items.map((i) => applySponsor(entries, i));
}

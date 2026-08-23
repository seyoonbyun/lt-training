/**
 * 신청명단 열 스키마 — 열 위치의 유일한 출처.
 *
 * 왜 있나
 *   2026-08-23, 일괄 신청 26건이 A열이 아니라 L열부터 기록됐다. 신청 정보가
 *   통째로 사라지고 결제 기록만 남았다. 원인 후보는 여럿이었지만 공통점은 하나였다 —
 *   **열 위치가 코드 20여 곳에 문자('M2:P2')와 숫자(row[17])로 흩어져 있었다.**
 *   열을 하나 넣거나 빼면 전부 손으로 고쳐야 하고, 하나만 빠뜨려도 조용히 어긋난다.
 *   실제로 그날 L열(아무도 안 읽는 죽은 열)에 데이터가 들어앉았는데 아무 경보도 없었다.
 *
 * 규칙
 *   1) 열 위치는 **시트 1행 헤더가 정본**이다. 코드는 이름으로만 접근한다.
 *   2) 기대 헤더와 실제 헤더가 다르면 **즉시 던진다.** 추측해서 진행하지 않는다.
 *   3) 인덱스 상수(row[17])와 열 문자('S2:U2')를 코드에 직접 쓰지 않는다.
 */

/** 신청명단 열 이름. 순서가 곧 시트의 열 순서다. */
export const COLUMNS = [
  "신청일시",
  "과목명",
  "지역",
  "챕터",
  "멤버명",
  "연락처(H.P)",
  "이메일",
  "참여 방식",
  "특이사항 & 문의",
  "신청현황",
  "", // K — 신청 정보와 결제 정보를 가르는 빈 구분선
  "주문번호",
  "결제키",
  "결제수단",
  "승인일시",
  "결제자",
  "결제자 연락처",
  "결제자 이메일",
  // 취소는 "보내지 마라 · 세지 마라" 는 거부권이다. 맨 끝에 두면 읽는 범위가 조금만
  // 짧아도 빈 값으로 보여 거부권이 조용히 사라진다(대시보드 A:J · 리마인드 A1:Q ·
  // 공유시트 A2:J — 실제로 세 번 났고, 취소자에게 당일 리마인드가 나갔다).
  // 발송 기록 열은 앞으로 계속 늘어나므로 그 **앞**에 고정해 다시 밀리지 않게 둔다.
  "취소",
  // 취소 안내는 **Apps Script(취소·환불 처리)** 가 쓰는 유일한 발송 기록이다.
  // 그 스크립트는 이 스키마를 못 쓰고 숫자 인덱스로 접근하므로, 같이 쓰는 '취소' 옆에
  // 붙여 두 열을 한 덩어리로 관리한다. 서버가 쓰는 발송 기록은 아래 블록이다.
  "취소 안내 문자 발송",
  // ── 여기부터 서버가 쓰는 발송 기록. 새 안내가 생기면 이 블록 뒤에 붙인다.
  "결제완료 문자 발송",
  "결제완료 이메일 발송",
  "재결제 안내",
  "미결제 안내 문자 발송",
  "리마인드1차",
  "리마인드2차",
] as const;

export type ColumnName = (typeof COLUMNS)[number];

/** 0-based 인덱스 -> 'A' 'B' ... 'AA' */
export function colLetter(index: number): string {
  let n = index, out = "";
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

/** 이름 -> 0-based 인덱스. 스키마에 없는 이름은 던진다(오타를 조용히 넘기지 않는다). */
export function idx(name: ColumnName): number {
  const i = (COLUMNS as readonly string[]).indexOf(name);
  if (i < 0) throw new Error(`신청명단 스키마에 없는 열: "${name}"`);
  return i;
}

/** 이름 -> 열 문자 */
export function col(name: ColumnName): string {
  return colLetter(idx(name));
}

/** 마지막 열 문자 (읽기 범위의 오른쪽 끝) */
export const LAST_COL = colLetter(COLUMNS.length - 1);

/** 한 행 전체 범위. 예: rowRange('2026 LTT 신청명단', 15) -> "'2026 LTT 신청명단'!A15:Y15" */
export function rowRange(sheetName: string, row: number): string {
  return `'${sheetName}'!A${row}:${LAST_COL}${row}`;
}

/** 이름 두 개로 구간 범위. 예: span(tab, 15, '결제자', '결제자 이메일') -> "...!P15:R15" */
export function span(sheetName: string, row: number, from: ColumnName, to: ColumnName): string {
  const a = idx(from), b = idx(to);
  if (a > b) throw new Error(`범위가 거꾸로입니다: ${from} > ${to}`);
  return `'${sheetName}'!${colLetter(a)}${row}:${colLetter(b)}${row}`;
}

/** 한 칸 범위. 예: cell(tab, 15, '취소') -> "...!Y15" */
export function cell(sheetName: string, row: number, name: ColumnName): string {
  return `'${sheetName}'!${col(name)}${row}`;
}

/** 전체 읽기 범위. 예: sheetRange('2026 LTT 신청명단') -> "'2026 LTT 신청명단'!A:Y" */
export function sheetRange(sheetName: string): string {
  return `'${sheetName}'!A:${LAST_COL}`;
}

/**
 * 행 배열에서 이름으로 값 꺼내기. 빈 칸은 "" 로 통일한다.
 * 인덱스를 직접 쓰지 않게 하려고 둔다.
 */
export function get(row: any[] | undefined, name: ColumnName): string {
  return String(row?.[idx(name)] ?? "").trim();
}

/**
 * 스키마 순서대로 값 배열을 만든다. 지정하지 않은 열은 빈 문자열이 된다.
 * A열부터 마지막 열까지 **항상 길이가 맞는** 배열이 나오므로, 값 개수와
 * 범위 폭이 어긋나 옆 열로 밀려 들어가는 사고가 구조적으로 불가능해진다.
 */
export function buildRow(values: Partial<Record<ColumnName, string>>): string[] {
  const out = new Array(COLUMNS.length).fill("");
  for (const [name, v] of Object.entries(values)) {
    out[idx(name as ColumnName)] = v == null ? "" : String(v);
  }
  return out;
}

/** 스키마 일부 구간만 잘라낸 값 배열. span() 과 짝으로 쓴다. */
export function buildSpan(
  from: ColumnName,
  to: ColumnName,
  values: Partial<Record<ColumnName, string>>
): string[] {
  const a = idx(from), b = idx(to);
  const full = buildRow(values);
  return full.slice(a, b + 1);
}

/**
 * 시트 1행이 스키마와 같은지 확인한다. 다르면 **던진다.**
 *
 * ⛔ 여기서 조용히 넘어가면 안 된다. 누군가 시트에서 열을 넣거나 지우면
 *   그 뒤의 모든 읽기·쓰기가 한 칸씩 어긋난 채로 계속 돌아간다.
 */
export function assertHeader(header: any[] | undefined): void {
  const actual = (header || []).map((h) => String(h ?? "").trim());
  const problems: string[] = [];
  for (let i = 0; i < COLUMNS.length; i++) {
    const want = COLUMNS[i];
    const got = actual[i] ?? "";
    if (want !== got) problems.push(`${colLetter(i)}: 기대 "${want}" / 실제 "${got}"`);
  }
  const extra = actual.slice(COLUMNS.length).map((v, i) => (v ? `${colLetter(COLUMNS.length + i)}: "${v}"` : null)).filter(Boolean);
  if (extra.length) problems.push(`스키마 밖에 값이 있음 — ${extra.join(", ")}`);
  if (problems.length) {
    throw new Error(
      `신청명단 헤더가 코드 스키마와 다릅니다. 시트 열이 바뀌었는지 확인하세요.\n  ` +
        problems.join("\n  ")
    );
  }
}

/**
 * 기록 결과의 updatedRange 가 A열에서 시작하는지 확인한다.
 *
 * ⛔ 2026-08-23 사고의 마지막 방어선. 그날 append 가 'L96:AF96' 을 돌려줬는데
 *   코드가 정규식으로 **행 번호만** 뽑아 96으로 읽고 그대로 진행했다. 시작 열을
 *   봤더라면 26건이 결제로 넘어가기 전에 멈췄다.
 */
export function assertWroteFromColumnA(updatedRange: string): number {
  const m = String(updatedRange || "").match(/!([A-Z]+)(\d+)/);
  if (!m) throw new Error(`기록 범위를 읽을 수 없습니다: "${updatedRange}"`);
  const [, startCol, row] = m;
  if (startCol !== "A") {
    throw new Error(
      `신청명단 기록이 A열이 아니라 ${startCol}열에서 시작했습니다 (${updatedRange}). ` +
        `열이 밀려 기록됐을 수 있어 중단합니다.`
    );
  }
  return parseInt(row, 10);
}

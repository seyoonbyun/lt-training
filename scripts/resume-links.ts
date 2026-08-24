/**
 * 「결제 이어하기」 링크 생성기.
 *
 * 결제를 끝내지 못한 신청을 **접수 묶음** 단위로 모아 링크를 하나씩 만든다.
 * 받는 분은 링크만 누르면 되고, 명단을 다시 입력하지 않는다.
 *
 * 묶음 = 같은 지역/챕터 + **연속된 행** + 앞 행과의 접수 간격 3초 이내.
 * 단체 신청은 한 번에 들어와 행이 1초 안팎으로 붙는다. 반면 서로 다른 사람이
 * 각자 신청한 건은 최소 수 초씩 벌어지므로 이 기준으로 갈린다.
 *
 * ⛔ 분 단위로 묶으면 안 된다 - 같은 챕터의 두 사람이 10초 차이로 신청한 것을
 *    한 건으로 합쳐, 한 분이 남의 신청까지 결제하고 그 내역까지 보게 된다
 *    (2026-08-22 권혁성/피경화 건에서 실제로 그렇게 묶였다).
 *
 * 결제자는 묶음의 **첫 행**으로 본다 (단체 신청은 신청자 본인이 먼저 들어간다).
 *
 * ⚠ 서명이 SESSION_SECRET 에서 나오므로, **운영과 같은 SESSION_SECRET** 으로
 *    만들어야 링크가 열린다. 만든 뒤 반드시 운영 주소로 한 번 열어 확인할 것.
 *
 * 실행: npx tsx scripts/resume-links.ts [https://ltt-bnikorea.com]
 */
import { createResumeToken, encodeRows } from "../server/services/resume-token";
import { getServiceAccountAccessToken } from "../server/services/google-sheets";
import { parseStamp } from "../shared/stamp";

const BASE = process.argv[2] || "https://ltt-bnikorea.com";
const SHEET = process.env.GOOGLE_SPREADSHEET_ID || "";

interface Group {
  key: string;
  region: string;
  chapter: string;
  submittedAt: string;
  rows: number[];
  payer: { name: string; phone: string; email?: string };
  people: Set<string>;
}

async function main() {
  if (!SHEET) throw new Error("GOOGLE_SPREADSHEET_ID not set");

  const token = await getServiceAccountAccessToken(
    "https://www.googleapis.com/auth/spreadsheets.readonly"
  );
  const range = encodeURIComponent("'2026 LTT 신청명단'!A:Y");
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET}/values/${range}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`시트 읽기 실패: ${res.status}`);

  const rows = ((await res.json()) as { values?: string[][] }).values || [];

  const groups: Group[] = [];
  let current: Group | null = null;
  let lastAt = NaN;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const paid = String(row[9] || "").trim();
    const cancelled = String(row[18] || "").trim();  // S: 취소
    if (paid === "완료" || paid === "결제완료" || cancelled) {
      current = null; // 결제/취소된 행을 만나면 묶음을 끊는다
      continue;
    }

    const at = parseStamp(String(row[0] || ""));
    const region = String(row[2] || "").trim();
    const chapter = String(row[3] || "").trim();

    // 같은 챕터 + 앞 행과 3초 이내일 때만 이어 붙인다.
    const continues =
      current !== null &&
      current.region === region &&
      current.chapter === chapter &&
      Number.isFinite(at) &&
      Number.isFinite(lastAt) &&
      at - lastAt <= 3000;

    if (!continues) {
      current = {
        key: `${i + 1}`,
        region,
        chapter,
        submittedAt: String(row[0] || ""),
        rows: [],
        payer: {
          name: String(row[4] || "").trim(),
          phone: String(row[5] || "").trim(),
          email: String(row[6] || "").trim() || undefined,
        },
        people: new Set(),
      };
      groups.push(current);
    }

    current!.rows.push(i + 1);
    current!.people.add(String(row[5] || "").replace(/\D/g, "") || String(row[4] || ""));
    lastAt = at;
  }

  const PRICE_HINT = 33000;
  console.log(`미결제 묶음 ${groups.length}건\n`);

  for (const g of groups) {
    const link = `${BASE}/pay/${createResumeToken(g.rows)}`;
    console.log(`■ ${g.payer.name} (${g.region}/${g.chapter})`);
    console.log(`  접수    : ${g.submittedAt}`);
    console.log(`  연락처  : ${g.payer.phone}`);
    console.log(`  규모    : ${g.people.size}명 / ${g.rows.length}건 / 약 ${(g.rows.length * PRICE_HINT).toLocaleString()}원`);
    console.log(`  행      : ${encodeRows(g.rows)}`);
    console.log(`  링크    : ${link}   (${link.length}자)`);
    console.log();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

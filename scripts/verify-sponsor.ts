/**
 * 지원 대상(0원 결제) 검증 — 읽기 전용.
 * 시트에 아무것도 쓰지 않고, 문자도 보내지 않는다.
 *
 *   npx tsx scripts/verify-sponsor.ts
 */
import "dotenv/config";
import { googleSheetsService } from "../server/services/google-sheets";
import {
  SPONSOR_COLUMNS,
  SPONSOR_TAB,
  applySponsor,
  findSponsor,
  loadSponsorList,
  normalizePhone,
  normalizeLabel,
  normalizeTitle,
  parseSponsorRows,
  type SponsorEntry,
} from "../server/services/sponsor-list";

let bad = 0;
function check(label: string, got: any, want: any) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) bad++;
  console.log(`  ${ok ? "✓" : "✗"} ${label.padEnd(46)} ${JSON.stringify(got)}${ok ? "" : `  (기대 ${JSON.stringify(want)})`}`);
}

const HEADER = SPONSOR_COLUMNS as unknown as string[];

async function main() {
  console.log("─".repeat(78));
  console.log("[1] 연락처 정규화 — 어떻게 적어도 같은 사람으로 봐야 한다");
  check("010-1234-5678", normalizePhone("010-1234-5678"), "01012345678");
  check("01012345678", normalizePhone("01012345678"), "01012345678");
  check("010 1234 5678 (공백)", normalizePhone("010 1234 5678"), "01012345678");
  check("+82 10-1234-5678", normalizePhone("+82 10-1234-5678"), "01012345678");
  check("앞자리 0 유실(엑셀)", normalizePhone("1012345678"), "01012345678");
  check("일반 10자리는 안 건드린다", normalizePhone("0212345678"), "0212345678");
  check("빈 값", normalizePhone(""), "");

  console.log("\n[2] 과목명 정규화 — 'LTT : ' 를 빼고 적어도 맞아야 한다");
  const T = "LTT : 파운데이션 T.";
  check("LTT : 파운데이션 T.", normalizeTitle(T), "파운데이션");
  check("파운데이션 T. 로 적어도 같다", normalizeTitle("파운데이션 T."), normalizeTitle(T));
  check("파운데이션 만 적어도 같다", normalizeTitle("파운데이션"), normalizeTitle(T));
  check("PR 코디네이터T. (붙은 T.)", normalizeTitle("LTT : PR 코디네이터T."), "pr코디네이터");
  check("ST 는 T 가 안 잘린다", normalizeTitle("ST"), "st");
  check("ST 와 ST T. 는 같다", normalizeTitle("ST"), normalizeTitle("LTT : ST T."));
  check("비지터 호스트도 안 깎인다", normalizeTitle("비지터호스트"), normalizeTitle("LTT : 비지터 호스트 T."));

  console.log("\n[2-2] 지역·챕터 정규화");
  check("서 울 = 서울", normalizeLabel("서 울"), normalizeLabel("서울"));

  console.log("\n[3] 헤더가 어긋나면 즉시 던진다 (추측해서 진행하지 않는다)");
  try {
    parseSponsorRows([["지역", "챕터", "멤버명", "휴대폰", "지원 과목", "지원 금액(원)", "비고"]]);
    console.log("  ✗ 헤더가 달라도 통과했다"); bad++;
  } catch (e) {
    console.log(`  ✓ 던졌다: ${(e as Error).message.slice(0, 60)}...`);
  }

  console.log("\n[4] 명단 파싱");
  const parsed = parseSponsorRows([
    HEADER,
    ["서울", "강남", "홍길동", "010-1234-5678", "", "", "전액 지원"],
    ["서울", "강남", "김철수", "01099998888", "LTT : 파운데이션 T., 멤버십위원 T.", "", ""],
    ["부산", "해운대", "박영희", "010-7777-6666", "", "50,000", "절반 지원"],
    ["", "", "최전역", "010-5555-4444", "", "", "지역·챕터를 안 따지는 줄"],
    ["", "", "", "", "", "", ""],                              // 빈 줄
    ["서울", "강남", "이상한", "123", "", "", "연락처가 짧다"],   // 판정 불가
  ]);
  check("유효한 줄 수", parsed.length, 4);
  check("지역", parsed[0].region, "서울");
  check("챕터", parsed[0].chapter, "강남");
  check("전 과목(빈 칸)", parsed[0].programs, []);
  check("과목 2개 분리", parsed[1].programs.length, 2);
  check("전액 지원 = null", parsed[0].supportAmount, null);
  check("50,000 파싱", parsed[2].supportAmount, 50000);

  const q = (phone: string, region: string, chapter: string, title = "LTT : 파운데이션 T.") =>
    ({ phone, region, chapter, programTitle: title });

  console.log("\n[5] 판정 — 연락처 하나로 가른다 (지역·챕터는 거부권이 없다)");
  check("지역·챕터·연락처 전부 일치", !!findSponsor(parsed, q("010-1234-5678", "서울", "강남")), true);
  check("지역이 달라도 지원은 붙는다", !!findSponsor(parsed, q("010-1234-5678", "부산", "강남")), true);
  check("챕터가 달라도 지원은 붙는다", !!findSponsor(parsed, q("010-1234-5678", "서울", "역삼")), true);
  check("신청서 소속을 못 맞춰도 붙는다", !!findSponsor(parsed, q("010-1234-5678", "", "")), true);
  check("명단이 비워 둔 줄은 아무 지역·챕터나", !!findSponsor(parsed, q("010-5555-4444", "대구", "수성")), true);
  check("띄어쓰기 차이는 같게 본다", !!findSponsor(parsed, q("010-1234-5678", "서 울", "강 남")), true);

  console.log("\n[5-2] 판정 — 과목·연락처");
  check("과목 지정 — 맞는 과목", !!findSponsor(parsed, q("01099998888", "서울", "강남")), true);
  check("과목 지정 — 접두사 없이", !!findSponsor(parsed, q("01099998888", "서울", "강남", "파운데이션 T.")), true);
  check("과목 지정 — 다른 과목", !!findSponsor(parsed, q("01099998888", "서울", "강남", "LTT : ST T.")), false);
  check("명단에 없는 사람", !!findSponsor(parsed, q("01000000000", "서울", "강남")), false);
  check("연락처가 없으면 판정 불가", !!findSponsor(parsed, q("", "서울", "강남")), false);
  check("앞자리 0 이 날아간 연락처도 산다", !!findSponsor(parsed, q("1012345678", "서울", "강남")), true);

  console.log("\n[6] 금액 — 전액은 0원, 부분은 깎은 만큼");
  const full = applySponsor(parsed, { phone: "010-1234-5678", region: "서울", chapter: "강남", name: "홍길동", programTitle: "LTT : 파운데이션 T.", price: 120000 });
  check("전액 지원 청구액", full.price, 0);
  check("전액 지원 정가", full.listPrice, 120000);
  const half = applySponsor(parsed, { phone: "010-7777-6666", region: "부산", chapter: "해운대", name: "박영희", programTitle: "LTT : 파운데이션 T.", price: 120000 });
  check("부분 지원 청구액", half.price, 70000);
  const wrongRegion = applySponsor(parsed, { phone: "010-7777-6666", region: "서울", chapter: "해운대", name: "박영희", programTitle: "LTT : 파운데이션 T.", price: 120000 });
  check("지역이 어긋나도 지원은 그대로", wrongRegion.price, 70000);
  const none = applySponsor(parsed, { phone: "01000000000", region: "서울", chapter: "강남", name: "무명", programTitle: "LTT : 파운데이션 T.", price: 120000 });
  check("비대상 청구액", none.price, 120000);
  const over = applySponsor(
    [{ region: "", chapter: "", name: "과잉", phone: "01055554444", programs: [], supportAmount: 999999, note: "", row: 9 } as SponsorEntry],
    { phone: "01055554444", region: "서울", chapter: "강남", name: "과잉", programTitle: "LTT : 파운데이션 T.", price: 120000 }
  );
  check("지원금이 정가보다 커도 음수는 없다", over.price, 0);

  console.log("\n[6-1] 실제 명단에서 어긋나 있던 표기들 — 그래도 0원이어야 한다");
  const drift = parseSponsorRows([
    HEADER,
    ["ADMIN", "ADMIN", "관리자", "010-1111-0001", "", "33,000", "폼에 없는 지역·챕터"],
    ["부산", "파이오니아", "부산멤버", "010-1111-0002", "", "33,000", "폼은 부산1 · 파이어니어"],
    ["고양", "션샤인", "고양멤버", "010-1111-0003", "", "33,000", "폼은 선샤인"],
  ]);
  for (const [phone, region, chapter] of [
    ["010-1111-0001", "강남", "올인원"],
    ["010-1111-0002", "부산1", "파이어니어"],
    ["010-1111-0003", "고양", "선샤인"],
  ] as string[][]) {
    const r = applySponsor(drift, { phone, region, chapter, name: "", programTitle: "LTT : 의장 T.", price: 33000 });
    check(`${region} ${chapter} → 0원`, r.price, 0);
  }

  console.log("\n[6-2] 여러 줄이 맞으면 더 구체적인 줄을 쓴다");
  const layered = parseSponsorRows([
    HEADER,
    ["", "", "겹침", "010-3333-2222", "", "", "전 지역·전 과목·전액"],
    ["서울", "강남", "겹침", "010-3333-2222", "LTT : 파운데이션 T.", "10,000", "이 줄이 이겨야 한다"],
  ]);
  const picked = applySponsor(layered, { phone: "010-3333-2222", region: "서울", chapter: "강남", name: "겹침", programTitle: "LTT : 파운데이션 T.", price: 120000 });
  check("구체적인 줄이 이긴다", picked.price, 110000);

  console.log(`\n[7] 지금 시트의 '${SPONSOR_TAB}' 탭 실측`);
  const live = await loadSponsorList();
  console.log(`  등록된 지원 대상: ${live.length}명`);
  for (const e of live.slice(0, 20)) {
    const scope = e.programs.length ? e.programs.join(" / ") : "전 과목";
    const amount = e.supportAmount === null ? "전액" : `${e.supportAmount.toLocaleString()}원`;
    const where = `${e.region || "(전 지역)"} · ${e.chapter || "(전 챕터)"}`;
    console.log(`   · ${e.row}행  ${where}  ${e.name || "(이름 없음)"}  ${e.phone}  [${scope}]  ${amount}${e.note ? "  — " + e.note : ""}`);
  }
  if (live.length > 20) console.log(`   ... 외 ${live.length - 20}명`);

  // ⛔ 명단의 지원 과목이 실제 과목과 하나도 안 맞으면 그 줄은 영영 안 걸린다.
  //    조용히 정가로 결제되므로 여기서 시끄럽게 알린다.
  const titles = (await googleSheetsService.getSecondarySheetPrograms()).map((p: any) => normalizeTitle(p.title));
  let orphan = 0;
  for (const e of live) {
    for (const p of e.programs) {
      if (!titles.includes(normalizeTitle(p))) {
        console.log(`  ✗ ${e.row}행 지원 과목 "${p}" 은 어느 과목과도 안 맞습니다 (이 줄은 지원이 안 붙습니다)`);
        orphan++; bad++;
      }
    }
  }
  if (live.length && !orphan) console.log("  ✓ 지원 과목 표기가 전부 실제 과목과 맞습니다");

  // 명단의 지역·챕터 표기가 신청 폼 값과 다른 줄. **지원은 그대로 붙는다**(거부권이 없다).
  // 실패로 세지 않고, 담당자가 보고 고칠 수 있게 보여만 준다.
  const { REGION_CHAPTERS } = await import("../client/src/lib/regions");
  const formPairs = new Set<string>();
  for (const [region, chapters] of Object.entries(REGION_CHAPTERS as Record<string, string[]>)) {
    for (const c of chapters) formPairs.add(`${normalizeLabel(region)}|${normalizeLabel(c)}`);
  }
  const drifted = live.filter(
    (e) => e.region && e.chapter && !formPairs.has(`${normalizeLabel(e.region)}|${normalizeLabel(e.chapter)}`)
  );
  if (drifted.length) {
    console.log(`\n  ⓘ 신청 폼에 없는 소속 표기 ${drifted.length}줄 — 지원은 그대로 붙습니다(참고용)`);
    for (const e of drifted) console.log(`     · ${e.row}행  ${e.region} · ${e.chapter}  ${e.name}`);
  } else if (live.length) {
    console.log("  ✓ 명단의 지역·챕터 표기가 전부 신청 폼 값과 맞습니다");
  }

  console.log("\n" + "─".repeat(78));
  console.log(bad === 0 ? "전부 통과" : `실패 ${bad}건`);
  process.exit(bad === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });

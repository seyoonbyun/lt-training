/**
 * 지원 대상(0원 결제) 검증 — 읽기 전용.
 * 시트에 아무것도 쓰지 않고, 문자도 보내지 않는다.
 *
 *   npx tsx scripts/verify-sponsor.ts
 */
import "dotenv/config";
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
  check("LTT : 파운데이션 T.", normalizeTitle("LTT : 파운데이션 T."), "파운데이션t.");
  check("파운데이션 T.", normalizeTitle("파운데이션 T."), "파운데이션t.");

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

  console.log("\n[5] 판정 — 지역·챕터까지 맞아야 한다");
  check("지역·챕터·연락처 전부 일치", !!findSponsor(parsed, q("010-1234-5678", "서울", "강남")), true);
  check("지역이 다르면 탈락", !!findSponsor(parsed, q("010-1234-5678", "부산", "강남")), false);
  check("챕터가 다르면 탈락", !!findSponsor(parsed, q("010-1234-5678", "서울", "역삼")), false);
  check("신청서에 지역·챕터가 없으면 탈락", !!findSponsor(parsed, q("010-1234-5678", "", "")), false);
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
  check("지역이 어긋나면 정가", wrongRegion.price, 120000);
  const none = applySponsor(parsed, { phone: "01000000000", region: "서울", chapter: "강남", name: "무명", programTitle: "LTT : 파운데이션 T.", price: 120000 });
  check("비대상 청구액", none.price, 120000);
  const over = applySponsor(
    [{ region: "", chapter: "", name: "과잉", phone: "01055554444", programs: [], supportAmount: 999999, note: "", row: 9 } as SponsorEntry],
    { phone: "01055554444", region: "서울", chapter: "강남", name: "과잉", programTitle: "LTT : 파운데이션 T.", price: 120000 }
  );
  check("지원금이 정가보다 커도 음수는 없다", over.price, 0);

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

  console.log("\n" + "─".repeat(78));
  console.log(bad === 0 ? "전부 통과" : `실패 ${bad}건`);
  process.exit(bad === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });

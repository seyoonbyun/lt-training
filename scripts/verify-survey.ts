/**
 * 만족도 설문 배선 검증. **읽기 전용** — 문자를 보내지 않고 시트도 안 건드린다.
 *
 *   npx tsx scripts/verify-survey.ts            # 지금 시각 기준
 *   npx tsx scripts/verify-survey.ts 17:05      # 그 시각이라 치고
 *
 * 확인하는 것
 *   1) 세션등록 C열에서 **끝 시각**을 제대로 읽는가 (표기가 세 가지다)
 *   2) 그 시각에 어느 과목이 대상이 되는가
 *   3) 대상자가 몇 명이고 문자 본문·바이트가 어떻게 나오는가 (LMS 상한 2000)
 *   4) `/survey` 가 과목을 어떻게 고르는가
 *   5) 에어테이블 → 시트 적재가 무엇을 새로 넣게 되는가
 */

import "dotenv/config";
import {
  buildSurveyMessages,
  findAttendees,
  findDueSessions,
  parseEndMinutes,
  surveyLink,
  todayKst,
} from "../server/services/survey";
import { googleSheetsService } from "../server/services/google-sheets";
import { smsByteLength } from "../server/services/solapi";
import { isSurveySyncConfigured } from "../server/services/survey-sync";
import { surveyFormUrl } from "../shared/site-links";

const hhmm = process.argv.find((a) => /^\d{1,2}:\d{2}$/.test(a));
let now = new Date();
if (hhmm) {
  // KST 로 그 시각이 되도록 오늘 날짜에 붙인다.
  const [h, m] = hhmm.split(":").map(Number);
  now = new Date(`${todayKst()}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00+09:00`);
}
console.log(`기준 시각(KST) : ${now.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}\n`);

// ── 1) 끝 시각 파싱
const programs = (await googleSheetsService.getSecondarySheetPrograms()) as any[];
console.log("[1] 세션등록 끝 시각");
for (const p of programs) {
  const end = parseEndMinutes(p.time);
  const date = p.formattedDate
    ? new Date(p.formattedDate).toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" })
    : "(날짜없음)";
  const endText = end == null ? "❌ 못 읽음" : `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`;
  console.log(`  ${date}  ${endText}  ${String(p.sessionNumber).padEnd(10)} ${p.title}   ← "${p.time}"`);
}

// ── 2) 대상 과목
const { due, tooLate } = await findDueSessions(now);
console.log(`\n[2] 지금 대상 과목 : ${due.length ? due.map((d) => d.title).join(", ") : "(없음)"}`);
if (tooLate.length) console.log(`    너무 늦어 제외 : ${tooLate.map((t) => t.title).join(", ")}`);
for (const d of due) console.log(`    링크 : ${surveyLink(d.sessionNo)}  (${surveyLink(d.sessionNo).length}자)`);

// ── 3) 대상자와 문자 본문
if (due.length) {
  const rows = await findAttendees(due.map((d) => d.title));
  const linkByTitle = new Map(due.map((d) => [d.title, surveyLink(d.sessionNo)]));
  const messages = buildSurveyMessages(rows, (t) => linkByTitle.get(t) || "");
  console.log(`\n[3] 대상자 ${rows.length}명 → 문자 ${messages.length}통`);
  if (messages.length) {
    const bytes = messages.map((m) => smsByteLength(m.text));
    console.log(`    바이트 최대 ${Math.max(...bytes)} / 상한 2000 (EUC-KR 기준)`);
    console.log(`    받는 사람 : ${messages.slice(0, 5).map((m) => m.label).join(", ")}${messages.length > 5 ? " …" : ""}`);
    console.log("\n    ── 본문 미리보기 ──");
    console.log(messages[0].text.split("\n").map((l) => "    " + l).join("\n"));
  }
} else {
  console.log("\n[3] 대상 과목이 없어 건너뜁니다.");
}

// ── 4) /survey 가 고르는 과목
console.log("\n[4] /survey 링크 확인");
for (const d of due.length ? due : programs.slice(0, 1)) {
  console.log(`    ?s=${(d as any).sessionNo ?? String((d as any).sessionNumber || "").replace(/[^0-9]/g, "")} → ${surveyFormUrl((d as any).title)}`);
}

// ── 5) 시트 적재
//    기본은 **읽기만** 한다. `--sync` 를 줄 때만 실제로 탭을 만들고 붙인다
//    (라이브 시트를 건드리는 일이라 확인 스크립트가 마음대로 하면 안 된다).
console.log("\n[5] 시트 적재");
if (!isSurveySyncConfigured()) {
  console.log("    AIRTABLE_TOKEN 이 없습니다 — 이 환경에서는 적재가 꺼집니다.");
} else if (process.argv.includes("--sync")) {
  const { runSurveySync } = await import("../server/services/survey-sync");
  const r = await runSurveySync();
  console.log(`    에어테이블 응답 ${r.total}건 / 이번에 새로 넣은 것 ${r.added}건`);
} else {
  const res = await fetch("https://api.airtable.com/v0/app1K25AF4bAhA24S/tblcOf4ao4864aJQs?pageSize=100", {
    headers: { Authorization: `Bearer ${String(process.env.AIRTABLE_TOKEN).trim()}` },
  });
  const data: any = await res.json();
  if (!res.ok) console.log(`    ❌ 에어테이블 읽기 실패 ${res.status}: ${JSON.stringify(data).slice(0, 200)}`);
  else console.log(`    에어테이블 응답 ${(data.records || []).length}건 (읽기만 했습니다. 실제 적재는 --sync)`);
}

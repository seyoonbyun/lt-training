/**
 * 만족도 설문 Airtable base·테이블·필드 생성 (1회성 세팅).
 *
 *   npx tsx scripts/setup-survey-airtable.ts --check
 *   npx tsx scripts/setup-survey-airtable.ts --apply
 *
 * ⛔ **폼 뷰는 API로 못 만든다** — 생성 엔드포인트가 없다(삭제만 있다).
 *    이 스크립트가 표와 필드를 만들어 두고, 폼 화면 하나는 UI에서 만든다.
 *    (MyPowerteam 때와 같다. 볼트 `MyPowerteam/06 Airtable 개념과 세팅` §5·§8)
 *
 * ⛔ 토큰을 이 파일에 적지 않는다. 이 저장소는 **public** 이다.
 *    `AIRTABLE_TOKEN` 환경변수 → 없으면 `connect\airtable_token.txt`("TOKEN : pat...") 를 읽는다.
 *    그 파일은 볼트·바탕화면 밖(=클라우드 동기화 밖)에 둔 자격증명 폴더다.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const WORKSPACE_ID = "wspwo3aLmcWPRwH2H"; // My First Workspace
const BASE_NAME = "BNI LTT 만족도 설문";
const TABLE_NAME = "2026 LTT 만족도";

const TOKEN_FILE = path.join(os.homedir(), "desktop", "connect_tl_report", "connect", "airtable_token.txt");

function readToken(): string {
  const fromEnv = String(process.env.AIRTABLE_TOKEN || "").trim();
  if (fromEnv) return fromEnv;
  if (!fs.existsSync(TOKEN_FILE)) {
    throw new Error(`토큰이 없습니다. AIRTABLE_TOKEN 을 주거나 ${TOKEN_FILE} 을 두세요.`);
  }
  const raw = fs.readFileSync(TOKEN_FILE, "utf8");
  const m = raw.match(/pat[A-Za-z0-9._-]+/);
  if (!m) throw new Error(`${TOKEN_FILE} 에서 pat... 토큰을 찾지 못했습니다.`);
  return m[0];
}

const token = readToken();

async function api(method: string, url: string, body?: any) {
  const res = await fetch(`https://api.airtable.com/v0${url}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`${method} ${url} → ${res.status} ${JSON.stringify(data)}`);
  }
  return data;
}

/** 별점 필드. 문항 순서가 곧 폼 순서가 되므로 여기 순서가 정본이다. */
const rating = (name: string, description: string) => ({
  name,
  description,
  type: "rating",
  options: { icon: "star", max: 5, color: "yellowBright" },
});

/**
 * 필드 정의.
 *
 * ⭐ 첫 필드가 **primary field** 가 된다. 레코드 제목으로 쓰이므로 `과목` 을 앞에 둔다.
 * ⭐ `과목` 은 문자 링크가 `?prefill_과목=...` 로 채운다. 그래서 **singleSelect 가 아니라
 *   singleLineText** 다 — 과목이 늘거나 표기가 바뀌면 select 옵션과 어긋나 prefill 이
 *   조용히 빈 칸이 된다(세션등록 시트가 정본이고 거기서 그대로 실어 보낸다).
 */
const FIELDS = [
  { name: "과목", type: "singleLineText", description: "문자 링크가 자동으로 채웁니다" },
  rating("교육 내용 만족도", "교육 내용이 도움이 되었는지"),
  rating("강사 만족도", "강사의 전달력·준비도"),
  rating("운영·진행 만족도", "시간 운영·자료·강의실(온라인 포함) 진행"),
  rating("추천 의향", "동료 멤버에게 추천하시겠습니까"),
  { name: "가장 도움이 된 점", type: "multilineText" },
  { name: "개선했으면 하는 점", type: "multilineText" },
  { name: "이름", type: "singleLineText", description: "선택 항목" },
  { name: "챕터", type: "singleLineText", description: "선택 항목" },
];

async function check() {
  const bases = await api("GET", "/meta/bases");
  console.log("토큰 정상. 접근 가능 base:");
  for (const b of bases.bases || []) console.log(`  ${b.id}  ${b.name}  (${b.permissionLevel})`);
  const existing = (bases.bases || []).find((b: any) => b.name === BASE_NAME);
  console.log(existing ? `\n이미 있습니다 → ${existing.id}` : `\n"${BASE_NAME}" 없음 — --apply 로 만듭니다.`);
  return existing?.id as string | undefined;
}

async function apply() {
  const existingId = await check();
  if (existingId) {
    // 같은 이름의 base 를 또 만들면 어느 쪽이 정본인지 알 수 없게 된다.
    console.log("\n이미 있으므로 아무것도 만들지 않습니다. 다시 만들려면 UI 에서 지우고 실행하세요.");
    return;
  }

  const created = await api("POST", "/meta/bases", {
    name: BASE_NAME,
    workspaceId: WORKSPACE_ID,
    tables: [{ name: TABLE_NAME, fields: FIELDS }],
  });

  const baseId = created.id;
  const tableId = created.tables?.[0]?.id;
  console.log(`\n✅ base 생성 — ${baseId}`);
  console.log(`✅ table 생성 — ${tableId} (${TABLE_NAME})`);
  console.log(`   필드 ${created.tables?.[0]?.fields?.length ?? 0}개`);
  console.log(`\n주소 : https://airtable.com/${baseId}/${tableId}`);
  console.log(`\n남은 것(UI) : 폼 뷰 1개 생성 → 공개 링크(shr...) 를 SURVEY_FORM_URL 에 넣기`);
}

const mode = process.argv.includes("--apply") ? "apply" : "check";
await (mode === "apply" ? apply() : check());

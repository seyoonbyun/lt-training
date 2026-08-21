/**
 * 결제 완료 안내 **문자** 본문.
 *
 * 내용 자체는 `enrollment-notice` 가 만든다. 여기서는 문자 형식으로 그리기만 한다.
 * (문자와 이메일이 같은 내용이어야 해서 본문을 각각 짜지 않는다)
 *
 * 한 사람이 여러 과목을 신청했으면 과목마다 보내지 않고 **한 통에 묶는다**.
 * (다과목 개별 신청이 기본 경로라 안 묶으면 한 번 결제에 문자가 5~10통씩 나간다)
 */

import { smsByteLength, type SmsMessage } from "./solapi";
import {
  BRAND,
  CONTACT_NAME,
  CONTACT_TEL,
  buildBlock,
  countPeople,
  groupByPhone,
  groupByProgram,
  type NoticeBlock,
  type ProgramInfo,
  type SmsRecipient,
} from "./enrollment-notice";
import type { NoticeKind } from "./enrollment-email";
import { REFUND_SUMMARY_SHORT } from "../../shared/refund-policy";

export type { ProgramInfo, SmsRecipient } from "./enrollment-notice";

const CONTACT = `문의 : ${CONTACT_NAME} ${CONTACT_TEL}`;
const HEAD = `[${BRAND}]`;

function renderBlock(block: NoticeBlock): string {
  const lines = [`▶ ${block.title}`];
  for (const row of block.rows) {
    // 문자엔 버튼이 없다. 링크가 본문에 안 들어 있으면 뒤에 붙여 준다(오프라인 장소의 지도 링크 등).
    const needsUrl = row.url && !row.value.includes(row.url);
    lines.push(`${row.label} : ${row.value}${needsUrl ? ` ${row.url}` : ""}`);
  }
  for (const note of block.notes) lines.push(`※ ${note}`);
  return lines.join("\n");
}

/** LMS 한 통은 2000바이트까지다. 넘치면 잘리므로 과목 단위로 나눠 여러 통으로 보낸다. */
const SPLIT_BUDGET = 1850;

function splitBlocks(head: string, blocks: string[], foot: string): string[] {
  const wrap = (chunk: string[], marker = "") =>
    [head + marker, "", chunk.join("\n\n"), "", foot].join("\n");

  if (smsByteLength(wrap(blocks)) <= SPLIT_BUDGET) return [wrap(blocks)];

  const chunks: string[][] = [];
  let current: string[] = [];
  for (const block of blocks) {
    const next = current.concat(block);
    if (current.length > 0 && smsByteLength(wrap(next)) > SPLIT_BUDGET) {
      chunks.push(current);
      current = [block];
    } else {
      current = next;
    }
  }
  if (current.length) chunks.push(current);

  return chunks.map((chunk, i) => wrap(chunk, ` (${i + 1}/${chunks.length})`));
}

/**
 * 수강자 문자. 같은 번호는 한 통으로 묶는다.
 * 연락처가 없는 수강자는 여기서 빠진다(호출부가 건너뛴 수를 보고한다).
 */
export function buildAttendeeMessages(
  recipients: SmsRecipient[],
  programs: Map<string, ProgramInfo>,
  kind: NoticeKind = "confirm"
): { messages: SmsMessage[]; noPhone: string[] } {
  const { groups, noPhone } = groupByPhone(recipients);

  const messages: SmsMessage[] = groups.flatMap(({ phone, list }) => {
    const name = list[0].name || "";
    const blocks = list.map((r) => renderBlock(buildBlock(r.programTitle, r.trainingType, programs.get(r.programTitle))));
    const head = [
      HEAD,
      kind === "reminder" ? `${name}님, 오늘 교육이 진행됩니다.` : `${name}님, 신청이 완료되었습니다.`,
    ].join("\n");
    return splitBlocks(head, blocks, `※ ${REFUND_SUMMARY_SHORT}\n${CONTACT}`).map((text) => ({
      to: phone,
      text,
      label: `${name}(${list.length}과목)`,
    }));
  });

  return { messages, noPhone };
}

/**
 * 대리 신청한 결제자용 문자. 과목별 링크를 전부 싣는다.
 * (수강자가 문자를 못 봤을 때 결제자가 직접 전달할 수 있게 — 사용자 지시)
 */
export function buildPayerMessage(
  payer: { name: string; phone: string },
  recipients: SmsRecipient[],
  programs: Map<string, ProgramInfo>,
  kind: NoticeKind = "confirm"
): SmsMessage | null {
  if (!String(payer?.phone || "").replace(/\D/g, "")) return null;
  if (recipients.length === 0) return null;

  const blocks = groupByProgram(recipients).map(({ title, trainingType, names }) =>
    `${renderBlock(buildBlock(title, trainingType, programs.get(title)))}\n대상 : ${names.join(", ")}`
  );

  const text = [
    HEAD,
    kind === "reminder"
      ? `${payer.name || ""}님, 대리 신청하신 교육이 오늘 진행됩니다.`
      : `${payer.name || ""}님, 대리 신청 ${recipients.length}건(수강자 ${countPeople(recipients)}명) 결제가 완료되었습니다.`,
    "",
    blocks.join("\n\n"),
    "",
    "※ 연락처를 남긴 수강자에게는 위 안내가 개별 발송되었습니다.",
    `※ ${REFUND_SUMMARY_SHORT}`,
    CONTACT,
  ].join("\n");

  return { to: payer.phone, text, label: `결제자 ${payer.name}` };
}

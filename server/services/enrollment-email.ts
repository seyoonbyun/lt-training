/**
 * 결제 완료 안내 **이메일** 본문.
 *
 * 내용은 문자와 같다 — 둘 다 `enrollment-notice` 의 블록에서 그린다.
 *
 * 마크업은 사용자가 준 `01-formal.html` 템플릿을 그대로 따른다 —
 * `role="presentation"` 테이블 · 600px 고정폭 · `bgcolor` 병기.
 * 아웃룩을 비롯한 구형 메일 클라이언트가 flex·div 레이아웃을 못 그리기 때문이고,
 * 임의로 현대적인 CSS 로 바꾸면 수신자에 따라 무너진다.
 *
 * ⛔ 링크에 손대지 말 것 — 원문 URL 을 그대로 href 에 넣는다.
 *    래퍼를 씌우거나 파라미터를 떼면 네이버 수신자에게 리디렉션 경고가 다시 뜬다(MTL 에서 겪은 것).
 */

import type { MailMessage } from "./mailer";
import {
  BRAND,
  CONTACT_NAME,
  CONTACT_TEL,
  buildBlock,
  collectOrderIds,
  countPeople,
  groupByEmail,
  groupByProgram,
  type NoticeBlock,
  type ProgramInfo,
  type SmsRecipient,
} from "./enrollment-notice";
import { REFUND_POLICY, REFUND_FORM_URL, REFUND_CONTACT, refundPolicyText } from "../../shared/refund-policy";
import { TRAINING_SUMMARY_URL, CS_KAKAO_URL } from "../../shared/site-links";

/** 안내 성격. 제목과 첫 문장이 달라진다. */
export type NoticeKind = "confirm" | "reminder";

/** 템플릿(01-formal.html) 의 브랜드 레드 */
const RED = "#c41324";
const FONT =
  "'Apple SD Gothic Neo','Malgun Gothic','맑은 고딕','Noto Sans KR',Helvetica,Arial,sans-serif";

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 과목 한 건 = 정보 카드 하나. 템플릿의 Info card 구조 그대로. */
function cardHtml(block: NoticeBlock, extra?: { label: string; value: string }): string {
  const rows = block.rows
    .filter((r) => !(r.isCta && block.cta))   // 버튼으로 그릴 줄은 표에서 뺀다(같은 링크가 두 번 나오지 않게)
    .map((r) => {
      const value = r.url
        ? `<a href="${escapeHtml(r.url)}" style="color:#1a5cc8;text-decoration:underline;word-break:break-all;">${escapeHtml(r.value)}</a>`
        : escapeHtml(r.value);
      return `<tr><td style="width:64px;color:#888;vertical-align:top;">${escapeHtml(r.label)}</td><td style="vertical-align:top;">${value}</td></tr>`;
    });

  if (extra) {
    rows.push(
      `<tr><td style="width:64px;color:#888;vertical-align:top;">${escapeHtml(extra.label)}</td><td style="vertical-align:top;">${escapeHtml(extra.value)}</td></tr>`
    );
  }

  const notes = block.notes.length
    ? `<div style="margin-top:12px;font-size:13px;line-height:1.7;color:#888;">${block.notes
        .map((n) => `※ ${escapeHtml(n)}`)
        .join("<br>")}</div>`
    : "";

  const cta = block.cta
    ? `
<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin-top:16px;">
<tr><td bgcolor="${RED}" style="background:${RED};border-radius:4px;">
<a href="${escapeHtml(block.cta.url)}" target="_blank" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;letter-spacing:0.2px;">${escapeHtml(block.cta.label)} →</a>
</td></tr>
</table>`
    : "";

  return `
<tr><td style="padding:0 32px 16px 32px;">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#ffffff;border:1px solid #ececec;border-left:4px solid ${RED};border-radius:6px;">
<tr><td style="padding:20px 24px;">
<div style="font-size:16px;font-weight:700;color:#111;margin-bottom:14px;">${escapeHtml(block.title)}</div>
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="font-size:14px;line-height:1.8;color:#333;">${rows.join("")}</table>
${cta}
${notes}
</td></tr>
</table>
</td></tr>`;
}

function blockText(block: NoticeBlock, extra?: { label: string; value: string }): string {
  const lines = [`▶ ${block.title}`];
  for (const r of block.rows) {
    // 텍스트본에는 버튼이 없다. 링크가 본문에 안 들어 있으면 뒤에 붙인다.
    const needsUrl = r.url && !r.value.includes(r.url);
    lines.push(`${r.label} : ${r.value}${needsUrl ? ` ${r.url}` : ""}`);
  }
  if (extra) lines.push(`${extra.label} : ${extra.value}`);
  for (const n of block.notes) lines.push(`※ ${n}`);
  return lines.join("\n");
}

/** 보조 버튼 하나 (테두리형). 메일 앱 호환을 위해 표로 그린다. */
function secondaryButton(label: string, url: string): string {
  return `
<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="display:inline-block;margin:0 8px 8px 0;vertical-align:top;">
<tr><td bgcolor="#ffffff" style="background:#ffffff;border:1px solid #d0d0d0;border-radius:4px;">
<a href="${escapeHtml(url)}" target="_blank" style="display:inline-block;padding:11px 20px;font-size:13px;font-weight:700;color:#444;text-decoration:none;">${escapeHtml(label)} →</a>
</td></tr>
</table>`;
}

/**
 * 카드 아래 보조 동작 두 개.
 *   강의 이수 신청  → Training Summary 제출처 (이걸 내야 이수 등록된다)
 *   취소 · 환불 접수 → 접수 신청서. 폼이 아직 없으면 CS 카카오 채널로 보낸다.
 */
function actionsHtml(): string {
  return `
<tr><td style="padding:4px 32px 20px 32px;">
${secondaryButton("강의 이수 신청", TRAINING_SUMMARY_URL)}${secondaryButton("취소 · 환불 접수", REFUND_FORM_URL || CS_KAKAO_URL)}
</td></tr>`;
}

/** 구분선 한 줄 (템플릿의 Divider) */
const DIVIDER = `
<tr><td style="padding:8px 32px 14px 32px;"><table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%"><tr><td style="border-top:1px solid #ececec;font-size:0;line-height:0;">&nbsp;</td></tr></table></td></tr>`;

/** 취소·환불 규정 + 접수 버튼 */
function refundHtml(): string {
  const sections = REFUND_POLICY.map(
    (sec) => `
<tr><td style="padding:0 0 12px 0;">
<div style="font-size:13px;font-weight:700;color:#444;margin-bottom:4px;">${escapeHtml(sec.heading)}</div>
<div style="font-size:13px;line-height:1.7;color:#888;">${sec.items.map((i) => `· ${escapeHtml(i)}`).join("<br>")}</div>
</td></tr>`
  ).join("");

  // 접수 버튼은 카드 아래 보조 버튼으로 이미 나가므로 여기서는 창구만 적는다(같은 버튼 두 번 금지).
  const button = `<div style="font-size:13px;line-height:1.7;color:#888;margin-top:6px;">접수 : ${escapeHtml(REFUND_CONTACT)}</div>`;

  return `
<tr><td style="padding:0 32px 8px 32px;">
<div style="font-size:14px;font-weight:700;color:#111;margin-bottom:12px;">취소 · 환불 규정</div>
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">${sections}</table>
${button}
</td></tr>`;
}

/** 템플릿 뼈대. 헤드라인 · 안내문 · 카드들 · 규정 · 푸터 순서는 01-formal.html 과 같다. */
function wrapHtml(opts: {
  subject: string;
  headline: string;
  intro: string;
  cards: string;
  footNote?: string;
  /** 카드 아래 보조 버튼 위에 놓는 주문번호 줄 */
  orderNote?: string;
}): string {
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(opts.subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:${FONT};color:#222;">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f4f4f4;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="max-width:600px;background:#ffffff;border-top:6px solid ${RED};">

<tr><td style="padding:32px 32px 6px 32px;font-size:13px;letter-spacing:0.4px;color:#9a9a9a;">${escapeHtml(BRAND)}</td></tr>

<tr><td style="padding:0 32px 12px 32px;font-size:22px;line-height:1.4;font-weight:700;color:#111;">${opts.headline}</td></tr>

<tr><td style="padding:0 32px 24px 32px;font-size:14px;line-height:1.7;color:#333;">${opts.intro}</td></tr>

${opts.cards}
${opts.orderNote ? `<tr><td style="padding:0 32px 6px 32px;font-size:13px;line-height:1.7;color:#666;">주문번호 : <span style="color:#333;font-weight:700;">${escapeHtml(opts.orderNote)}</span></td></tr>` : ""}
${actionsHtml()}
${opts.footNote ? `<tr><td style="padding:0 32px 16px 32px;font-size:13px;line-height:1.7;color:#888;">${opts.footNote}</td></tr>` : ""}
${DIVIDER}
${refundHtml()}
${DIVIDER}

<tr><td style="padding:4px 32px 32px 32px;font-size:13px;line-height:1.7;color:#777;">문의 : ${escapeHtml(CONTACT_NAME)} ${escapeHtml(CONTACT_TEL)}</td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

function titleSummary(titles: string[]): string {
  const head = titles[0] || "LT Training";
  return titles.length > 1 ? `${head} 외 ${titles.length - 1}과목` : head;
}

function subjectFor(kind: NoticeKind, titles: string[]): string {
  return kind === "reminder"
    ? `[${BRAND}] 오늘 교육 안내 — ${titleSummary(titles)}`
    : `[${BRAND}] 신청 완료 안내 — ${titleSummary(titles)}`;
}

/** 규정·문의를 텍스트본 끝에 붙인다 */
function textFooter(orderIds: string[] = []): string[] {
  return [
    ...(orderIds.length ? [`주문번호 : ${orderIds.join(", ")}`] : []),
    `강의 이수 신청 : ${TRAINING_SUMMARY_URL}`,
    `취소 · 환불 접수 : ${REFUND_FORM_URL || CS_KAKAO_URL}`,
    "",
    "── 취소 · 환불 규정",
    refundPolicyText(),
    REFUND_FORM_URL ? `접수 : ${REFUND_FORM_URL}` : `접수 : ${REFUND_CONTACT}`,
    "",
    `문의 : ${CONTACT_NAME} ${CONTACT_TEL}`,
  ];
}

/**
 * 수강자 이메일. 같은 주소는 한 통으로 묶는다.
 * 주소가 없거나 형식이 틀린 사람은 빠진다(호출부가 건너뛴 수를 보고한다).
 */
export function buildAttendeeMails(
  recipients: SmsRecipient[],
  programs: Map<string, ProgramInfo>,
  kind: NoticeKind = "confirm"
): { mails: MailMessage[]; noEmail: string[] } {
  const { groups, noEmail } = groupByEmail(recipients);

  const mails: MailMessage[] = groups.map(({ email, list }) => {
    const name = list[0].name || "";
    const titles = list.map((r) => r.programTitle);
    const blocks = list.map((r) => buildBlock(r.programTitle, r.trainingType, programs.get(r.programTitle)));
    const subject = subjectFor(kind, titles);
    // 취소·환불 접수 폼이 "결제 완료 문자·이메일에 적힌 번호" 라고 안내한다. 반드시 실린다.
    const orders = collectOrderIds(list);

    const headlineText =
      kind === "reminder" ? `${name}님, 오늘 교육이 진행됩니다.` : `${name}님, 신청이 정상적으로 완료되었습니다.`;
    // 온라인 과목뿐인데 "장소 확인" 이라고 쓰면 어색하다. 카드에 장소 줄이 있을 때만 그렇게 쓴다.
    const hasVenue = blocks.some((b) => b.rows.some((r) => r.label === "장소"));
    const what = hasVenue ? "일정과 장소" : "일정과 입장 정보";
    const introText =
      kind === "reminder"
        ? `오늘 진행되는 ${BRAND} [${titleSummary(titles)}] 강의 안내입니다. 아래 ${what}를 확인해 주세요.`
        : `${BRAND} [${titleSummary(titles)}] 강의에 신청해 주셔서 감사합니다. 아래 ${what} 확인 후 참석 부탁드립니다.`;

    return {
      to: email,
      subject,
      html: wrapHtml({
        subject,
        headline: escapeHtml(headlineText),
        intro: escapeHtml(introText).replace(
          escapeHtml(`[${titleSummary(titles)}]`),
          `<strong style="color:#111;">${escapeHtml(`[${titleSummary(titles)}]`)}</strong>`
        ),
        cards: blocks.map((b) => cardHtml(b)).join(""),
        orderNote: orders.join(", "),
      }),
      text: [
        `[${BRAND}]`,
        headlineText,
        "",
        blocks.map((b) => blockText(b)).join("\n\n"),
        "",
        ...textFooter(orders),
      ].join("\n"),
      label: `${name}(${list.length}과목)`,
    };
  });

  return { mails, noEmail };
}

/**
 * 대리 신청한 결제자용 이메일. 과목별 링크를 전부 싣는다.
 * (수강자가 못 받았을 때 결제자가 직접 전달할 수 있게 — 사용자 지시)
 */
export function buildPayerMail(
  payer: { name: string; email: string },
  recipients: SmsRecipient[],
  programs: Map<string, ProgramInfo>,
  kind: NoticeKind = "confirm"
): MailMessage | null {
  const email = String(payer?.email || "").trim();
  if (!email || recipients.length === 0) return null;

  const grouped = groupByProgram(recipients);
  const orders = collectOrderIds(recipients);
  const titles = grouped.map((g) => g.title);
  const subject = subjectFor(kind, titles);
  const people = countPeople(recipients);

  const cards = grouped
    .map(({ title, trainingType, names }) =>
      cardHtml(buildBlock(title, trainingType, programs.get(title)), { label: "대상", value: names.join(", ") })
    )
    .join("");
  const cardsText = grouped
    .map(({ title, trainingType, names }) =>
      blockText(buildBlock(title, trainingType, programs.get(title)), { label: "대상", value: names.join(", ") })
    )
    .join("\n\n");

  const headlineText =
    kind === "reminder"
      ? `${payer.name || ""}님, 대리 신청하신 교육이 오늘 진행됩니다.`
      : `${payer.name || ""}님, 대리 신청이 정상적으로 완료되었습니다.`;
  const introText =
    kind === "reminder"
      ? `대리 신청하신 ${recipients.length}건(수강자 ${people}명)의 교육이 오늘 진행됩니다. 과목별 입장 정보는 아래와 같습니다.`
      : `대리 신청 ${recipients.length}건(수강자 ${people}명)의 결제가 완료되었습니다. 과목별 입장 정보는 아래와 같습니다.`;
  const foot =
    "※ 연락처·이메일을 남긴 수강자에게는 위 안내가 개별 발송되었습니다.<br>" +
    "※ 취소를 요청하실 때는 <strong style=\"color:#444;\">어느 과목의 어느 수강자</strong>인지 함께 알려주셔야 처리됩니다.";
  const footText = [
    "※ 연락처·이메일을 남긴 수강자에게는 위 안내가 개별 발송되었습니다.",
    "※ 취소를 요청하실 때는 어느 과목의 어느 수강자인지 함께 알려주셔야 처리됩니다.",
  ];

  return {
    to: email,
    subject,
    html: wrapHtml({
      subject,
      headline: escapeHtml(headlineText),
      intro: escapeHtml(introText),
      cards,
      footNote: foot,
      orderNote: orders.join(", "),
    }),
    text: [`[${BRAND}]`, headlineText, "", cardsText, "", ...footText, "", ...textFooter(orders)].join("\n"),
    label: `결제자 ${payer.name}`,
  };
}

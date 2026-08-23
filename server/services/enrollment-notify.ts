/**
 * 참여 안내 발송 — 문자와 이메일을 같은 내용으로 함께 보낸다.
 *
 * 쓰이는 곳이 둘이다.
 *   1) 결제 승인 직후            (kind: 'confirm')  — routes.ts
 *   2) 트레이닝 당일 오전 10시    (kind: 'reminder') — reminder.ts
 *
 * ⛔ 여기서 던지는 예외가 결제 승인 응답을 막으면 안 된다. 전부 잡아 로그만 남긴다.
 */

import { googleSheetsService } from "./google-sheets";
import { isSolapiConfigured, sendMessages } from "./solapi";
import { isMailerConfigured, sendMails } from "./mailer";
import { cell } from "./sheet-schema";
import { buildAttendeeMessages, buildPayerMessage } from "./enrollment-sms";
import { buildAttendeeMails, buildPayerMail, type NoticeKind } from "./enrollment-email";
import type { ProgramInfo, SmsRecipient } from "./enrollment-notice";

export interface NotifyTarget {
  recipients: SmsRecipient[];
  /** 일괄(대리) 신청의 결제자. 링크 전체를 한 통 더 받는다. */
  payer?: { name: string; phone: string; email?: string };
  kind: NoticeKind;
  /** 로그에 붙일 식별자 (주문번호 등) */
  context: string;
}

/** 세션등록 시트에서 과목별 링크·일시를 읽어 제목으로 찾을 수 있게 만든다. */
export async function loadProgramMap(): Promise<Map<string, ProgramInfo>> {
  const programs = (await googleSheetsService.getSecondarySheetPrograms()) as any[];
  const byTitle = new Map<string, ProgramInfo>();
  for (const p of programs) {
    byTitle.set(p.title, {
      title: p.title,
      date: p.date,
      time: p.time,
      format: p.format,
      zoomUrl: p.zoomUrl,
      classroomUrl: p.classroomUrl,
      venueText: p.venueText,
      classroomPw: p.classroomPw,
    });
  }
  return byTitle;
}

export async function sendEnrollmentNotice(target: NotifyTarget, programMap?: Map<string, ProgramInfo>) {
  const { recipients, payer, kind, context } = target;
  if (!recipients || recipients.length === 0) {
    return { skipped: true, reason: "no-recipients" as const };
  }

  try {
    const byTitle = programMap || (await loadProgramMap());

    // ── 문자
    const { messages, noPhone } = buildAttendeeMessages(recipients, byTitle, kind);
    if (noPhone.length > 0) {
      // 일괄 신청의 수강자 연락처는 선택값이다. 빈 분은 보낼 수단이 없으므로 남겨서 알린다.
      console.warn(`[문자] 연락처가 없어 건너뛴 수강자 ${noPhone.length}명 ${context}: ${noPhone.join(", ")}`);
    }
    // 대리 신청의 결제자. **수강자로도 들어 있어도 반드시 따로 보낸다.**
    // ⛔ 예전에는 같은 번호면 건너뛰었다. 그래서 8/22 단체 2건(792,000원·66,000원)의
    //   결제자가 전체 주문 내역도, 주문번호도, "취소하려면 어느 과목 어느 수강자인지
    //   알려달라" 는 안내도 못 받았다. 그리고 나중에 결제자가 누구였는지 되찾을 경로도
    //   그 문자 하나뿐이었는데 그게 없어서 못 찾았다.
    //   같은 번호로 두 통이 가는 편이 낫다. 시트에 적힌 연락처에는 전부 보낸다.
    if (payer?.phone) {
      const pm = buildPayerMessage({ name: payer.name, phone: payer.phone }, recipients, byTitle, kind);
      if (pm) messages.push(pm);
    }

    // ── 이메일
    const { mails, noEmail } = buildAttendeeMails(recipients, byTitle, kind);
    if (noEmail.length > 0) {
      console.warn(`[메일] 주소가 없어 건너뛴 수강자 ${noEmail.length}명 ${context}: ${noEmail.join(", ")}`);
    }
    // 메일도 같다. 수강자와 주소가 같아도 결제자 메일은 따로 보낸다.
    if (payer?.email) {
      const pm = buildPayerMail({ name: payer.name, email: payer.email }, recipients, byTitle, kind);
      if (pm) mails.push(pm);
    }

    if (!isSolapiConfigured()) {
      console.error(`[문자] 설정이 없어 ${messages.length}건을 보내지 못했습니다 ${context}`);
    }
    if (!isMailerConfigured()) {
      console.error(`[메일] 설정이 없어 ${mails.length}통을 보내지 못했습니다 ${context}`);
    }

    // 한쪽이 죽어도 다른 쪽은 나가야 한다. 둘 다 예외를 던지지 않는다.
    const [sms, mail] = await Promise.all([
      sendMessages(messages, context),
      sendMails(mails, context),
    ]);

    // 결제완료 안내는 **시트에 발송 기록을 남긴다.**
    // ⛔ 예전에는 연락처·이메일이 없어 못 보낸 사람을 console.warn 한 줄로만 남겼다.
    //   Railway 로그는 아무도 안 본다 — 오늘 기준 수강자 27명이 메일을 한 통도 못 받았는데
    //   시트만 보면 알 길이 없었다. 이제 "연락처 없음"이 그 행에 그대로 적힌다.
    if (kind === "confirm") {
      await recordSendResult(recipients, context);
    }

    return { sms: { ...sms, noPhone }, mail: { ...mail, noEmail } };
  } catch (error: any) {
    console.error(`[안내] 발송 준비 실패 ${context}:`, error?.message || error);
    return { skipped: true, reason: "build-failed" as const };
  }
}


/** 결제완료 안내의 발송 결과를 신청명단에 적는다. 실패해도 결제 흐름을 막지 않는다. */
async function recordSendResult(recipients: SmsRecipient[], context: string) {
  const stamp = new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
  const SHEET_NAME = "2026 LTT 신청명단";
  const cells: Array<{ range: string; values: string[][] }> = [];

  for (const r of recipients) {
    if (!r.sheetRow || r.sheetRow <= 1) continue;
    cells.push({
      range: cell(SHEET_NAME, r.sheetRow, "결제완료 문자 발송"),
      values: [[String(r.phone || "").trim() ? stamp : "연락처 없음"]],
    });
    cells.push({
      range: cell(SHEET_NAME, r.sheetRow, "결제완료 이메일 발송"),
      values: [[String(r.email || "").trim() ? stamp : "이메일 없음"]],
    });
  }
  if (!cells.length) return;

  try {
    await googleSheetsService.writeApplicationCells(cells);
  } catch (error: any) {
    console.error(`❌ [안내] 발송 기록 실패 ${context}: ${error?.message || error}`);
  }
}

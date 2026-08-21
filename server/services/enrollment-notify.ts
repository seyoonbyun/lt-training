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
    // 대리 신청의 결제자. 본인이 수강자로도 들어 있으면 두 통이 되므로 그때는 보내지 않는다.
    if (payer?.phone) {
      const payerDigits = String(payer.phone).replace(/\D/g, "");
      if (!messages.some((m) => m.to.replace(/\D/g, "") === payerDigits)) {
        const pm = buildPayerMessage({ name: payer.name, phone: payer.phone }, recipients, byTitle, kind);
        if (pm) messages.push(pm);
      }
    }

    // ── 이메일
    const { mails, noEmail } = buildAttendeeMails(recipients, byTitle, kind);
    if (noEmail.length > 0) {
      console.warn(`[메일] 주소가 없어 건너뛴 수강자 ${noEmail.length}명 ${context}: ${noEmail.join(", ")}`);
    }
    if (payer?.email) {
      const payerAddr = String(payer.email).trim().toLowerCase();
      if (!mails.some((m) => m.to.trim().toLowerCase() === payerAddr)) {
        const pm = buildPayerMail({ name: payer.name, email: payer.email }, recipients, byTitle, kind);
        if (pm) mails.push(pm);
      }
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

    return { sms: { ...sms, noPhone }, mail: { ...mail, noEmail } };
  } catch (error: any) {
    console.error(`[안내] 발송 준비 실패 ${context}:`, error?.message || error);
    return { skipped: true, reason: "build-failed" as const };
  }
}

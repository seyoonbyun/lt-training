/**
 * 취소·환불 규정 — **한 벌만 둔다.**
 *
 * 사이트 하단 · 이메일 템플릿 · 문자 템플릿이 전부 여기서 가져다 쓴다.
 * 세 곳에 각각 적으면 반드시 어긋나고, 어긋난 환불 규정은 그대로 분쟁거리가 된다.
 *
 * ⛔ 원문은 BNI코리아 취소·환불 규정이다. **문구를 임의로 바꾸지 말 것.**
 *    여기 실린 것은 원문에서 **강의(교육 서비스)에 해당하는 항목만** 추린 것이고,
 *    멤버십 전용 조항(활동/코어 챕터 멤버십, BNI Connect 계정, 약관 위반 계정 정지 등)은 뺐다.
 */

/**
 * 취소·환불 접수 폼. 비어 있으면 화면·메일이 버튼 대신 CS 창구로 보낸다.
 *
 * 소유 계정 = bnikorea.joybyun@gmail.com (신청명단 시트와 같은 계정).
 * 응답은 신청명단 스프레드시트에 탭으로 붙는다 — 담당자가 `신청 현황` 과 한 파일에서 본다.
 * 문항을 고칠 때는 Apps Script 프로젝트 `LT26_취소환불신청` 이 아니라 폼 편집 화면에서 직접 고친다
 * (스크립트를 다시 돌리면 **새 폼이 하나 더 생긴다**).
 */
export const REFUND_FORM_URL =
  "https://docs.google.com/forms/d/e/1FAIpQLScTVV4RycufVatNIXAZFSCDODh6UcSj_GG8fdEtzByuHfo7Cg/viewform";

/** 폼 문항 편집 주소 (담당자용, 화면에는 안 나간다) */
export const REFUND_FORM_EDIT_URL =
  "https://docs.google.com/forms/d/1XJTRaHgfh8sySKHBzl35EjV3Ch0OUFAhVtlOqj0edsw/edit";

export const REFUND_CONTACT = "BNI코리아 내셔널 오피스 CS팀 02-6261-8838";

export interface PolicySection {
  heading: string;
  items: string[];
}

export const REFUND_POLICY: PolicySection[] = [
  {
    heading: "전액 환불",
    items: [
      "수강 시작 3일 전까지 환불 요청 시 전액 환불됩니다.",
      "예) 5일 시작 강의는 2일 15시 00분 00초까지 요청 시 전액 환불",
    ],
  },
  {
    heading: "환불 불가",
    items: [
      "수강 시작일 당일 취소·환불 요청 시 환불이 불가합니다.",
      "강의가 시작된 후에는 환불이 불가합니다.",
    ],
  },
  {
    heading: "환불 요청 방법",
    items: [
      "수강 시작 3일 전까지 고객센터로 환불을 신청해 주세요.",
      "서면·전화·온라인으로 요청하실 수 있습니다.",
      "BNI코리아가 요청을 확인한 뒤 확인 이메일을 보내드리면 취소 절차가 완료됩니다.",
    ],
  },
  {
    heading: "환불 처리 기간",
    items: [
      "신용카드 : 승인 취소 후 카드사 정책에 따라 1~2개월 소요",
      "계좌이체 : 환불 승인 후 5~7영업일 내 처리",
      "그 밖의 결제 수단 : 각 결제사 정책에 따릅니다.",
    ],
  },
];

/** 문자처럼 길이가 빠듯한 곳에 쓰는 한 줄 요약 */
export const REFUND_SUMMARY_SHORT =
  "취소·환불 : 수강 시작 3일 전까지 전액 환불, 당일·시작 후 환불 불가";

/** 이메일 text/plain 본과 문자에 쓰는 여러 줄 요약 */
export function refundPolicyText(): string {
  return REFUND_POLICY.map((s) => [`[${s.heading}]`, ...s.items.map((i) => `- ${i}`)].join("\n")).join("\n\n");
}

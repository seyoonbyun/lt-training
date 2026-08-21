/**
 * 토스페이먼츠 결제 승인 연동.
 *
 * 흐름
 *  1) 클라이언트가 신청 폼을 제출하면 /api/payments/prepare 로 주문을 만든다.
 *     - 금액은 클라이언트가 보내지 않는다. 서버가 'LTT 세션등록' 시트 L열에서 읽는다.
 *  2) 클라이언트가 토스 결제창을 띄우고, 성공하면 successUrl 로 돌아온다.
 *  3) /api/payments/confirm 이 토스 승인 API를 호출한다.
 *     - 승인 직전에 주문의 저장된 금액과 돌아온 금액이 같은지 다시 대조한다.
 *  4) 승인이 떨어지면 신청명단 시트 J열에 '완료'를 기록한다.
 */

const TOSS_API = "https://api.tosspayments.com/v1/payments";

export interface PendingOrder {
  orderId: string;
  amount: number;
  orderName: string;
  programTitle: string;
  name: string;
  phone: string;
  email: string;
  createdAt: number;
  /** 신청명단 시트에서 이 주문이 기록된 행 번호 (1-based) */
  sheetRow?: number;
  /** 일괄 신청: 이 주문 한 건이 덮는 신청 행 번호들 (1-based) */
  sheetRows?: number[];
  /** 일괄 신청 인원수. 금액 = 단가 x quantity */
  quantity?: number;
  status: "pending" | "paid" | "failed";
  paymentKey?: string;
}

/**
 * 주문 보관소. 결제창이 열려 있는 몇 분 동안만 필요해서 메모리에 둔다.
 * Railway는 컨테이너가 계속 떠 있으므로 재배포 전까지 유지된다.
 * 재배포로 주문이 사라져도 승인 자체는 시트 금액으로 다시 검증되므로 결제가 틀어지지는 않는다.
 */
const orders = new Map<string, PendingOrder>();

/** 결제창은 10분 안에 승인해야 한다. 그보다 넉넉하게 30분 뒤 정리한다. */
const ORDER_TTL_MS = 30 * 60 * 1000;

function sweepExpiredOrders() {
  const now = Date.now();
  for (const [id, order] of orders) {
    if (now - order.createdAt > ORDER_TTL_MS) {
      orders.delete(id);
    }
  }
}

export function saveOrder(order: PendingOrder) {
  sweepExpiredOrders();
  orders.set(order.orderId, order);
}

export function getOrder(orderId: string): PendingOrder | undefined {
  return orders.get(orderId);
}

/**
 * 주문번호. 토스 규격은 영문/숫자/하이픈/언더스코어 6~64자다.
 * 한글 과목명은 쓸 수 없어 타임스탬프 + 난수로만 만든다.
 */
export function createOrderId(prefix: string = "LTT"): string {
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${stamp}-${rand}`.toUpperCase();
}

export function getClientKey(): string {
  return process.env.TOSS_CLIENT_KEY || "";
}

function getSecretKey(): string {
  return process.env.TOSS_SECRET_KEY || "";
}

export function isConfigured(): boolean {
  return Boolean(getClientKey() && getSecretKey());
}

export interface TossConfirmResult {
  ok: boolean;
  status?: string;
  method?: string;
  approvedAt?: string;
  totalAmount?: number;
  receiptUrl?: string;
  code?: string;
  message?: string;
}

/**
 * 결제 승인. 시크릿 키는 절대 클라이언트로 나가지 않는다.
 */
export async function confirmPayment(params: {
  paymentKey: string;
  orderId: string;
  amount: number;
}): Promise<TossConfirmResult> {
  const secretKey = getSecretKey();
  if (!secretKey) {
    return { ok: false, code: "NOT_CONFIGURED", message: "결제 설정이 완료되지 않았습니다." };
  }

  // 토스 Basic 인증은 "시크릿키:" 를 base64로 인코딩한다. 콜론이 반드시 붙는다.
  const auth = Buffer.from(`${secretKey}:`).toString("base64");

  try {
    const response = await fetch(`${TOSS_API}/confirm`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
        // 같은 주문이 두 번 승인되지 않도록 멱등키를 붙인다.
        "Idempotency-Key": params.orderId,
      },
      body: JSON.stringify({
        paymentKey: params.paymentKey,
        orderId: params.orderId,
        amount: params.amount,
      }),
    });

    const data: any = await response.json();

    if (!response.ok) {
      console.error("❌ 토스 승인 실패:", response.status, data?.code, data?.message);
      return {
        ok: false,
        code: data?.code || String(response.status),
        message: data?.message || "결제 승인에 실패했습니다.",
      };
    }

    return {
      ok: true,
      status: data?.status,
      method: data?.method,
      approvedAt: data?.approvedAt,
      totalAmount: data?.totalAmount,
      receiptUrl: data?.receipt?.url,
    };
  } catch (error) {
    console.error("❌ 토스 승인 호출 오류:", error);
    return {
      ok: false,
      code: "NETWORK_ERROR",
      message: "결제 승인 중 통신 오류가 발생했습니다.",
    };
  }
}

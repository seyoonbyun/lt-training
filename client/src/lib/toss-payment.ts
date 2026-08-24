import { loadTossPayments, ANONYMOUS } from "@tosspayments/tosspayments-sdk";

export interface PreparedOrder {
  orderId: string;
  amount: number;
  orderName: string;
  clientKey: string;
  customerName: string;
  customerEmail: string;
  customerMobilePhone: string;
  /** 지원 대상이라 청구액이 0원인 주문. 결제창을 띄우지 않는다. */
  free?: boolean;
  /** 지원 적용 전 정가 합계 */
  listAmount?: number;
}

/**
 * 결제를 시작한다.
 *
 * 두 갈래다.
 *  · 청구액이 있으면 토스 결제창을 띄운다. 창이 뜨면 페이지가 토스 도메인으로 넘어가고,
 *    끝나면 successUrl/failUrl 로 돌아온다. 그래서 이 함수는 성공 시 값을 돌려주지 않는다.
 *  · 청구액이 0원(지원 대상)이면 **결제창을 띄우지 않는다.** 토스는 0원을 승인하지 못한다
 *    (카드 최소 결제 금액 100원). 승인 화면으로 바로 보내고, 거기서 서버가 확정한다.
 *    돌아오는 주소를 토스와 똑같이 맞춰 확정 지점을 한 곳으로 유지한다.
 *
 * 모바일에서는 iframe 안에서 호출하면 안 된다(토스 제약).
 */
export async function startPayment(order: PreparedOrder): Promise<void> {
  if (order.free || order.amount === 0) {
    window.location.href =
      `${window.location.origin}/payment/success?free=1&orderId=${encodeURIComponent(order.orderId)}`;
    return;
  }

  const tossPayments = await loadTossPayments(order.clientKey);

  // 회원 식별자를 쓰지 않으므로 비회원 결제로 연다.
  const payment = tossPayments.payment({ customerKey: ANONYMOUS });

  await payment.requestPayment({
    method: "CARD",
    amount: {
      currency: "KRW",
      value: order.amount,
    },
    orderId: order.orderId,
    orderName: order.orderName,
    successUrl: `${window.location.origin}/payment/success`,
    failUrl: `${window.location.origin}/payment/fail`,
    customerEmail: order.customerEmail || undefined,
    customerName: order.customerName || undefined,
    customerMobilePhone: order.customerMobilePhone || undefined,
    card: {
      useEscrow: false,
      flowMode: "DEFAULT",
      useCardPoint: false,
      useAppCardOnly: false,
    },
  });
}

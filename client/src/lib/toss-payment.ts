import { loadTossPayments, ANONYMOUS } from "@tosspayments/tosspayments-sdk";

export interface PreparedOrder {
  orderId: string;
  amount: number;
  orderName: string;
  clientKey: string;
  customerName: string;
  customerEmail: string;
  customerMobilePhone: string;
}

/**
 * 토스 결제창을 띄운다.
 *
 * 결제창이 뜨면 페이지가 토스 도메인으로 넘어가고, 끝나면 successUrl/failUrl 로 돌아온다.
 * 그래서 이 함수는 성공 시 값을 돌려주지 않는다 — 리다이렉트로 흐름이 이어진다.
 *
 * 모바일에서는 iframe 안에서 호출하면 안 된다(토스 제약).
 */
export async function openTossPayment(order: PreparedOrder): Promise<void> {
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

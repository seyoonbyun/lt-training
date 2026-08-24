import { useEffect, useState } from "react";
import { Link } from "wouter";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ConfirmResult {
  orderName?: string;
  amount?: number;
  method?: string;
  approvedAt?: string;
  receiptUrl?: string;
  /** 지원 대상이라 0원으로 확정된 신청 */
  free?: boolean;
  /** 지원 적용 전 정가 */
  listAmount?: number;
}

export default function PaymentSuccess() {
  const [state, setState] = useState<"loading" | "done" | "error">("loading");
  const [result, setResult] = useState<ConfirmResult | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const paymentKey = params.get("paymentKey");
    const orderId = params.get("orderId");
    const amount = params.get("amount");
    // 지원 대상 0원 신청은 토스를 거치지 않고 이 주소로 바로 온다 (결제창이 뜨지 않는다).
    const isFree = params.get("free") === "1";

    if (isFree ? !orderId : (!paymentKey || !orderId || !amount)) {
      setState("error");
      setErrorMessage("결제 정보가 올바르지 않습니다.");
      return;
    }

    // 여기서 승인이 떨어져야 실제로 신청이 확정된다. 리다이렉트만으로는 끝나지 않는다.
    // 0원이든 유료든 확정 지점은 이 화면 하나다.
    fetch(isFree ? "/api/payments/confirm-free" : "/api/payments/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: isFree
        ? JSON.stringify({ orderId })
        : JSON.stringify({ paymentKey, orderId, amount: Number(amount) }),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data?.message || "결제 승인에 실패했습니다.");
        }
        setResult(data);
        setState("done");
      })
      .catch((err) => {
        setErrorMessage(err instanceof Error ? err.message : "결제 승인에 실패했습니다.");
        setState("error");
      });
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4 py-16">
      <div className="w-full max-w-md bg-white rounded-xl shadow-sm border-t-4 border-red-600 p-8 text-center">
        {state === "loading" && (
          <>
            <Loader2 className="w-12 h-12 mx-auto mb-4 text-red-600 animate-spin" />
            <h1 className="text-xl font-bold mb-2">결제를 확인하고 있습니다</h1>
            <p className="text-sm text-gray-600">잠시만 기다려 주세요. 창을 닫지 마세요.</p>
          </>
        )}

        {state === "done" && (
          <>
            <CheckCircle2 className="w-12 h-12 mx-auto mb-4 text-red-600" />
            <h1 className="text-xl font-bold mb-2">신청이 완료되었습니다</h1>
            <p className="text-sm text-gray-600 mb-6">
              {result?.free
                ? "교육비 지원 대상으로 확인되어 0원으로 신청이 확정되었습니다."
                : "결제가 정상 승인되어 신청이 확정되었습니다."}
            </p>

            <dl className="text-sm text-left border-t border-gray-200 divide-y divide-gray-100">
              {result?.orderName && (
                <div className="flex justify-between py-2.5">
                  <dt className="text-gray-500">과목</dt>
                  <dd className="font-medium">{result.orderName}</dd>
                </div>
              )}
              {typeof result?.amount === "number" && (
                <div className="flex justify-between py-2.5">
                  <dt className="text-gray-500">결제 금액</dt>
                  <dd className="font-medium">
                    {result.free && !!result.listAmount && (
                      <span className="text-gray-400 line-through mr-2 font-normal">
                        {result.listAmount.toLocaleString()}원
                      </span>
                    )}
                    {result.amount.toLocaleString()}원
                  </dd>
                </div>
              )}
              {result?.method && (
                <div className="flex justify-between py-2.5">
                  <dt className="text-gray-500">결제 수단</dt>
                  <dd className="font-medium">{result.method}</dd>
                </div>
              )}
            </dl>

            <div className="mt-6 space-y-2">
              {result?.receiptUrl && (
                <a href={result.receiptUrl} target="_blank" rel="noopener noreferrer" className="block">
                  <Button variant="outline" className="w-full">영수증 보기</Button>
                </a>
              )}
              <Link href="/">
                <Button className="w-full bg-red-600 hover:bg-red-700">홈으로</Button>
              </Link>
            </div>
          </>
        )}

        {state === "error" && (
          <>
            <XCircle className="w-12 h-12 mx-auto mb-4 text-gray-400" />
            <h1 className="text-xl font-bold mb-2">결제 확인에 실패했습니다</h1>
            <p className="text-sm text-gray-600 mb-6">{errorMessage}</p>
            <p className="text-xs text-gray-500 mb-6">
              카드에서 금액이 빠져나갔다면 내셔널 오피스 CS 팀(02-6261-8838)으로 문의해 주세요.
            </p>
            <Link href="/">
              <Button variant="outline" className="w-full">홈으로</Button>
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

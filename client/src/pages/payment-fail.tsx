import { Link } from "wouter";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function PaymentFail() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code") || "";
  const message = params.get("message") || "결제가 완료되지 않았습니다.";

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4 py-16">
      <div className="w-full max-w-md bg-white rounded-xl shadow-sm border-t-4 border-gray-400 p-8 text-center">
        <AlertCircle className="w-12 h-12 mx-auto mb-4 text-gray-400" />
        <h1 className="text-xl font-bold mb-2">결제가 완료되지 않았습니다</h1>
        <p className="text-sm text-gray-600 mb-2">{message}</p>
        {code && <p className="text-xs text-gray-400 mb-6">오류 코드: {code}</p>}

        <p className="text-sm text-gray-600 mb-6">
          신청 내역은 접수되었으나 <strong>결제가 완료되지 않아 확정되지 않았습니다.</strong>
          <br />
          홈에서 다시 신청해 주세요.
        </p>

        <Link href="/">
          <Button className="w-full bg-red-600 hover:bg-red-700">홈으로 돌아가기</Button>
        </Link>
      </div>
    </div>
  );
}

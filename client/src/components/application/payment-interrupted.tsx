import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertCircle } from "lucide-react";

/**
 * 결제창을 닫았을 때 뜨는 안내.
 *
 * 예전에는 토스트 한 줄이 떴다 사라지는 게 전부였다. 실수로 창을 닫은 분은
 * 그 사실조차 모르고 나갔고, 다음 날 11시 안내 문자를 기다려야 했다
 * (2026-08-22 오픈 당일 결제대기 57건).
 *
 * 이제 이 화면이 남아 있고, 버튼 한 번으로 자기 신청 내역으로 바로 돌아간다.
 * 단체 신청도 명단을 다시 입력할 필요가 없다 — 링크가 시트의 그 행들을 가리킨다.
 *
 * ⛔ 자동으로 닫히지 않는다. 닫는 것은 사용자가 정한다.
 */
export function PaymentInterruptedDialog({
  open,
  onClose,
  resumeToken,
  reason,
}: {
  open: boolean;
  onClose: () => void;
  /** 서버가 주문과 함께 내려준 「결제 이어하기」 토큰. 없으면 버튼 대신 안내만 보인다. */
  resumeToken?: string;
  /** 결제창이 돌려준 사유. 사용자가 직접 닫은 경우도 여기로 온다. */
  reason?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-left">
            <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
            결제가 완료되지 않았습니다
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 text-sm text-gray-700">
          <p>
            신청은 접수되었습니다. <strong>결제를 완료하셔야 신청이 확정</strong>됩니다.
          </p>

          {resumeToken ? (
            <>
              <p>
                아래 버튼을 누르시면 방금 신청하신 내역이 그대로 나오고, 버튼 한 번으로
                결제하실 수 있습니다. <strong>다시 입력하실 내용은 없습니다.</strong>
              </p>
              <Button
                className="w-full bg-red-600 hover:bg-red-700 text-white"
                onClick={() => { window.location.href = `/pay/${resumeToken}`; }}
              >
                결제 이어하기
              </Button>
              <p className="text-xs text-gray-500">
                지금 결제하지 않으셔도 신청 내역은 남아 있습니다. 결제 안내 문자를 따로 보내드립니다.
              </p>
            </>
          ) : (
            <p>
              잠시 후 결제 안내 문자를 보내드립니다. 문자의 링크로 이어서 결제하실 수 있습니다.
            </p>
          )}

          {reason ? <p className="text-xs text-gray-400">({reason})</p> : null}
          <p className="text-xs text-gray-400">문의 : 02-6261-8838</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

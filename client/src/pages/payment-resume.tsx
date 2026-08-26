import { useEffect, useMemo, useState } from "react";
import { useRoute } from "wouter";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { startPayment } from "@/lib/toss-payment";

/**
 * 「결제 이어하기」 화면.
 *
 * 결제를 끝내지 못한 분에게 보낸 링크로 들어온다. 신청 내역은 이미 시트에 있으므로
 * **아무것도 다시 입력하지 않는다** - 확인하고 결제 버튼만 누른다.
 * (이 화면이 없으면 단체 신청은 명단 15명을 다시 타이핑해야 했다.)
 *
 * 주문서 수정도 여기서 한다 - 결제할 건을 고르고, 참여 방식을 바꿀 수 있다.
 * 제외한 건은 결제되지 않고 신청 대기로 남는다(완전 취소는 오피스 문의).
 */
interface ResumeItem {
  row: number;
  name: string;
  title: string;
  participationType: string;
  price: number;
  /** 지원 적용 전 정가 */
  listPrice?: number;
  /** 교육비 지원 대상이라 금액이 깎인 건 */
  sponsored?: boolean;
}

interface ResumeSummary {
  payer: { name: string; phone: string; email?: string };
  amount: number;
  quantity: number;
  memberCount: number;
  items: ResumeItem[];
  alreadyPaid: string[];
  closed: string[];
  /** 취소·환불된 건. 결제 끝난 건과 갈라서 보여준다 — 이분들은 다시 신청하실 수 있다. */
  cancelled?: string[];
}

const won = (n: number) => n.toLocaleString("ko-KR");
const LIVE = "실시간 참여";
const VOD = "녹화본 시청(VOD)";
const shortTitle = (t: string) => t.replace(/^LTT\s*:\s*/, "");

export default function PaymentResume() {
  const [, params] = useRoute("/pay/:token");
  const token = params?.token || "";

  const [summary, setSummary] = useState<ResumeSummary | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [savingRow, setSavingRow] = useState<number | null>(null);

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const res = await fetch("/api/payments/resume/" + encodeURIComponent(token));
        const data = await res.json();
        if (!res.ok) {
          setError(data?.message || "신청 내역을 불러오지 못했습니다.");
        } else {
          setSummary(data);
          setSelected(new Set<number>((data.items || []).map((i: ResumeItem) => i.row)));
        }
      } catch {
        setError("신청 내역을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  const chosen = useMemo(
    () => (summary?.items || []).filter((i) => selected.has(i.row)),
    [summary, selected]
  );
  const total = chosen.reduce((sum, i) => sum + i.price, 0);
  const memberCount = new Set(chosen.map((i) => i.name)).size;

  const toggle = (row: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(row)) next.delete(row);
      else next.add(row);
      return next;
    });
  };

  const toggleAll = () => {
    const all = (summary?.items || []).map((i) => i.row);
    setSelected(selected.size === all.length ? new Set<number>() : new Set<number>(all));
  };

  /** 참여 방식 변경은 즉시 시트에 반영한다 - 결제 후 안내 문자의 링크가 갈리기 때문이다. */
  const changeType = async (row: number, participationType: string) => {
    setSavingRow(row);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/payments/resume/" + encodeURIComponent(token), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ row, participationType }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.message || "변경하지 못했습니다.");
        return;
      }
      setSummary((prev) =>
        prev
          ? { ...prev, items: prev.items.map((i) => (i.row === row ? { ...i, participationType } : i)) }
          : prev
      );
      setNotice("참여 방식을 변경했습니다.");
    } catch {
      setError("변경하지 못했습니다. 다시 시도해 주세요.");
    } finally {
      setSavingRow(null);
    }
  };

  const handlePay = async () => {
    setPaying(true);
    setError("");
    try {
      const res = await fetch("/api/payments/resume/" + encodeURIComponent(token), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: chosen.map((i) => i.row) }),
      });
      const order = await res.json();
      if (!res.ok) {
        setError(order?.message || "결제를 시작하지 못했습니다.");
        return;
      }
      await startPayment(order);
    } catch (e: any) {
      setError(e?.message || "결제창이 닫혔습니다. 다시 시도해 주세요.");
    } finally {
      setPaying(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="w-8 h-8 animate-spin text-red-600" />
      </div>
    );
  }

  if (error && !summary) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4 py-16">
        <div className="w-full max-w-md bg-white rounded-xl shadow-sm border-t-4 border-gray-400 p-8 text-center">
          <AlertCircle className="w-12 h-12 mx-auto mb-4 text-gray-400" />
          <h1 className="text-xl font-bold mb-2">링크를 열 수 없습니다</h1>
          <p className="text-sm text-gray-600 mb-6">{error}</p>
          <p className="text-xs text-gray-400">문의 : 02-6261-8838</p>
        </div>
      </div>
    );
  }

  if (!summary) return null;

  const empty = summary.items.length === 0;
  // 결제할 것이 없는데 그 사유가 **전부 취소**인 경우. "이미 결제됨" 과 갈라야 한다.
  const allCancelled = empty && (summary.cancelled?.length ?? 0) > 0;

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-10">
      <div className="w-full max-w-lg mx-auto bg-white rounded-xl shadow-sm border-t-4 border-red-600 p-6 sm:p-8">
        <h1 className="text-xl font-bold mb-1">LT 트레이닝 결제</h1>
        <p className="text-sm text-gray-600 mb-6">
          {allCancelled ? (
            <>{summary.payer?.name} 님, 이 링크의 신청 내역을 안내드립니다.</>
          ) : (
            <>
              {summary.payer?.name} 님, 아래 신청 내역의 결제를 이어서 진행하실 수 있습니다.
              <br />
              <span className="text-gray-500">
                다시 입력하실 내용은 없으며, 필요하시면 아래에서 수정하실 수 있습니다.
              </span>
            </>
          )}
        </p>

        {empty ? (
          // ⛔ 취소·환불된 링크에 "결제가 이미 완료된 신청입니다" 를 띄우면 **거짓말**이다.
          //   초록 체크까지 붙어 있어 "끝난 일" 로 읽히고, 다시 신청할 수 있다는 걸
          //   모른 채 포기한다(2026-08-26 컴플레인). 두 경우를 갈라서 사실대로 적는다.
          allCancelled ? (
            <div className="rounded-lg bg-gray-50 border border-gray-200 p-4 text-center mb-6">
              <AlertCircle className="w-8 h-8 mx-auto mb-2 text-gray-500" />
              <p className="text-sm font-medium text-gray-800">취소·환불 처리된 신청입니다.</p>
              <p className="mt-1 text-xs text-gray-600">
                이 링크로는 결제하실 수 없습니다.
                <br />
                다시 수강하고 싶으시면 <strong>새로 신청하실 수 있습니다.</strong> 환불받으셨어도 재신청에 제한이 없습니다.
              </p>
              <a
                href="/"
                className="mt-3 inline-block rounded-md bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-700"
              >
                신청 페이지로 가기
              </a>
            </div>
          ) : (
            <div className="rounded-lg bg-green-50 border border-green-200 p-4 text-center mb-6">
              <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-green-600" />
              <p className="text-sm font-medium text-green-800">결제가 이미 완료된 신청입니다.</p>
            </div>
          )
        ) : (
          <>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-500">결제하실 항목을 선택해 주세요</span>
              <button type="button" onClick={toggleAll} className="text-xs text-red-600 hover:underline">
                {selected.size === summary.items.length ? "전체 해제" : "전체 선택"}
              </button>
            </div>

            <div className="rounded-lg border border-gray-200 divide-y mb-4 max-h-96 overflow-y-auto">
              {summary.items.map((item) => {
                const on = selected.has(item.row);
                return (
                  <div
                    key={item.row}
                    className={"px-3 py-2.5 text-sm " + (on ? "" : "bg-gray-50 opacity-60")}
                  >
                    <div className="flex items-start gap-2.5">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => toggle(item.row)}
                        className="mt-1 h-4 w-4 accent-red-600 shrink-0"
                        aria-label={item.name + " " + shortTitle(item.title) + " 결제 포함"}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium truncate">{item.name}</span>
                          <span className="shrink-0 text-gray-700">
                            {item.sponsored && (
                              <span className="text-gray-400 line-through mr-1.5">
                                {won(item.listPrice ?? item.price)}원
                              </span>
                            )}
                            {won(item.price)}원
                          </span>
                        </div>
                        <div className="text-gray-500 truncate">{shortTitle(item.title)}</div>

                        <div className="mt-1.5 flex gap-1">
                          {[LIVE, VOD].map((type) => (
                            <button
                              key={type}
                              type="button"
                              disabled={savingRow === item.row}
                              onClick={() => {
                                if (item.participationType !== type) changeType(item.row, type);
                              }}
                              className={
                                "px-2 py-0.5 rounded text-xs border transition " +
                                (item.participationType === type
                                  ? "bg-red-600 text-white border-red-600"
                                  : "bg-white text-gray-500 border-gray-300 hover:border-gray-400")
                              }
                            >
                              {type === LIVE ? "실시간" : "녹화본"}
                            </button>
                          ))}
                          {savingRow === item.row && (
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400 self-center ml-1" />
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex items-center justify-between border-t pt-4 mb-2">
              <span className="text-sm text-gray-600">
                {memberCount}명 · {chosen.length}건
              </span>
              <span className="text-lg font-bold">{won(total)}원</span>
            </div>

            {chosen.length < summary.items.length && (
              <p className="text-xs text-gray-500 mb-4">
                선택하지 않은 {summary.items.length - chosen.length}건은 결제되지 않고 신청 대기로
                남습니다. 완전히 취소하시려면 내셔널 오피스로 연락해 주세요.
              </p>
            )}
          </>
        )}

        {summary.alreadyPaid?.length > 0 && (
          <p className="text-xs text-gray-500 mb-3">
            이미 결제된 건은 제외했습니다 : {summary.alreadyPaid.join(", ")}
          </p>
        )}
        {/*
          취소·환불된 건은 "이미 결제됨" 과 절대 섞지 않는다. 환불받은 분에게 그렇게 쓰면
          거짓말이고, 다시 신청할 수 있다는 걸 모른 채 포기한다. 그래서 사실을 적고
          신청 페이지로 가는 길을 바로 준다.
        */}
        {(summary.cancelled?.length ?? 0) > 0 && (
          <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
            <p className="text-xs text-gray-700">
              취소·환불 처리된 건은 제외했습니다 : {summary.cancelled!.join(", ")}
            </p>
            <p className="mt-1 text-xs text-gray-700">
              다시 수강하고 싶으시면 <strong>새로 신청하실 수 있습니다.</strong> 환불받으셨어도 재신청에 제한이 없습니다.
            </p>
            <a
              href="/"
              className="mt-2 inline-block rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
            >
              신청 페이지로 가기
            </a>
          </div>
        )}
        {summary.closed?.length > 0 && (
          <p className="text-xs text-gray-500 mb-3">
            접수가 마감된 과목은 제외했습니다 : {summary.closed.join(", ")}
            <br />
            해당 건은 내셔널 오피스로 문의해 주세요.
          </p>
        )}

        {notice && <p className="text-sm text-green-700 mb-3">{notice}</p>}
        {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

        {!empty && (
          <Button
            className="w-full bg-red-600 hover:bg-red-700"
            onClick={handlePay}
            disabled={paying || chosen.length === 0}
          >
            {paying
              ? total === 0 ? "신청을 확정하는 중..." : "결제창을 여는 중..."
              : chosen.length === 0
                ? "결제할 항목을 선택해 주세요"
                : total === 0
                  ? "0원으로 신청 확정하기"
                  : won(total) + "원 결제하기"}
          </Button>
        )}

        <p className="text-xs text-gray-500 text-center mt-4">
          인원을 추가하시거나, 다른 과목으로 변경하시려면{" "}
          <a href="/" className="text-red-600 hover:underline">
            신규 신청
          </a>
          으로 진행해 주세요.
        </p>
        <p className="text-xs text-gray-400 text-center mt-1">문의 : 02-6261-8838</p>
      </div>
    </div>
  );
}

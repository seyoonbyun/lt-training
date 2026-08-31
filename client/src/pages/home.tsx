import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { SecondaryProgram } from "@shared/schema";
import Header from "@/components/layout/header";
import Footer from "@/components/layout/footer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { ApplicationTypeModal } from "@/components/application/application-type-modal";
import { Calendar, Clock, User, MapPin, AlertTriangle, ArrowRight, Monitor, Users, ExternalLink } from "lucide-react";
import { TRAINING_SUMMARY_URL, SURVEY_PATH } from "@shared/site-links";
import heroImage from "@assets/Image_fx_1755098115275.jpg";
import heroVideo from "@assets/team_1755249611475.mp4";
import buildingImage from "@assets/화면 캡처 2025-08-11 232105_1754922103429.png";

/**
 * 녹화본(VOD) 열람 칸.
 *
 * 신청자에게 문자·메일로 안내한 **강의실 암호**를 맞혀야 영상 주소가 나온다.
 * ⛔ 주소도 암호도 화면 코드에 없다 — 서버가 확인한 뒤에만 내려준다.
 * ⭐ 새 창을 띄우고 **링크도 화면에 남긴다** (팝업 차단에 막히면 아무것도 안 남는다).
 */
function VodUnlock({ program }: { program: SecondaryProgram }) {
  const [password, setPassword] = useState("");
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/vod/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: program.title, password }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data?.message || "녹화본을 불러오지 못했습니다.");
        return;
      }
      setUrl(data.url);
      window.open(data.url, "_blank", "noopener,noreferrer");
    } catch {
      setError("연결에 실패했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-md border border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-950/20 p-3 space-y-2">
      <div className="flex items-center gap-1.5 text-sm font-semibold text-red-600">
        <Monitor className="w-4 h-4" />
        녹화본(VOD) 시청
      </div>

      {url ? (
        <>
          <p className="text-xs text-muted-foreground">
            새 창이 열리지 않았다면 아래 버튼을 눌러 주세요.
          </p>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
          >
            녹화본 보기
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            신청하실 때 문자·이메일로 안내드린 <strong>열람 비밀번호</strong>를 입력하시면 영상으로 연결됩니다.
          </p>
          <form onSubmit={submit} className="flex gap-2">
            <input
              type="password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(null); }}
              placeholder="열람 비밀번호"
              autoComplete="off"
              /*
                ⛔ dark: 변형을 쓰면 안 된다 — 이 사이트는 <html class="dark"> 로 고정인데
                   색 토큰은 밝은 값 한 벌뿐이라, dark:bg-gray-900 을 걸면 배경만 새까매지고
                   글자는 검은색 그대로라 **입력한 값이 안 보인다**(2026-08-31 지적).
                   화면 전체가 밝은 디자인이므로 흰 바탕·검은 글자로 못박는다.
              */
              className="min-w-0 flex-1 rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 placeholder:text-gray-400 caret-red-600 tracking-[0.15em] focus:outline-none focus:ring-2 focus:ring-red-600/40"
            />
            <Button type="submit" size="sm" disabled={loading || !password.trim()} className="bg-red-600 hover:bg-red-700">
              {loading ? "확인 중…" : "시청하기"}
            </Button>
          </form>
          {error && <p className="text-xs font-medium text-destructive">{error}</p>}
        </>
      )}
    </div>
  );
}

/**
 * 안내 문자·메일 미리보기.
 *
 * 실제로 발송되는 본문과 같은 형태를 보여 주되, **값은 가린다** —
 * 이 페이지는 공개라 VOD 열람비번·강의실 주소를 그대로 실으면
 * "신청자 개별 안내" 가 무의미해진다.
 */
const MASK_PW = "●●●●●●●●";
const MASK_URL = "bnikorea-joy.notion.site/…";

type SampleKind = "confirm" | "reminder" | "refund" | "refundDone";

const SAMPLE_SMS: Record<SampleKind, string> = {
  confirm: `[BNI Korea LT Training]
JOY님, 신청이 완료되었습니다.

▶ LTT : 멤버십 위원회 T.
일시 : 9/8 (화) 18:00 - 21:00 (3시간)
참여 : 실시간 LIVE
강의실 : ${MASK_URL}
VOD 열람비번 : ${MASK_PW}
※ 강의 종료 후 같은 강의실에 녹화본이 올라갑니다

※ 취소·환불 : 수강 시작 3일 전까지 전액 환불, 당일·시작 후 환불 불가
문의 : BNI코리아 내셔널 오피스 02-6261-8838`,
  reminder: `[BNI Korea LT Training]
JOY님, 오늘 교육이 진행됩니다.

▶ LTT : 멤버십 위원회 T.
일시 : 9/8 (화) 18:00 - 21:00 (3시간)
참여 : 실시간 LIVE
강의실 : ${MASK_URL}
VOD 열람비번 : ${MASK_PW}
※ 강의 종료 후 같은 강의실에 녹화본이 올라갑니다

문의 : BNI코리아 내셔널 오피스 02-6261-8838`,
  refund: `[BNI Korea LT Training]
JOY님, 취소·환불 접수가 완료되었습니다.

접수 내역
· 과목 : LTT : 멤버십 위원회 T.
· 대상 : JOY

담당자 확인 후 처리 결과를 안내드립니다.
환불금은 신용카드 승인 취소 후 카드사 정책에 따라 1~2개월,
계좌이체는 승인 후 5~7영업일 내 입금됩니다.

문의 : BNI코리아 내셔널 오피스 02-6261-8838`,
  refundDone: `[BNI Korea LT Training]
JOY님, 요청하신 취소·환불이 처리되었습니다.

취소 내역
· LTT : 멤버십 위원회 T. - JOY

환불금은 결제 수단에 따라 입금됩니다.
· 신용카드 : 승인 취소 후 카드사 정책에 따라 1~2개월 소요
· 계좌이체 : 환불 승인 후 5~7영업일 내 처리

문의 : BNI코리아 내셔널 오피스 02-6261-8838`,
};

const SAMPLE_MAIL: Record<SampleKind, { subject: string; headline: string; intro: string; rows: [string, string][]; cta?: string; notes: string[] }> = {
  confirm: {
    subject: "[BNI Korea LT Training] 신청 완료 안내 — LTT : 멤버십 위원회 T.",
    headline: "JOY님, 신청이 정상적으로 완료되었습니다.",
    intro: "BNI Korea LT Training [LTT : 멤버십 위원회 T.] 강의에 신청해 주셔서 감사합니다. 아래 일정과 입장 정보 확인 후 참석 부탁드립니다.",
    rows: [["일시", "9/8 (화) 18:00 - 21:00 (3시간)"], ["참여", "실시간 LIVE"], ["VOD 열람비번", MASK_PW]],
    cta: "온라인 강의실 입장",
    notes: ["강의 종료 후 같은 강의실에 녹화본이 올라갑니다"],
  },
  reminder: {
    subject: "[BNI Korea LT Training] 오늘 교육 안내 — LTT : 멤버십 위원회 T.",
    headline: "JOY님, 오늘 교육이 진행됩니다.",
    intro: "오늘 진행되는 BNI Korea LT Training [LTT : 멤버십 위원회 T.] 강의 안내입니다. 아래 일정과 입장 정보를 확인해 주세요.",
    rows: [["일시", "9/8 (화) 18:00 - 21:00 (3시간)"], ["참여", "실시간 LIVE"], ["VOD 열람비번", MASK_PW]],
    cta: "온라인 강의실 입장",
    notes: ["강의 종료 후 같은 강의실에 녹화본이 올라갑니다"],
  },
  refund: {
    subject: "[BNI Korea LT Training] 취소 · 환불 접수 확인",
    headline: "JOY님, 취소·환불 접수가 완료되었습니다.",
    intro: "접수하신 내용을 담당자가 확인한 뒤 처리 결과를 안내드립니다.",
    rows: [["과목", "LTT : 멤버십 위원회 T."], ["대상", "JOY"], ["처리", "담당자 확인 후 안내"]],
    notes: ["신용카드는 승인 취소 후 1~2개월, 계좌이체는 5~7영업일 내 입금됩니다"],
  },
  refundDone: {
    subject: "[BNI Korea LT Training] 취소 · 환불 처리 완료",
    headline: "JOY님, 요청하신 취소·환불이 처리되었습니다.",
    intro: "아래 내역으로 취소 처리되었습니다. 환불금은 결제 수단에 따라 입금됩니다.",
    rows: [["과목", "LTT : 멤버십 위원회 T."], ["대상", "JOY"], ["환불", "결제 수단에 따라 입금"]],
    notes: ["신용카드는 승인 취소 후 1~2개월, 계좌이체는 5~7영업일 내 입금됩니다"],
  },
};

/**
 * ⚠ 취소·환불 알림은 **문자만** 나간다(접수 폼 쪽 Apps Script 가 솔라피로만 보낸다).
 *   샘플에 이메일을 같이 그리면 오지 않는 메일을 약속하는 셈이라 문자만 보여 준다.
 */
const SMS_ONLY: SampleKind[] = ["refund", "refundDone"];

function NoticeSample({ kind, label }: { kind: SampleKind; label: string }) {
  const mail = SAMPLE_MAIL[kind];
  const smsOnly = SMS_ONLY.includes(kind);
  return (
    <div className="mt-4 rounded-md border border-gray-200 bg-gray-50/60 p-3">
      <p className="mb-3 text-xs font-semibold text-foreground">
        {label} — 실제 발송 예시{smsOnly ? ' (문자)' : ''}
      </p>
      <div className={`grid grid-cols-1 gap-3 ${smsOnly ? '' : 'md:grid-cols-2'}`}>
        {/* 문자 */}
        <div className="rounded-md border border-gray-200 bg-white p-3">
          <p className="mb-2 text-[11px] font-semibold text-muted-foreground">문자 (LMS)</p>
          <pre className="whitespace-pre-wrap break-words font-sans text-[11px] leading-relaxed text-foreground">
            {SAMPLE_SMS[kind]}
          </pre>
        </div>

        {/* 이메일 */}
        {!smsOnly && (
        <div className="rounded-md border border-gray-200 bg-white overflow-hidden">
          <div className="border-b border-gray-200 px-3 py-2">
            <p className="text-[11px] font-semibold text-muted-foreground">이메일</p>
            <p className="mt-1 text-[11px] text-foreground break-words">{mail.subject}</p>
            <p className="text-[10px] text-muted-foreground">보낸사람 : BNI Korea LT Training &lt;hq@joy-bnikorea.com&gt;</p>
          </div>
          <div className="border-t-4 border-[#c41324] p-3">
            <p className="text-[10px] tracking-wider text-gray-400">BNI Korea LT Training</p>
            <p className="mt-1 text-[13px] font-bold text-foreground">{mail.headline}</p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{mail.intro}</p>
            <div className="mt-2 rounded border border-gray-200 border-l-[3px] border-l-[#c41324] p-2">
              <p className="text-[12px] font-bold text-foreground">LTT : 멤버십 위원회 T.</p>
              <table className="mt-1 text-[11px] leading-relaxed">
                <tbody>
                  {mail.rows.map(([k, v]) => (
                    <tr key={k}>
                      <td className="pr-3 align-top whitespace-nowrap text-muted-foreground">{k}</td>
                      <td className="align-top text-foreground">{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {mail.cta && (
                <span className="mt-2 inline-block rounded bg-[#c41324] px-3 py-1.5 text-[11px] font-bold text-white">
                  {mail.cta} →
                </span>
              )}
              {mail.notes.map((n) => (
                <p key={n} className="mt-1.5 text-[10px] text-muted-foreground">※ {n}</p>
              ))}
            </div>
            <p className="mt-2 text-[10px] text-muted-foreground">
              하단에 <strong className="text-foreground">강의 이수 신청</strong> · <strong className="text-foreground">취소 · 환불 접수</strong> 버튼과 취소·환불 규정이 함께 담깁니다.
            </p>
          </div>
        </div>
        )}
      </div>
      <p className="mt-2 text-[10px] text-muted-foreground">
        {smsOnly
          ? '※ 취소·환불 안내는 문자로 발송됩니다.'
          : '※ 메일이 바로 확인이 안되시면 스팸함을 확인해주세요!'}
      </p>
    </div>
  );
}

/**
 * 신청 안내 Q&A. 예전엔 불릿 7줄을 한 번에 펼쳐 놓았는데 아무도 끝까지 읽지 않아
 * 묻는 형태로 바꿔 접어 두었다. 문구를 고칠 일이 잦아 화면 밖으로 뺀다.
 */
const NOTICE_QA: { q: string; a: React.ReactNode }[] = [
  {
    q: "신청은 어떻게 하나요?",
    a: "위 캘린더에서 일정을 확인하신 뒤 「신청하기」를 눌러 신청서를 작성해 주세요. 신청서 작성 후 이어지는 결제까지 마치셔야 신청이 완료됩니다.",
  },
  {
    q: "여러 과목을 한 번에 신청할 수 있나요?",
    a: "네. 개별 신청에서 원하시는 과목을 여러 개 함께 고르실 수 있고, 선택하신 과목 합계로 한 번에 결제됩니다.",
  },
  {
    q: "챕터에서 여러 명을 대신 신청하려면?",
    a: (
      <>
        「챕터 일괄 신청」을 이용해 주세요. 과목을 고르시면 그 과목을 수강할 분들의 명단을 적는 칸이 열리고,
        전체 합계로 한 번에 결제됩니다. 수강자는 <strong className="text-foreground">성명만 필수</strong>이며
        연락처·이메일은 선택입니다. 다만 연락처·이메일을 남기신 분에게만 안내 문자와 메일이 발송됩니다.
      </>
    ),
  },
  {
    q: "일괄 신청 시 지역·챕터는 어떻게 기록되나요?",
    a: (
      <>
        <strong className="text-foreground">결제자 정보에 입력하신 지역·챕터</strong>가 명단 전원의 소속으로 기록됩니다.
        이미 신청된 분은 해당 과목만 자동으로 제외되고 그만큼 금액도 줄어듭니다.
      </>
    ),
  },
  {
    q: "실시간에 참여하지 못하면 어떻게 하나요?",
    a: (
      <>
        모든 세션은 녹화본(VOD) 시청으로도 참여하실 수 있습니다. 일정에 맞는 방식을 택1하여 신청해 주세요.
        녹화본은 강의 익일부터 온라인 강의실에서 보실 수 있으며, 신청 시 안내 문자·메일이 동일하게 발송됩니다.
        <NoticeSample kind="confirm" label="결제 완료 안내" />
      </>
    ),
  },
  {
    q: "녹화본으로 참여하면 이수 처리는 어떻게 되나요?",
    a: (
      <>
        <strong className="text-foreground">Training Summary 제출이 필수</strong>입니다. 제출하셔야 이수하신 것으로 등록됩니다.
        위의 「강의 이수 신청」에서 제출해 주세요.
      </>
    ),
  },
  {
    q: "온라인 강의실은 어떻게 들어가나요?",
    a: (
      <>
        결제가 완료되면 문자와 이메일로 온라인 강의실 링크와 VOD 열람비번을 보내드립니다.
        트레이닝 <strong className="text-foreground">당일 오전 10시</strong>에 한 번 더 안내드립니다.
        <NoticeSample kind="confirm" label="결제 완료 안내" />
        <NoticeSample kind="reminder" label="트레이닝 당일 안내" />
      </>
    ),
  },
  {
    q: "신청을 취소하고 환불받으려면?",
    a: (
      <>
        수강 시작 3일 전까지 요청하시면 전액 환불됩니다. 수강 시작일 당일과 강의 시작 후에는 환불이 불가합니다.
        페이지 맨 아래 「취소 · 환불 접수」에서 신청해 주세요. 접수되면 확인 안내가 발송되고,
        담당자 처리(영업일 기준 48시간 이내)가 끝나면 완료 안내를 한 번 더 보내드립니다.
        <NoticeSample kind="refund" label="① 접수 즉시 — 접수 확인" />
        <NoticeSample kind="refundDone" label="② 담당자 처리 후 — 환불 완료" />
      </>
    ),
  },
];

export default function Home() {
  const [, setLocation] = useLocation();
  const [isApplicationModalOpen, setIsApplicationModalOpen] = useState(false);
  // 캘린더에서 클릭한 세션. 값이 있으면 정보 모달이 열린다.
  const [detailProgram, setDetailProgram] = useState<SecondaryProgram | null>(null);

  const { 
    data: programs = [], 
    isLoading, 
    error 
  } = useQuery<SecondaryProgram[]>({
    queryKey: ["/api/secondary-programs"],
    refetchInterval: 20000, // 20초마다 업데이트 (안전하고 실용적인 실시간 동기화)
    staleTime: 15000, // 15초간 캐시 유지
    gcTime: 45000, // 45초간 백그라운드 캐시 유지
    refetchOnMount: true, // 마운트 시 항상 새로 불러오기
    refetchOnWindowFocus: true, // 윈도우 포커스 시 새로 불러오기
  });

  // 신청 상태 확인 (마감 여부)
  const { 
    data: applicationStatus = {} 
  } = useQuery<{ [title: string]: boolean }>({
    queryKey: ["/api/application-status"],
    refetchInterval: 20000, // 20초마다 업데이트 (안전하고 실용적인 실시간 동기화)
    staleTime: 15000, // 15초간 캐시 유지
  });

  // 신청은 하단 CTA 한 곳에서만 시작한다. 과목 선택은 신청서 안에서 한다.
  const handleApplyClick = () => {
    setDetailProgram(null);
    setIsApplicationModalOpen(true);
  };

  // 신청 마감 여부 확인 함수
  const isApplicationClosed = (programTitle: string) => {
    return applicationStatus[programTitle] === false;
  };

  const renderDescription = (description: string, programTitle: string) => {
    if (!description) return "";
    
    if (programTitle.includes('파운데이션') && description.includes('온라인 강의실')) {
      return description.replace(
        '온라인 강의실',
        '<a href="https://www.notion.so/bnikorea-joy/LT-T_-e464035f91024e29b5fceb805b92ce2a?source=copy_link" target="_blank" class="underline text-red-600 hover:opacity-75">온라인 강의실</a>'
      );
    }
    
    return description;
  };

  // ── 캘린더 ────────────────────────────────────────────────────────────────
  // 세션 날짜를 서울 기준 YYYY-MM-DD 로 정규화한다. 보는 사람의 타임존과 무관하게
  // 늘 같은 칸에 찍히도록 formattedDate 를 Asia/Seoul 로 환산해서 쓴다.
  const seoulYmd = (program: SecondaryProgram): string | null => {
    if (program.formattedDate) {
      const parsed = new Date(program.formattedDate);
      if (!isNaN(parsed.getTime())) {
        return parsed.toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
      }
    }
    // formattedDate 가 비면 "9/18 (금)" 표기에서 월/일만 뽑는다
    const matched = (program.date || '').match(/(\d{1,2})\s*\/\s*(\d{1,2})/);
    if (!matched) return null;
    const year = new Date().getFullYear();
    return `${year}-${matched[1].padStart(2, '0')}-${matched[2].padStart(2, '0')}`;
  };

  // 오늘(서울) 기준으로 이미 지난 과목인지.
  // ⭐ 지난 과목이라고 캘린더에서 흐리게 만들지 않는다 — VOD 신청자가 이 칸을 눌러
  //    녹화본을 보는 통로이기 때문이다. 신청서의 과목 목록에서만 빠진다.
  const todaySeoul = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
  const isPastProgram = (program: SecondaryProgram) => {
    const ymd = seoulYmd(program);
    return !!ymd && ymd < todaySeoul;
  };

  const sessionsByDate = new Map<string, SecondaryProgram[]>();
  programs.forEach((program) => {
    const key = seoulYmd(program);
    if (!key) return;
    const bucket = sessionsByDate.get(key);
    if (bucket) bucket.push(program);
    else sessionsByDate.set(key, [program]);
  });

  // 달을 나누지 않고 한 장으로 잇는다. 첫 세션이 있는 주의 일요일부터
  // 마지막 세션이 있는 주의 토요일까지를 그대로 이어 붙인 격자다.
  const sessionDates = Array.from(sessionsByDate.keys()).sort();
  const toDate = (ymd: string) => {
    const [year, month, day] = ymd.split('-').map(Number);
    return new Date(year, month - 1, day);
  };
  const toYmd = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

  const calendarCells: string[] = [];
  if (sessionDates.length > 0) {
    const cursor = toDate(sessionDates[0]);
    cursor.setDate(cursor.getDate() - cursor.getDay()); // 그 주의 일요일로

    const last = toDate(sessionDates[sessionDates.length - 1]);
    last.setDate(last.getDate() + (6 - last.getDay())); // 그 주의 토요일까지

    while (cursor <= last) {
      calendarCells.push(toYmd(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
  }

  const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];

  const shortTitle = (title: string) => title.replace(/^LTT\s*:\s*/, '').trim();

  /**
   * 시간 표기를 `12:00-17:00(5시간)` 한 형태로 맞춘다.
   * 시트에 `13:00~17:00(4시간)` · `18:00 - 21:00 (3시간)` 처럼 제각각 들어와 있어
   * 그대로 쓰면 칸마다 모양이 달라진다. 값은 바꾸지 않고 구분자와 공백만 정리한다.
   */
  const shortTime = (time: string) =>
    (time || '')
      .replace(/\s*[~–—]\s*/g, '-')
      .replace(/\s*-\s*/g, '-')
      .replace(/\s*\(\s*/g, '(')
      .replace(/\s*\)\s*/g, ')')
      .trim();

  /**
   * 캘린더 칸에 넣을 이름. 칸이 40~50px 뿐이라 짧게 줄여 **단어별로 줄바꿈**한다.
   *   `이벤트 코디네이터 T.` → `이벤트` / `코디`
   *   `멤버십 위원회 T.`     → `멤버십` / `위원회`
   * 꼬리의 `T.` 는 모든 과목에 붙어 있어 정보가 없으므로 뗀다.
   */
  const CHIP_ABBR: [RegExp, string][] = [[/코디네이터/g, '코디']];

  const chipTitleLines = (title: string) => {
    let clean = shortTitle(title).replace(/\s*T\.?\s*$/, '').trim();
    for (const [pattern, replacement] of CHIP_ABBR) clean = clean.replace(pattern, replacement);

    // 단어별로 한 줄. 그래도 긴 단어는 3글자씩 끊는다.
    const lines: string[] = [];
    for (const word of clean.split(/\s+/).filter(Boolean)) {
      if (word.length <= 3) lines.push(word);
      else for (let i = 0; i < word.length; i += 3) lines.push(word.slice(i, i + 3));
    }
    return lines;
  };

  const renderCalendar = () => (
    <div className="rounded-lg border border-red-200 dark:border-red-800 bg-card overflow-hidden">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 px-4 py-3 border-b border-red-200 dark:border-red-800">
        <div className="min-w-0 space-y-2">
          <h3 className="text-lg font-bold text-foreground">2026 BNI Korea Leadership Training</h3>
          <div className="space-y-1 text-sm text-muted-foreground">
            {/* PC에서는 한 줄로, 좁은 화면에서만 줄을 나눈다 */}
            <p>
              26년 8/27 (목) 부터 - 9/18 (금) 까지, 총 10일간, 총 27시간 분량의 10개의 세션으로 구성되어있으며
              <br className="md:hidden" />{' '}
              각 트레이닝 종료 후 익일 오후 1시 부터, '온라인 강의실'을 통해 녹화본을 시청하실 수 있습니다.
            </p>
            <p className="text-xs">
              * 녹화본 영상이 업로드 되는대로, 참가 신청해주신 대표님들(한정)께 'VOD 열람비번'이 발송됩니다 :)
            </p>
          </div>
        </div>

        {/* 범례 — 안내문 칸 우측 아래. 줄이 바뀌어도 오른쪽에 붙는다 */}
        <div className="ml-auto flex flex-wrap items-center justify-end gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-sm bg-red-600" />
            오프라인
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-sm border border-red-400" />
            온라인
          </span>
          <span>일정을 클릭하면 세션 정보가 열립니다</span>
        </div>
      </div>

      <div className="grid grid-cols-7 border-b border-gray-200 dark:border-gray-700">
        {WEEKDAY_LABELS.map((label, index) => (
          <div
            key={label}
            className={`py-2 text-center text-xs font-semibold ${
              index === 0 ? 'text-red-600' : index === 6 ? 'text-blue-600' : 'text-muted-foreground'
            }`}
          >
            {label}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {calendarCells.map((ymd, index) => {
          const daySessions = sessionsByDate.get(ymd) ?? [];
          const dayFormats = Array.from(
            new Set(daySessions.map((p) => (p.format === '오프라인' ? '오프라인' : '온라인')))
          );
          const weekday = index % 7;
          const day = Number(ymd.slice(8));
          const month = Number(ymd.slice(5, 7));

          return (
            <div
              key={ymd}
              className={`flex min-w-0 flex-col overflow-hidden min-h-[72px] md:aspect-[6/5] md:min-h-[88px] p-1 border-b border-gray-100 dark:border-gray-800 ${
                weekday === 6 ? '' : 'border-r'
              } ${daySessions.length === 0 ? 'bg-gray-50/40 dark:bg-gray-900/20' : ''}`}
            >
              <div className="flex min-w-0 items-center justify-between gap-1 px-1 mb-1">
                {/* 월/일을 늘 함께 적는다. 8월과 9월이 한 표에 섞여 있어 일자만으론 헷갈린다 */}
                <span
                  className={`${
                    /* 강의가 있는 날은 날짜부터 눈에 들어와야 한다.
                       단 모바일에선 칸이 좁아 키우면 오히려 답답해져 그대로 둔다 */
                    daySessions.length > 0 ? 'text-[11px] md:text-[15px] font-bold' : 'text-[11px]'
                  } ${
                    weekday === 0 ? 'text-red-600' : weekday === 6 ? 'text-blue-600' : 'text-muted-foreground'
                  } ${day === 1 && daySessions.length === 0 ? 'font-semibold' : ''}`}
                >
                  {month}/{day}
                </span>
                {/* 색만으로는 안 읽히니 그날 세션의 진행 방식을 글자로도 적는다 */}
                {dayFormats.length > 0 && (
                  <span className="hidden md:inline shrink-0 text-[10px] font-bold tracking-wide text-red-600">
                    {dayFormats.join(' · ')}
                  </span>
                )}
              </div>

              <div className="flex flex-1 flex-col gap-1 min-h-0">
                {daySessions.map((program) => {
                  const isOffline = program.format === '오프라인';
                  const past = isPastProgram(program);
                  // 지난 과목은 흐리게 하지 않는다(VOD 통로). 아직 안 온 과목을 닫았을 때만 흐리게.
                  const closed = !past && (!program.isAvailable || isApplicationClosed(program.title));

                  return (
                    <button
                      key={program.id}
                      type="button"
                      onClick={() => setDetailProgram(program)}
                      title={`${program.sessionNumber} · ${program.title}`}
                      className={`flex w-full min-w-0 flex-1 flex-col items-center justify-center gap-0.5 overflow-hidden text-center rounded px-1 py-1 md:px-1.5 md:py-1.5 leading-tight transition-colors ${
                        isOffline
                          ? 'bg-red-600 text-white hover:bg-red-700'
                          : 'border border-red-400 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40'
                      } ${closed ? 'opacity-50' : ''}`}
                    >
                      {/*
                        모바일은 한 칸이 40~50px 뿐이다. 자르지 말고 칸 폭에 맞춰 줄바꿈한다.
                        한글은 기본 규칙으로는 잘 안 꺾여서 break-all 로 글자 단위로 끊는다
                        (`파운데이션` → `파운` / `데이션`).
                      */}
                      <span className="md:hidden block w-full text-[9px] font-bold leading-[1.2]">
                        {chipTitleLines(program.title).map((line, i) => (
                          <span key={i} className="block">
                            {line}
                          </span>
                        ))}
                      </span>
                      {/* 과목명이 주인공 — 나머지는 한 단계 낮춘다 */}
                      <span className="hidden md:block w-full min-w-0 text-[15px] font-extrabold leading-snug truncate">
                        {shortTitle(program.title)}
                      </span>
                      <span className="hidden md:block w-full min-w-0 text-[11px] opacity-80 truncate">
                        {shortTime(program.time)}
                      </span>
                      {program.instructor && (
                        <span className="hidden md:block w-full min-w-0 text-[11px] opacity-70 truncate">
                          {program.instructor}
                        </span>
                      )}
                      {/*
                        지난 과목은 칸 모양이 다가올 과목과 똑같아 혼란스럽다(2026-08-31 지적).
                        흐리게 만드는 대신 **여기가 녹화본 통로**라고 적는다.
                        모바일은 칸이 40~50px 뿐이라 `VOD` 세 글자만 쓴다.
                      */}
                      {past && (
                        <span
                          className={`mt-0.5 inline-block rounded px-1 py-px text-[8px] md:text-[10px] font-bold leading-tight ${
                            isOffline ? 'bg-white/25 text-white' : 'bg-red-600/10 text-red-600'
                          }`}
                        >
                          <span className="md:hidden">{program.hasVod ? 'VOD' : '종료'}</span>
                          <span className="hidden md:inline">{program.hasVod ? 'VOD 시청' : '교육 종료'}</span>
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  // 세션 정보 모달의 본문. 카드에 있던 내용을 그대로 옮겼고, 설명은 접지 않고 전문을 보여준다.
  const renderProgramDetail = (program: SecondaryProgram) => (
    <div className="space-y-4">
      {/* 날짜 및 시간 */}
      <div className="flex items-center gap-2 text-sm">
        <Calendar className="w-4 h-4" style={{ color: 'hsl(348 85% 47%)' }} />
        <span className="font-medium">{program.date}</span>
        <Clock className="w-4 h-4 ml-2" style={{ color: 'hsl(348 85% 47%)' }} />
        <span className="font-medium">{program.time}</span>
      </div>

      {/* 강사 */}
      {program.instructor && (
        <div className="flex items-center gap-2 text-sm">
          <User className="w-4 h-4" style={{ color: 'hsl(348 85% 47%)' }} />
          <span className="font-medium">{program.instructor}</span>
        </div>
      )}

      {/* 장소 — H열(오프라인 장소)에 지도 URL이 있으면 장소명을 그 링크로 건다 */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm">
          <MapPin className="w-4 h-4 text-red-600 flex-shrink-0" />
          {program.venueUrl ? (
            <a
              href={program.venueUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-800 hover:text-red-600 underline"
            >
              {program.location}
            </a>
          ) : program.classroomUrl ? (
            <a
              href={program.classroomUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-red-600 hover:opacity-75 underline"
            >
              {program.location}
            </a>
          ) : program.notionUrl ? (
            <a
              href={program.notionUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-red-600 hover:opacity-75 underline"
            >
              {program.location}
            </a>
          ) : (
            <span className="text-muted-foreground">{program.location}</span>
          )}
        </div>

        {/* 진행 방식 안내 */}
        {program.format !== '오프라인' && (
          <div className="p-3 border border-red-600 rounded-md text-xs text-red-600 space-y-1">
            <div>
              1차: <Monitor className="w-3 h-3 inline" /> LIVE 진행 (1시간 전 링크 게시)
            </div>
            <div>2차: VOD 녹화본 (익일 오후1시)</div>
            <div className="pt-1 border-t border-red-300">
              ※ VOD 열람비번 : 신청자 개별 안내
            </div>
          </div>
        )}

        {program.format === '오프라인' && (
          <div className="p-3 border border-red-600 rounded-md text-xs text-red-600 space-y-1">
            <div>1차: 오프라인 현장 강의</div>
            <div className="flex items-center gap-1 flex-wrap">
              <span>2차:</span>
              {/* 녹화본이 올라온 과목은 링크를 걸지 않는다 — 바로 아래 VOD 칸이 통로다.
                  두 군데로 갈리면 비번 없이 들어갔다가 못 보고 돌아간다. */}
              {program.classroomUrl && !program.hasVod ? (
                <a
                  href={program.classroomUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-800 hover:opacity-75 underline inline-flex items-center gap-0.5"
                >
                  <Monitor className="w-3 h-3 text-blue-800 flex-shrink-0" />
                  온라인 참가
                </a>
              ) : (
                <span className="inline-flex items-center gap-0.5">
                  <Monitor className="w-3 h-3 flex-shrink-0" />
                  온라인 참가
                </span>
              )}
              <span>(VOD : 익일 오후3시 업로드)</span>
            </div>
            <div className="pt-1 border-t border-red-300">
              ※ VOD 열람비번 : 신청자 개별 안내
            </div>
          </div>
        )}
      </div>

      {/* 녹화본이 올라온 과목이면 여기서 바로 본다. 지난 과목의 캘린더 칸이
          VOD 신청자에게는 이 통로다 — 그래서 지난 과목도 캘린더에 그대로 남긴다. */}
      {program.hasVod && <VodUnlock key={program.id} program={program} />}

      {/* 설명 */}
      {program.description ? (
        <div
          className="text-sm text-foreground leading-relaxed"
          dangerouslySetInnerHTML={{ __html: renderDescription(program.description, program.title) }}
        />
      ) : (
        <p className="text-sm text-muted-foreground">설명이 없습니다.</p>
      )}

      {/* 신청자 정보 (결제완료 기준) */}
      <div className="flex items-center justify-between text-sm pt-2 border-t border-gray-200 dark:border-gray-700">
        <span className="text-red-600 font-medium flex items-center gap-1">
          <Users className="w-4 h-4" />
          신청자: {String(program.completedCount || 0).padStart(2, '0')}명 /{' '}
          {program.title.includes('파운데이션') ? '400' : '100'}명
        </span>
        <div className="w-full max-w-[100px] bg-gray-200 dark:bg-gray-700 rounded-full h-2 ml-3">
          <div
            className="bg-red-600 h-2 rounded-full transition-all"
            style={{
              width: `${Math.min(
                ((program.completedCount || 0) / (program.title.includes('파운데이션') ? 400 : 100)) * 100,
                100
              )}%`,
            }}
          />
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      <Header />
      
      <main>
        {/* Hero Section */}
        <section className="relative min-h-[60vh] md:min-h-[80vh] flex items-center justify-center overflow-hidden">
          {/* Background Video */}
          <video
            className="absolute inset-0 w-full h-full object-cover pointer-events-none"
            autoPlay
            loop
            muted
            playsInline
          >
            <source src={heroVideo} type="video/mp4" />
            {/* Fallback to image if video fails to load */}
            <div 
              className="absolute inset-0 w-full h-full"
              style={{
                backgroundImage: `url(${heroImage})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                backgroundRepeat: 'no-repeat'
              }}
            />
          </video>
          
          {/* Dark overlay for better text readability */}
          <div className="absolute inset-0 bg-black bg-opacity-40 pointer-events-none"></div>
          
          {/* Hero Content */}
          <div className="relative z-10 text-center text-white px-4 max-w-4xl mx-auto">
            <h1 className="text-5xl md:text-7xl lg:text-8xl font-black mb-6 leading-none tracking-tight" style={{ fontFamily: 'Arial, Helvetica, sans-serif', fontWeight: '900' }}>
              2026 BNI Korea
              <br />
              Leadership
              <br />
              Training
            </h1>
            
            <div className="space-y-1 text-xs md:text-xs lg:text-sm max-w-lg mx-auto" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
              <p className="font-medium">
                BNI Korea Leadership Team : 우리는 함께합니다.
              </p>
              <p className="font-normal">
                혼자서는 할 수 없는 기적같은 성취가 날마다 일어나는 곳.
              </p>
              <p className="font-normal">
                각 전문분야의 최고 전문가 CEO들의 협업 커뮤니티
              </p>
              <p className="font-normal mb-4">
                대한민국에서 비즈니스하는 모두에게 이런 기적이 일상이 되는 그날까지 !
              </p>
              <p className="italic text-gray-300 text-xs">
                a group of expert thinker and doers across a wide range of fields to help share new ideas
              </p>
            </div>
          </div>
        </section>

        {/* Programs Section */}
        <section className="pt-16 pb-8 bg-background">
          <div className="container mx-auto px-4">
            <div className="text-center mb-12">
              <h2 className="text-3xl md:text-4xl font-bold mb-4 text-foreground">Business Leadership Program</h2>
              <div className="text-muted-foreground max-w-4xl mx-auto space-y-4" style={{ fontSize: '17px' }}>
                <p className="font-semibold">
                  2026년 병오년 하반기 BNI 코리아 리더를 위해 마련된 비즈니스 리더십 프로그램
                </p>
              </div>
            </div>

            {/* Accelerate 2026 — 캘린더 바로 위 */}
            <div className="border-l-4 border-red-600 bg-white dark:bg-white p-6 mb-8 rounded-lg hover:shadow-xl hover:shadow-red-100/50 dark:hover:shadow-red-900/20 transition-all duration-300 transform hover:-translate-y-2 hover:scale-[1.02]">
              <h2 className="text-2xl md:text-3xl font-bold mb-4 text-foreground">Accelerate 2026</h2>
              <div className="space-y-4 text-foreground">
                <p>
                  BNI 코리아 리더십 트레이닝 프로그램은 2026 하반기에 각 챕터의 리더로 활동하실 전국 BNI 리더십 팀 대표님들이 모두 참여하셔서 함께 소통하며 참여하는 형식의 트레이닝으로, 서로 교류하고 소통하며 BNI에서의 활동 방식, 노하우, 리더로서의 올바른 방향성에 대해 고민할 수 있는 자리입니다.
                </p>
                <div className="space-y-2">
                  <p className="font-semibold">4000명의 멤버를 맞이하게 될 BNI 코리아의 2026년 !</p>
                  <p>그 빛나는 시작을 전국의 BNI 코리아 리더십 트레이닝과 함께 하세요 :)</p>
                </div>
              </div>
            </div>

            {error && (
              <Alert className="mb-8 bg-red-50 border-red-200">
                <AlertTriangle className="h-4 w-4 text-red-600" />
                <AlertDescription className="text-red-700">
                  프로그램 데이터를 불러오는데 실패했습니다. Google Sheets 연결을 확인해주세요.
                </AlertDescription>
              </Alert>
            )}

            {isLoading ? (
              <Skeleton className="h-[560px] rounded-lg" />
            ) : calendarCells.length === 0 ? (
              <p className="py-12 text-center text-muted-foreground">등록된 일정이 없습니다.</p>
            ) : (
              <div className="space-y-8">
                {/* 전 트레이닝 일정 — 달을 나누지 않고 한 장으로 */}
                {renderCalendar()}

                {/* 신청 CTA — 신청은 여기 한 곳에서만 시작한다 */}
                <div className="text-center space-y-3 pt-2">
                  <Button
                    size="lg"
                    onClick={handleApplyClick}
                    className="w-full h-14 text-base font-semibold bg-red-600 hover:bg-red-700"
                  >
                    신청하기
                    <ArrowRight className="w-5 h-5 ml-2" />
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    신청서 한 번으로 원하는 과목을 여러 개 담아 한 번에 결제하실 수 있습니다.
                    <br />
                    ※ 신청자 카운트 = 결제완료 기준
                  </p>

                  {/* 이수 신청 — Training Summary 제출처. 신청 CTA 와 성격이 달라 톤을 낮춘다 */}
                  <a
                    href={TRAINING_SUMMARY_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center w-full h-12 rounded-md border border-red-600 px-6 text-base font-semibold text-red-600 hover:bg-red-600 hover:text-white transition-colors"
                  >
                    강의 이수 신청
                    <ExternalLink className="w-4 h-4 ml-2" />
                  </a>

                  {/*
                    만족도 설문 — 교육이 끝나면 문자로도 나가지만, 강의실에서 화면을 띄워
                    바로 찍을 수 있게 QR 을 같이 둔다.
                    ⭐ QR·링크 모두 우리 도메인 `/survey` 다. 서버가 그날 과목을 채워 넘기므로
                       과목이 바뀌어도 이 이미지를 다시 만들지 않는다.
                  */}
                  <a
                    href={SURVEY_PATH}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 flex items-center gap-4 rounded-lg border border-gray-200 bg-white p-4 text-left transition-all hover:border-red-300 hover:shadow-md"
                  >
                    <img
                      src="/survey-qr.svg"
                      alt="교육 만족도 설문 QR 코드"
                      width={96}
                      height={96}
                      className="h-24 w-24 flex-shrink-0 rounded border border-gray-100 bg-white"
                    />
                    <span className="min-w-0">
                      <span className="block text-base font-semibold text-foreground">교육 만족도 설문</span>
                      <span className="mt-1 block text-sm text-muted-foreground">
                        QR 을 찍거나 이 칸을 눌러 주세요. 수강하신 과목은 자동으로 채워집니다. (1분)
                      </span>
                    </span>
                  </a>
                </div>
              </div>
            )}
          </div>
        </section>
        {/* 안내 — 자주 묻는 것을 아코디언으로. 한 화면에 다 늘어놓으면 아무도 안 읽는다 */}
        <section className="pb-8">
          <div className="container mx-auto px-4">
            <div className="rounded-lg border border-red-200 bg-gray-50/70 p-6">
              <div className="flex items-start gap-3 mb-4">
                <div className="w-8 h-8 bg-red-600 rounded-lg flex items-center justify-center flex-shrink-0">
                  <AlertTriangle className="h-4 w-4 text-white" />
                </div>
                <div>
                  <h3 className="font-semibold text-lg">신청 안내</h3>
                  <p className="text-sm text-muted-foreground">리더십 트레이닝 참가 전 확인해 주세요</p>
                </div>
              </div>

              {/* 항목마다 카드로 띄운다. 줄만 그으면 어디를 눌러야 할지 안 보인다 */}
              <Accordion type="single" collapsible className="w-full space-y-2.5">
                {NOTICE_QA.map((qa, i) => (
                  <AccordionItem
                    key={qa.q}
                    value={`qa-${i}`}
                    className="rounded-lg border border-gray-200 bg-white shadow-sm transition-all hover:shadow-md hover:border-red-300 data-[state=open]:border-red-400 data-[state=open]:shadow-md"
                  >
                    <AccordionTrigger className="px-4 py-3.5 text-left text-sm font-semibold hover:no-underline [&[data-state=open]>svg]:text-red-600">
                      <span className="flex items-start gap-2.5">
                        <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-red-50 text-[11px] font-bold text-red-600">
                          Q
                        </span>
                        <span>{qa.q}</span>
                      </span>
                    </AccordionTrigger>
                    <AccordionContent className="px-4 pb-4 text-sm leading-relaxed text-muted-foreground">
                      <div className="border-t border-gray-100 pt-3">{qa.a}</div>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </div>
          </div>
        </section>

      </main>

      <Footer />

      {/* 캘린더에서 클릭한 세션의 정보 모달. 신청 버튼은 두지 않는다 — 신청은 하단 CTA 한 곳에서만 */}
      <Dialog open={!!detailProgram} onOpenChange={(open) => { if (!open) setDetailProgram(null); }}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          {detailProgram && (
            <>
              <DialogHeader className="space-y-2 pr-8">
                <div className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className="bg-white dark:bg-white border"
                    style={{ borderColor: 'hsl(348 85% 47%)', color: 'hsl(348 85% 47%)' }}
                  >
                    {detailProgram.sessionNumber}
                  </Badge>
                  <Badge
                    variant={
                      !isPastProgram(detailProgram)
                        && detailProgram.isAvailable
                        && !isApplicationClosed(detailProgram.title)
                        ? 'default'
                        : 'secondary'
                    }
                  >
                    {/* 지난 과목에 "신청마감" 만 띄우면 녹화본을 보러 온 분이 돌아간다 */}
                    {isPastProgram(detailProgram)
                      ? (detailProgram.hasVod ? '교육 종료 · 녹화본 시청 가능' : '교육 종료')
                      : detailProgram.isAvailable && !isApplicationClosed(detailProgram.title)
                        ? '신청가능'
                        : '신청마감'}
                  </Badge>
                  {/* 실시간만 마감된 과목. "마감" 한 마디로 끝내면 녹화본으로는
                      신청할 수 있다는 걸 모른 채 돌아간다. */}
                  {!isPastProgram(detailProgram)
                    && detailProgram.isAvailable
                    && !isApplicationClosed(detailProgram.title)
                    && detailProgram.isLiveAvailable === false && (
                    <Badge variant="secondary">실시간 마감 · 녹화본 신청 가능</Badge>
                  )}
                </div>
                <DialogTitle className="text-xl leading-tight text-left">
                  {detailProgram.title}
                </DialogTitle>
              </DialogHeader>

              {renderProgramDetail(detailProgram)}
            </>
          )}
        </DialogContent>
      </Dialog>

      <ApplicationTypeModal
        isOpen={isApplicationModalOpen}
        onClose={() => setIsApplicationModalOpen(false)}
        programs={programs}
      />
    </div>
  );
}
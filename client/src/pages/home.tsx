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
import { ApplicationTypeModal } from "@/components/application/application-type-modal";
import { Calendar, Clock, User, MapPin, AlertTriangle, ArrowRight, Monitor, Users } from "lucide-react";
import heroImage from "@assets/Image_fx_1755098115275.jpg";
import heroVideo from "@assets/team_1755249611475.mp4";
import buildingImage from "@assets/화면 캡처 2025-08-11 232105_1754922103429.png";

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
  const shortTime = (time: string) => (time || '').replace(/\s*\(.*?\)\s*/g, '').trim();

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
              * 녹화본 영상이 업로드 되는대로, 참가 신청해주신 대표님들(한정)께 '온라인 강의실 입장 암호'가 발송됩니다 :)
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
          const weekday = index % 7;
          const day = Number(ymd.slice(8));
          const month = Number(ymd.slice(5, 7));

          return (
            <div
              key={ymd}
              className={`min-h-[84px] md:min-h-[112px] p-1 border-b border-gray-100 dark:border-gray-800 ${
                weekday === 6 ? '' : 'border-r'
              } ${daySessions.length === 0 ? 'bg-gray-50/40 dark:bg-gray-900/20' : ''}`}
            >
              <div
                className={`px-1 mb-1 text-[11px] ${
                  weekday === 0 ? 'text-red-600' : weekday === 6 ? 'text-blue-600' : 'text-muted-foreground'
                }`}
              >
                {/* 달이 바뀌는 1일에만 월을 같이 적어 8월과 9월이 구분된다 */}
                {day === 1 ? <span className="font-semibold">{month}월 1</span> : day}
              </div>

              <div className="space-y-1">
                {daySessions.map((program) => {
                  const isOffline = program.format === '오프라인';
                  const closed = !program.isAvailable || isApplicationClosed(program.title);

                  return (
                    <button
                      key={program.id}
                      type="button"
                      onClick={() => setDetailProgram(program)}
                      title={`${program.sessionNumber} · ${program.title}`}
                      className={`w-full text-left rounded px-1.5 py-1 leading-tight transition-colors ${
                        isOffline
                          ? 'bg-red-600 text-white hover:bg-red-700'
                          : 'border border-red-400 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40'
                      } ${closed ? 'opacity-50' : ''}`}
                    >
                      <span className="block text-[10px] md:text-xs font-semibold truncate">
                        {shortTitle(program.title)}
                      </span>
                      <span className="hidden md:block text-[10px] opacity-80 truncate">
                        {shortTime(program.time)}
                      </span>
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
              ※ 온라인 강의실 입장 PW: 신청자 개별 안내
            </div>
          </div>
        )}

        {program.format === '오프라인' && (
          <div className="p-3 border border-red-600 rounded-md text-xs text-red-600 space-y-1">
            <div>1차: 오프라인 현장 강의</div>
            <div className="flex items-center gap-1 flex-wrap">
              <span>2차:</span>
              {program.classroomUrl ? (
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
              ※ 온라인 강의실 입장 PW: 신청자 개별 안내
            </div>
          </div>
        )}
      </div>

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
                </div>
              </div>
            )}
          </div>
        </section>
        {/* VOD 참여자 설문 제출 카드 */}
        <section className="pb-8">
          <div className="container mx-auto px-4">
            <div className="bg-card dark:bg-card text-card-foreground rounded-lg shadow-sm border border-red-200 dark:border-red-800 p-6 hover:shadow-xl hover:shadow-red-100/50 dark:hover:shadow-red-900/20 transition-all duration-300 transform hover:-translate-y-2 hover:scale-[1.02]">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-8 h-8 bg-red-600 rounded-lg flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="h-4 w-4 text-white" />
              </div>
              <div>
                <h3 className="font-semibold text-black text-lg">공지</h3>
                <p className="text-sm text-black">리더십 트레이닝 참가자 필수 사항</p>
              </div>
            </div>
            
            <div className="space-y-4">
              <ul className="space-y-3 text-sm text-black">
                <li className="flex items-start gap-2">
                  <span className="w-2 h-2 bg-red-500 rounded-full mt-2 flex-shrink-0"></span>
                  <span>2026년 하반기 리더십 트레이닝이 시작됩니다. 각 세션별 일정과 장소 확인하시고 미리 신청해주세요.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="w-2 h-2 bg-red-500 rounded-full mt-2 flex-shrink-0"></span>
                  <span>모든 트레이닝의 참가신청은 신청서 작성 후 이어지는 결제까지 마치셔야 완료됩니다.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="w-2 h-2 bg-red-500 rounded-full mt-2 flex-shrink-0"></span>
                  <span><strong>개별 신청</strong>은 원하시는 과목을 여러 개 함께 고르실 수 있고, 선택하신 과목 합계로 한 번에 결제됩니다.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="w-2 h-2 bg-red-500 rounded-full mt-2 flex-shrink-0"></span>
                  <span><strong>챕터 일괄 신청</strong>은 한 분이 여러 명을 대신 신청하는 방식입니다. 과목을 고르시면 그 과목을 수강할 분들의 명단을 적는 칸이 열리고, 전체 합계로 한 번에 결제됩니다. 수강자는 <strong>성명만 필수</strong>이며 연락처·이메일은 선택입니다.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="w-2 h-2 bg-red-500 rounded-full mt-2 flex-shrink-0"></span>
                  <span>일괄 신청 시 <strong>지역·챕터는 결제자 정보에 입력하신 값</strong>이 명단 전원의 소속으로 기록됩니다. 이미 신청된 분은 해당 과목만 자동으로 제외되고 그만큼 금액도 줄어듭니다.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="w-2 h-2 bg-red-500 rounded-full mt-2 flex-shrink-0"></span>
                  <span>모든 세션은 녹화본 시청으로도 참여가능합니다. 일정에 맞는 방식을 택1하여 참여해주세요.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="w-2 h-2 bg-red-500 rounded-full mt-2 flex-shrink-0"></span>
                  <span><strong>VOD 참여자 설문 제출 필수</strong> : 녹화본 시청으로 참여하시는 경우, Training Summary를 제출하셔야 이수하신 것으로 등록됩니다.</span>
                </li>
              </ul>
              
              <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
                <a 
                  href="https://apply-bnikorea.com/" 
                  target="_blank" 
                  rel="noopener noreferrer" 
                  className="inline-flex items-center justify-center w-full px-6 py-3 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg transition-colors duration-200"
                >
                  📝 Summary 제출하고 리더십팀 트레이닝 이수 완료 하기 !
                </a>
              </div>
            </div>
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
                      detailProgram.isAvailable && !isApplicationClosed(detailProgram.title)
                        ? 'default'
                        : 'secondary'
                    }
                  >
                    {detailProgram.isAvailable && !isApplicationClosed(detailProgram.title)
                      ? '신청가능'
                      : '신청마감'}
                  </Badge>
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
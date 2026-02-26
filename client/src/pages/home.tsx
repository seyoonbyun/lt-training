import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { SecondaryProgram } from "@shared/schema";
import Header from "@/components/layout/header";
import Footer from "@/components/layout/footer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ApplicationTypeModal } from "@/components/application/application-type-modal";
import { Calendar, Clock, User, MapPin, ExternalLink, AlertTriangle, CreditCard, ShoppingCart, ArrowRight, Monitor, Users } from "lucide-react";
import heroImage from "@assets/Image_fx_1755098115275.jpg";
import heroVideo from "@assets/team_1755249611475.mp4";
import buildingImage from "@assets/화면 캡처 2025-08-11 232105_1754922103429.png";
import paymentImagePath from "@assets/화면 캡처 2025-08-13 223230_1755093254727.png";

export default function Home() {
  const [, setLocation] = useLocation();
  const [isApplicationModalOpen, setIsApplicationModalOpen] = useState(false);
  const [selectedProgram, setSelectedProgram] = useState<SecondaryProgram | null>(null);
  const [expandedDescriptions, setExpandedDescriptions] = useState<Set<string>>(new Set());

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

  const handleApplyClick = (program: SecondaryProgram) => {
    setSelectedProgram(program);
    setIsApplicationModalOpen(true);
  };

  // 신청 마감 여부 확인 함수
  const isApplicationClosed = (programTitle: string) => {
    return applicationStatus[programTitle] === false;
  };

  const toggleDescription = (programId: string) => {
    setExpandedDescriptions(prev => {
      const newSet = new Set(prev);
      if (newSet.has(programId)) {
        newSet.delete(programId);
      } else {
        newSet.add(programId);
      }
      return newSet;
    });
  };

  const truncateDescription = (description: string) => {
    if (!description || description.length <= 120) return description;
    return description.slice(0, 120) + "...";
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
                  2026년 병오년 상반기 BNI 코리아 리더를 위해 마련된 비즈니스 리더십 프로그램
                </p>
                <p className="text-sm md:text-base">
                  26년 3/3 (화) 부터 - 3/20 (금) 까지, 총 9일간, 총 21시간 분량의 9개의 세션으로 구성되어있으며<br />
                  각 트레이닝 종료 후 익일 오후 1시 부터, '온라인 강의실'을 통해 녹화본을 시청하실 수 있습니다.
                </p>
                <p className="text-sm">
                  * 녹화본 영상이 업로드 되는대로, 참가 신청해주신 대표님들(한정)께 '영상 접속(ZOOM) 암호'가 발송됩니다 :)
                </p>
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
              <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {[...Array(9)].map((_, i) => (
                  <Skeleton key={i} className="h-[500px] rounded-lg" />
                ))}
              </div>
            ) : (
              <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {programs.map((program) => (
                  <Card key={program.id} className="group hover:shadow-xl hover:shadow-red-100/50 dark:hover:shadow-red-900/20 transition-all duration-300 transform hover:-translate-y-2 hover:scale-[1.02] border border-red-200 dark:border-red-800">
                    <CardHeader className="pb-4">
                      <div className="flex items-start justify-between mb-2">
                        <Badge variant="outline" className="bg-white dark:bg-white border"
                               style={{ borderColor: 'hsl(348 85% 47%)', color: 'hsl(348 85% 47%)' }}>
                          {program.sessionNumber}
                        </Badge>
                        <Badge variant={program.isAvailable ? "default" : "secondary"}>
                          {program.isAvailable ? "신청가능" : "신청마감"}
                        </Badge>
                      </div>
                      <CardTitle className="text-lg leading-tight transition-colors hover:cursor-pointer" 
                                 style={{ '--hover-color': 'hsl(348 85% 47%)' } as React.CSSProperties}
                                 onMouseEnter={(e) => e.currentTarget.style.color = 'hsl(348 85% 47%)'}
                                 onMouseLeave={(e) => e.currentTarget.style.color = ''}>
                        {program.title}
                      </CardTitle>
                    </CardHeader>
                    
                    <CardContent className="space-y-4">
                      {/* 날짜 및 시간 */}
                      <div className="flex items-center gap-2 text-sm">
                        <Calendar className="w-4 h-4" style={{ color: 'hsl(348 85% 47%)' }} />
                        <span className="font-medium">{program.date}</span>
                        <Clock className="w-4 h-4 ml-2" style={{ color: 'hsl(348 85% 47%)' }} />
                        <span style={{ color: '#000000', fontWeight: '500' }}>
                          {program.time}
                        </span>
                      </div>

                      {/* 강사 */}
                      {program.instructor && (
                        <div className="flex items-center gap-2 text-sm">
                          <User className="w-4 h-4" style={{ color: 'hsl(348 85% 47%)' }} />
                          <span className="font-medium">{program.instructor}</span>
                        </div>
                      )}

                      {/* 장소 */}
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 text-sm">
                          <MapPin className="w-4 h-4 text-red-600" />
                          {program.location.includes('섬유센터 컨퍼런스홀') && (program.venueUrl || program.classroomUrl) ? (
                            <a 
                              href={program.venueUrl || program.classroomUrl} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="text-blue-800 hover:text-red-600 underline"
                            >
                              {program.location}
                            </a>
                          ) : program.location.includes('스페이스 쉐어 삼성점') ? (
                            <a 
                              href="http://naver.me/GUGJFEBT" 
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
                            <span className="text-gray-600">
                              {program.location}
                            </span>
                          )}
                        </div>
                        
                        {/* 진행 방식 안내 */}
                        {program.location.includes('온라인') && (
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
                        
                        {program.location.includes('섬유센터 컨퍼런스홀') && (
                          <div className="p-3 border border-red-600 rounded-md text-xs text-red-600 space-y-1">
                            <div>1차: 오프라인 현장 강의</div>
                            <div className="flex items-center gap-1 flex-nowrap whitespace-nowrap">
                              <span>2차:</span>
                              <a 
                                href={program.classroomUrl || "https://bnionline.zoom.us/j/94632419186"}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-800 hover:opacity-75 underline inline-flex items-center gap-0.5"
                              >
                                <Monitor className="w-3 h-3 text-blue-800 flex-shrink-0" />
                                온라인 참가
                              </a>
                              <span>(VOD : 익일 오후3시 업로드)</span>
                            </div>
                            <div className="pt-1 border-t border-red-300">
                              ※ 온라인 강의실 입장 PW: 신청자 개별 안내
                            </div>
                          </div>
                        )}
                        
                        {program.location.includes('스페이스 쉐어 삼성점') && (
                          <div className="p-3 border border-red-600 rounded-md text-xs text-red-600 space-y-1">
                            <div>1차: 오프라인 현장 강의</div>
                            <div className="flex items-center gap-1">
                              2차:
                              <a 
                                href="https://timelog-bnikorea.com/"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-800 hover:opacity-75 underline flex items-center gap-1 text-sm"
                              >
                                <Monitor className="w-3 h-3 text-blue-800" />
                                온라인 강의실
                              </a>
                              (익일 오후3시)
                            </div>
                            <div className="pt-1 border-t border-red-300">
                              ※ 온라인 강의실 입장 PW: 신청자 개별 안내
                            </div>
                          </div>
                        )}
                      </div>

                      {/* 설명 */}
                      <div className="text-sm min-h-[60px] text-black">
                        {program.description ? (
                          <div>
                            <div 
                              className={expandedDescriptions.has(program.id) ? '' : 'line-clamp-2'}
                              dangerouslySetInnerHTML={{
                                __html: expandedDescriptions.has(program.id) 
                                  ? renderDescription(program.description, program.title)
                                  : renderDescription(truncateDescription(program.description), program.title)
                              }}
                            />
                            {program.description.length > 80 && (
                              <button
                                onClick={() => toggleDescription(program.id)}
                                className="text-red-600 hover:underline text-xs mt-1 float-right"
                              >
                                {expandedDescriptions.has(program.id) ? '간략히 보기' : '더 보기'}
                              </button>
                            )}
                          </div>
                        ) : (
                          <p className="text-gray-400">설명이 없습니다.</p>
                        )}
                      </div>

                      {/* 신청자 정보 (결제완료 기준) */}
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-red-600 font-medium flex items-center gap-1">
                          <Users className="w-4 h-4" />
                          신청자: {String(program.completedCount || 0).padStart(2, '0')}명 / {program.title.includes('파운데이션') ? '400' : '100'}명
                        </span>
                        <div className="w-full max-w-[100px] bg-gray-200 dark:bg-gray-700 rounded-full h-2 ml-3">
                          <div 
                            className="bg-red-600 h-2 rounded-full transition-all"
                            style={{ width: `${Math.min((program.completedCount || 0) / (program.title.includes('파운데이션') ? 400 : 100) * 100, 100)}%` }}
                          />
                        </div>
                      </div>

                      {/* 액션 버튼들 */}
                      <div className="pt-2 space-y-2">
                        <div className="flex gap-2">
                          <Button
                            className={`flex-1 ${
                              program.isAvailable && !isApplicationClosed(program.title)
                                ? "bg-red-600 hover:bg-red-700" 
                                : "bg-gray-400 cursor-not-allowed"
                            }`}
                            onClick={() => handleApplyClick(program)}
                            disabled={!program.isAvailable || isApplicationClosed(program.title)}
                          >
                            {program.isAvailable && !isApplicationClosed(program.title) ? "신청하기" : 
                             !program.isAvailable ? "종료되었습니다" : "신청마감"}
                          </Button>
                          {program.storeUrl && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="px-3"
                              onClick={() => window.open(program.storeUrl, '_blank')}
                              disabled={!program.isAvailable || isApplicationClosed(program.title)}
                            >
                              <ShoppingCart className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                        {program.isAvailable && !isApplicationClosed(program.title) && (
                          <p className="text-xs text-gray-500 text-center">
                            ※ 신청자 카운트 = 결제완료 기준
                          </p>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
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
                  <span>2026년 상반기 리더십 트레이닝이 시작됩니다. 각 세션별 일정과 장소 확인하시고 미리 신청해주세요.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="w-2 h-2 bg-red-500 rounded-full mt-2 flex-shrink-0"></span>
                  <span>모든 트레이닝의 참가신청은 신청폼 제출 후, 연동되는 스토어를 통해 결제까지 마무리해주셔야 완료됩니다.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="w-2 h-2 bg-red-500 rounded-full mt-2 flex-shrink-0"></span>
                  <div>
                    <span>스토어에서 결제하실 때, '챕터명/신청자명' 기재란에, 신청폼에 남겨주신 성함과 동일하게 기재해주셔야 결제내역이 바로 매칭됩니다.</span>
                    <br />
                    <div className="flex items-start gap-4 mt-2">
                      <div className="flex-1">
                        <div className="text-xs text-gray-600 mb-1">※ 멤버 개인 결제 시 : '챕터명/신청자명' 로 기재해주시면 됩니다. (작성예시 : 해피/홍길동)</div>
                        <div className="text-xs text-gray-600">※ 챕터 일괄 결제 시 : '챕터명/신청인원수' 로 기재해주시면 됩니다. (작성예시 : 해피/20명)</div>
                      </div>
                      <div className="flex-shrink-0 hidden md:block">
                        <img 
                          src={paymentImagePath} 
                          alt="결제 시 기재 방법 참고 이미지"
                          className="w-[270px] h-auto"
                        />
                      </div>
                    </div>

                  </div>
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

        {/* Accelerate 2026 Section */}
        <section className="pb-8 bg-background">
          <div className="container mx-auto px-4">
            <div className="border-l-4 border-red-600 bg-white dark:bg-white p-6 mb-8 rounded-lg hover:shadow-xl hover:shadow-red-100/50 dark:hover:shadow-red-900/20 transition-all duration-300 transform hover:-translate-y-2 hover:scale-[1.02]">
              <h2 className="text-2xl md:text-3xl font-bold mb-4 text-foreground">Accelerate 2026</h2>
              <div className="space-y-4 text-foreground">
                <p>
                  BNI 코리아 리더십 트레이닝 프로그램은 2026 상반기에 각 챕터의 리더로 활동하실 전국 BNI 리더십 팀 대표님들이 모두 참여하셔서 함께 소통하며 참여하는 형식의 트레이닝으로, 서로 교류하고 소통하며 BNI에서의 활동 방식, 노하우, 리더로서의 올바른 방향성에 대해 고민할 수 있는 자리입니다.
                </p>
                <div className="space-y-2">
                  <p className="font-semibold">4000명의 멤버를 맞이하게 될 BNI 코리아의 2026년 !</p>
                  <p>그 빛나는 시작을 전국의 BNI 코리아 리더십 트레이닝과 함께 하세요 :)</p>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <Footer />

      <ApplicationTypeModal
        isOpen={isApplicationModalOpen}
        onClose={() => setIsApplicationModalOpen(false)}
        selectedProgram={selectedProgram}
      />
    </div>
  );
}
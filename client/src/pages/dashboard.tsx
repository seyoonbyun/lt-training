import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { 
  BarChart3, 
  Users, 
  Calendar, 
  CheckCircle, 
  Clock, 
  MapPin,
  Building2,
  GraduationCap,
  RefreshCw,
  TrendingUp,
  Home
} from "lucide-react";

interface DashboardData {
  totalApplications: number;
  paidApplications: number;
  pendingApplications: number;
  programStats: { [program: string]: { total: number; paid: number; pending: number } };
  regionStats: { [region: string]: { total: number; paid: number; pending: number } };
  chapterStats: { [chapter: string]: { total: number; paid: number; pending: number } };
  recentApplications: any[];
}

export default function Dashboard() {
  const [selectedTab, setSelectedTab] = useState<string>("programs");

  const { data: dashboardData, isLoading, error } = useQuery<DashboardData>({
    queryKey: ["/api/dashboard"],
    refetchInterval: 5000, // 5초마다 자동 갱신으로 빠른 마감 상태 반영
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-100 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
        <div className="container mx-auto px-4 py-8">
          <div className="flex items-center justify-center h-64">
            <div className="flex items-center space-x-2">
              <RefreshCw className="h-6 w-6 animate-spin text-red-600 dark:text-red-400" />
              <span className="text-lg text-gray-600 dark:text-gray-300">대시보드 데이터 로딩 중...</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !dashboardData) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-100 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
        <div className="container mx-auto px-4 py-8">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">데이터 로딩 오류</h1>
            <p className="text-gray-600 dark:text-gray-300 mb-6">대시보드 데이터를 불러오는데 문제가 발생했습니다.</p>
            <p className="text-gray-500 dark:text-gray-400">페이지를 새로고침하여 다시 시도해주세요.</p>
          </div>
        </div>
      </div>
    );
  }

  const { 
    totalApplications, 
    paidApplications, 
    pendingApplications,
    programStats,
    regionStats,
    chapterStats,
    recentApplications 
  } = dashboardData;

  const paymentCompletionRate = totalApplications > 0 ? Math.round((paidApplications / totalApplications) * 100) : 0;

  const StatCard = ({ 
    title, 
    value, 
    description, 
    icon: Icon, 
    trend,
    color = "default" 
  }: { 
    title: string; 
    value: string | number; 
    description: string; 
    icon: any; 
    trend?: string;
    color?: "default" | "success" | "warning" | "danger";
  }) => {
    const colorClasses = {
      default: "text-blue-600 dark:text-blue-400",
      success: "text-green-600 dark:text-green-400",
      warning: "text-yellow-600 dark:text-yellow-400",
      danger: "text-red-600 dark:text-red-400"
    };

    return (
      <Card className="hover:shadow-lg transition-shadow">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">{title}</CardTitle>
          <Icon className={`h-4 w-4 ${colorClasses[color]}`} />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{value}</div>
          <p className="text-xs text-muted-foreground">{description}</p>
          {trend && (
            <div className="flex items-center mt-2">
              <TrendingUp className="h-3 w-3 text-green-500 mr-1" />
              <span className="text-xs text-green-600 dark:text-green-400">{trend}</span>
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  const StatsTable = ({ 
    title, 
    data, 
    icon: Icon 
  }: { 
    title: string; 
    data: { [key: string]: { total: number; paid: number; pending: number } };
    icon: any;
  }) => {
    const sortedData = Object.entries(data).sort((a, b) => b[1].total - a[1].total);

    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Icon className="h-5 w-5 text-red-700 dark:text-red-500" />
            {title}
          </CardTitle>
          <CardDescription>
            카테고리별 신청 현황 및 결제 완료율
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {sortedData.length > 0 ? (
              sortedData.map(([key, stats]) => {
                const completionRate = stats.total > 0 ? Math.round((stats.paid / stats.total) * 100) : 0;
                
                return (
                  <div key={key} className="space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="font-medium text-sm">{key || '미지정'}</span>
                      <div className="flex gap-2">
                        <Badge variant="outline">{stats.total}명</Badge>
                        <Badge variant="default" className="bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">
                          {stats.paid}명 완료
                        </Badge>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>결제 완료율</span>
                        <span>{completionRate}%</span>
                      </div>
                      <Progress value={completionRate} className="h-2" />
                    </div>
                  </div>
                );
              })
            ) : (
              <p className="text-center text-muted-foreground py-4">데이터가 없습니다.</p>
            )}
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-100 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
      <div className="container mx-auto px-4 py-8">
        {/* 헤더 */}
        <div className="mb-8">
          <div className="md:flex md:justify-between md:items-center mb-4 space-y-4 md:space-y-0">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white">신청현황 대시보드</h1>
              <p className="text-gray-600 dark:text-gray-300 mt-1 flex items-center gap-2 text-sm">
                <RefreshCw className="h-4 w-4 text-green-500 animate-spin" />
                BNI Korea Leadership Training 2026 실시간 신청 현황
              </p>
            </div>
            
            <div className="flex flex-col md:flex-row gap-3">
              <Button 
                variant="outline" 
                className="flex items-center gap-2 px-4 py-2 h-auto bg-white text-red-600 border-red-600 hover:!bg-red-600 hover:!text-white transition-all duration-200 rounded-lg w-full md:w-auto"
                onClick={() => {
                  // 모바일에서 구글 시트 강제 데스크톱 모드 접근
                  const isMobile = /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
                  const isKakaoTalk = /KAKAOTALK/i.test(navigator.userAgent);
                  
                  if (isMobile || isKakaoTalk) {
                    // 모바일/카카오톡: 여러 방법으로 데스크톱 모드 강제
                    const urls = [
                      // 방법 1: usp=desktop + 추가 파라미터
                      "https://docs.google.com/spreadsheets/d/1ENi99bJGBtjf1WYG1XXo-aH8eN-Zx6kmeUSU7ZqM_Kg/edit?usp=desktop&chrome=false&widget=false",
                      // 방법 2: 직접 편집 모드 + 데스크톱 강제
                      "https://docs.google.com/spreadsheets/d/1ENi99bJGBtjf1WYG1XXo-aH8eN-Zx6kmeUSU7ZqM_Kg/edit#gid=0&fvid=1755409661926&usp=desktop",
                      // 방법 3: 백업 링크
                      "https://docs.google.com/spreadsheets/d/1ENi99bJGBtjf1WYG1XXo-aH8eN-Zx6kmeUSU7ZqM_Kg/edit?usp=sharing"
                    ];
                    
                    // 첫 번째 URL로 시도
                    const newWindow = window.open(urls[0], "_blank", "noopener,noreferrer");
                    
                    // 3초 후 다른 URL로 리디렉션 (모바일 변환 감지 시)
                    setTimeout(() => {
                      if (newWindow && !newWindow.closed) {
                        try {
                          newWindow.location.href = urls[1];
                        } catch (e) {
                          // 크로스 오리진 문제 시 새 창으로 열기
                          window.open(urls[1], "_blank", "noopener,noreferrer");
                        }
                      }
                    }, 3000);
                    
                  } else {
                    // 데스크톱: 일반 모드
                    window.open("https://docs.google.com/spreadsheets/d/1ENi99bJGBtjf1WYG1XXo-aH8eN-Zx6kmeUSU7ZqM_Kg/edit?usp=sharing", "_blank", "noopener,noreferrer");
                  }
                }}
              >
                <Users className="h-4 w-4" />
                신청자 명단 확인하기
              </Button>
              
              <Link href="/" className="w-full md:w-auto">
                <Button 
                  variant="outline" 
                  className="flex items-center gap-2 px-4 py-2 h-auto bg-red-600 text-white border-red-600 hover:!bg-white hover:!text-red-600 hover:border-red-600 transition-all duration-200 w-full md:w-auto"
                >
                  <Home className="h-4 w-4" />
                  홈으로
                </Button>
              </Link>
            </div>
          </div>
        </div>

        {/* 요약 통계 카드 */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <StatCard
            title="전체 신청자"
            value={totalApplications}
            description="총 신청 접수 건수"
            icon={Users}
            color="default"
          />
          <StatCard
            title="결제 완료"
            value={paidApplications}
            description="결제 완료된 신청자 수"
            icon={CheckCircle}
            color="success"
          />
          <StatCard
            title="결제 대기"
            value={pendingApplications}
            description="결제 대기 중인 신청자 수"
            icon={Clock}
            color="warning"
          />
          <StatCard
            title="완료율"
            value={`${paymentCompletionRate}%`}
            description="전체 신청 대비 결제 완료율"
            icon={TrendingUp}
            color={paymentCompletionRate >= 80 ? "success" : paymentCompletionRate >= 50 ? "warning" : "danger"}
          />
        </div>

        {/* 전체 완료율 프로그레스 바 */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-red-600 dark:text-red-400" />
              전체 결제 완료율
            </CardTitle>
            <CardDescription>
              {paidApplications}명 / {totalApplications}명 완료 ({paymentCompletionRate}%)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Progress value={paymentCompletionRate} className="h-4" />
            <div className="flex justify-between text-xs text-muted-foreground mt-2">
              <span>0%</span>
              <span>50%</span>
              <span>100%</span>
            </div>
          </CardContent>
        </Card>

        {/* 탭 컨텐츠 */}
        <Tabs value={selectedTab} onValueChange={setSelectedTab} className="space-y-6">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="programs" className="flex items-center gap-2 data-[state=active]:text-red-700 data-[state=active]:dark:text-red-500">
              <GraduationCap className="h-4 w-4" />
              과목별
            </TabsTrigger>
            <TabsTrigger value="regions" className="flex items-center gap-2 data-[state=active]:text-red-700 data-[state=active]:dark:text-red-500">
              <MapPin className="h-4 w-4" />
              지역별
            </TabsTrigger>
            <TabsTrigger value="chapters" className="flex items-center gap-2 data-[state=active]:text-red-700 data-[state=active]:dark:text-red-500">
              <Building2 className="h-4 w-4" />
              챕터별
            </TabsTrigger>
          </TabsList>

          <TabsContent value="programs" className="space-y-6">
            <StatsTable title="과목별 신청 현황" data={programStats} icon={GraduationCap} />
          </TabsContent>

          <TabsContent value="regions" className="space-y-6">
            <StatsTable title="지역별 신청 현황" data={regionStats} icon={MapPin} />
          </TabsContent>

          <TabsContent value="chapters" className="space-y-6">
            <StatsTable title="챕터별 신청 현황" data={chapterStats} icon={Building2} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
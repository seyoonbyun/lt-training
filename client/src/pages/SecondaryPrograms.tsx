import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Clock, MapPin, User, ExternalLink, Calendar } from "lucide-react";
import { ApplicationTypeModal } from "@/components/application/application-type-modal";
import type { SecondaryProgram } from "@shared/schema";

export default function SecondaryPrograms() {
  const [selectedProgram, setSelectedProgram] = useState<SecondaryProgram | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const { data: programs = [], isLoading, error } = useQuery<SecondaryProgram[]>({
    queryKey: ["/api/secondary-programs"],
    refetchInterval: 30000, // 30초마다 새로고침
  });

  const handleApplyClick = (program: SecondaryProgram) => {
    setSelectedProgram(program);
    setIsModalOpen(true);
  };

  const handleModalClose = () => {
    setIsModalOpen(false);
    setSelectedProgram(null);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-red-50 via-white to-amber-50 dark:from-red-950 dark:via-gray-900 dark:to-amber-950">
        <div className="container mx-auto py-8 px-4">
          <div className="text-center py-12">
            <div className="animate-spin w-8 h-8 border-4 border-red-600 border-t-transparent rounded-full mx-auto mb-4"></div>
            <p className="text-gray-600 dark:text-gray-400">프로그램 정보를 불러오는 중...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-red-50 via-white to-amber-50 dark:from-red-950 dark:via-gray-900 dark:to-amber-950">
        <div className="container mx-auto py-8 px-4">
          <div className="text-center py-12">
            <p className="text-red-600 dark:text-red-400 mb-4">프로그램 정보를 불러오는데 실패했습니다.</p>
            <Button onClick={() => window.location.reload()}>다시 시도</Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-red-50 via-white to-amber-50 dark:from-red-950 dark:via-gray-900 dark:to-amber-950">
      <div className="container mx-auto py-8 px-4">
        {/* 헤더 */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-4">
            BNI Korea Leadership Training 2026
          </h1>
          <p className="text-xl text-gray-600 dark:text-gray-300 mb-6">
            리더십 교육 프로그램에 참여하세요
          </p>
          <div className="inline-flex items-center gap-2 bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200 px-4 py-2 rounded-full">
            <Calendar className="w-4 h-4" />
            <span className="font-medium">2026년 프로그램</span>
          </div>
        </div>

        {/* 프로그램 목록 */}
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {programs.map((program) => (
            <Card key={program.id} className="group hover:shadow-lg transition-all duration-300 border-2 hover:border-red-200 dark:hover:border-red-800">
              <CardHeader className="pb-4">
                <div className="flex items-start justify-between mb-2">
                  <Badge variant="outline" className="bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800">
                    {program.sessionNumber}
                  </Badge>
                  <Badge variant={program.isAvailable ? "default" : "secondary"}>
                    {program.isAvailable ? "신청가능" : "마감"}
                  </Badge>
                </div>
                <CardTitle className="text-lg leading-tight group-hover:text-red-600 dark:group-hover:text-red-400 transition-colors">
                  {program.title}
                </CardTitle>
              </CardHeader>
              
              <CardContent className="space-y-4">
                {/* 날짜 및 시간 */}
                <div className="flex items-center gap-2 text-sm">
                  <Calendar className="w-4 h-4 text-red-600 dark:text-red-400" />
                  <span className="font-medium">{program.date}</span>
                  <Clock className="w-4 h-4 text-gray-500 ml-2" />
                  <span className="text-gray-600 dark:text-gray-400">{program.time}</span>
                </div>

                {/* 강사 */}
                {program.instructor && (
                  <div className="flex items-center gap-2 text-sm">
                    <User className="w-4 h-4 text-red-600 dark:text-red-400" />
                    <span className="font-medium">{program.instructor}</span>
                  </div>
                )}

                {/* 장소 */}
                <div className="flex items-center gap-2 text-sm">
                  <MapPin className="w-4 h-4 text-red-600 dark:text-red-400" />
                  <span className="text-gray-600 dark:text-gray-400">{program.location}</span>
                </div>

                {/* 설명 */}
                {program.description && (
                  <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-3">
                    {program.description}
                  </p>
                )}

                {/* 참가자 정보 */}
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500">
                    참가자: {program.currentParticipants}/{program.maxParticipants}명
                  </span>
                  <div className="w-full max-w-[100px] bg-gray-200 dark:bg-gray-700 rounded-full h-2 ml-3">
                    <div 
                      className="bg-red-600 h-2 rounded-full transition-all"
                      style={{ width: `${(program.currentParticipants / program.maxParticipants) * 100}%` }}
                    />
                  </div>
                </div>

                {/* 액션 버튼들 */}
                <div className="flex gap-2 pt-2">
                  <Button
                    className="flex-1 bg-red-600 hover:bg-red-700 text-white"
                    onClick={() => handleApplyClick(program)}
                    disabled={!program.isAvailable}
                  >
                    신청하기
                  </Button>
                  {program.storeUrl && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="px-3"
                      onClick={() => window.open(program.storeUrl, '_blank')}
                    >
                      <ExternalLink className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {programs.length === 0 && (
          <div className="text-center py-12">
            <p className="text-gray-600 dark:text-gray-400 text-lg">
              현재 등록된 프로그램이 없습니다.
            </p>
          </div>
        )}
      </div>

      {/* 신청 모달 */}
      {selectedProgram && (
        <ApplicationTypeModal
          isOpen={isModalOpen}
          onClose={handleModalClose}
          selectedProgram={selectedProgram}
        />
      )}
    </div>
  );
}
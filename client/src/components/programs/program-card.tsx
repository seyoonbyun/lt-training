import { TrainingProgram } from "@shared/schema";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { 
  Calendar, 
  MapPin, 
  User, 
  Users, 
  Info, 
  Play,
  Building2,
  Monitor,
  Clock,
  UserCheck
} from "lucide-react";
import { format, isAfter, isBefore, addDays } from "date-fns";
import { ko } from "date-fns/locale";

interface ProgramCardProps {
  program: TrainingProgram;
  onApply: () => void;
}

const getProgramIcon = (type: string) => {
  const icons = {
    foundation: Building2,
    mentoring: UserCheck,
    pr: Users,
    "st-door": Clock,
    event: Calendar,
    membership: Users,
    education: User,
    visitor: UserCheck
  };
  const Icon = icons[type as keyof typeof icons] || Building2;
  return <Icon className="w-4 h-4 text-white" />;
};

const getProgramColor = (type: string) => {
  const colors = {
    foundation: "bg-primary",
    mentoring: "bg-primary",
    pr: "bg-primary",
    "st-door": "bg-primary",
    event: "bg-primary",
    membership: "bg-primary",
    education: "bg-primary",
    visitor: "bg-primary"
  };
  return colors[type as keyof typeof colors] || "bg-primary";
};

const getStatusInfo = (status: string, date: Date) => {
  const now = new Date();
  const isClosingSoon = isAfter(date, now) && isBefore(date, addDays(now, 7));
  
  if (status === "completed") {
    return { 
      label: "종료", 
      className: "status-completed",
      icon: null
    };
  } else if (status === "ongoing") {
    return { 
      label: "진행중", 
      className: "status-ongoing",
      icon: null
    };
  } else if (isClosingSoon) {
    return { 
      label: "마감임박", 
      className: "status-closing",
      icon: null
    };
  } else {
    return { 
      label: "예정", 
      className: "status-upcoming",
      icon: null
    };
  }
};

export default function ProgramCard({ program, onApply }: ProgramCardProps) {
  const statusInfo = getStatusInfo(program.status, program.date);
  const isCompleted = program.status === "completed";
  const hasRecording = isCompleted && program.recordingLink;
  const isFull = program.currentParticipants >= program.maxParticipants;
  
  const formatDate = (date: Date) => {
    try {
      return format(date, "yyyy년 MM월 dd일 (E) HH:mm", { locale: ko });
    } catch (error) {
      return "날짜 정보 없음";
    }
  };

  return (
    <Card className="bni-card hover:shadow-lg transition-all duration-300 transform hover:-translate-y-1 border-2 hover:border-primary">
      <CardContent className="p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-2">
            <div className={`w-8 h-8 ${getProgramColor(program.type)} rounded-lg flex items-center justify-center`}>
              {getProgramIcon(program.type)}
            </div>
            <Badge 
              variant="outline" 
              className={`${statusInfo.className} border rounded-full px-2 py-1 text-xs font-medium`}
            >
              {statusInfo.label}
            </Badge>
          </div>
          <div className="text-right">
            <div className="text-sm text-muted-foreground">
              {isCompleted ? "참여자" : "신청자"}
            </div>
            <div className={`font-semibold ${isCompleted ? 'text-muted-foreground' : 'text-primary'}`}>
              {String(program.currentParticipants || 0).padStart(2, '0')}명 / {program.title.includes('파운데이션') ? '200' : '100'}명
            </div>
          </div>
        </div>
        
        {/* Title and Description */}
        <h3 className="text-xl font-semibold mb-2 text-foreground">
          {program.title}
        </h3>
        <p className="text-muted-foreground text-sm mb-4 line-clamp-2">
          {program.description || "상세 설명이 준비 중입니다."}
        </p>
        
        {/* Details */}
        <div className="space-y-2 mb-4">
          <div className="flex items-center text-sm text-foreground">
            <Calendar className="text-primary w-4 h-4 mr-2 flex-shrink-0" />
            <span>{formatDate(program.date)}</span>
          </div>
          
          <div className="flex items-center text-sm text-foreground">
            {program.isOnline ? (
              <Monitor className="text-primary w-4 h-4 mr-2 flex-shrink-0" />
            ) : (
              <MapPin className="text-primary w-4 h-4 mr-2 flex-shrink-0" />
            )}
            {program.location.includes('스페이스 쉐어 삼성점') ? (
              <a 
                href="http://naver.me/GUGJFEBT" 
                target="_blank" 
                rel="noopener noreferrer"
                className="hover:text-primary transition-colors underline"
              >
                {program.location}
              </a>
            ) : (
              <span>{program.location}</span>
            )}
          </div>
          
          <div className="flex items-center text-sm text-foreground">
            <User className="text-primary w-4 h-4 mr-2 flex-shrink-0" />
            <span>{program.trainer}</span>
          </div>
          
          {hasRecording && (
            <div className="flex items-center text-sm text-foreground">
              <Play className="text-primary w-4 h-4 mr-2 flex-shrink-0" />
              <span>녹화본 시청 가능</span>
            </div>
          )}
        </div>
        
        {/* Action Buttons */}
        <div className="flex space-x-2">
          {isCompleted ? (
            hasRecording ? (
              <Button
                className="bni-button-secondary flex-1"
                onClick={() => {
                  if (program.recordingLink) {
                    window.open(program.recordingLink, '_blank');
                  }
                }}
              >
                <Play className="w-4 h-4 mr-2" />
                녹화본 보기
              </Button>
            ) : (
              <Button
                disabled
                className="flex-1 bg-gray-200 text-gray-500 cursor-not-allowed"
              >
                종료된 프로그램
              </Button>
            )
          ) : (
            <div className="flex-1">
              <Button
                className={`w-full transition-all ${
                  isFull 
                    ? 'bg-gray-200 text-gray-500 cursor-not-allowed' 
                    : 'bni-button-primary'
                }`}
                onClick={onApply}
                disabled={isFull}
              >
                {isFull ? '정원 마감' : '신청하기'}
              </Button>
              {!isFull && (
                <p className="text-xs text-gray-500 mt-1 text-center">
                  ※ 신청자 카운트 기준 = 결제까지 완료된 경우 한정
                </p>
              )}
            </div>
          )}
          
          <Button
            variant="outline"
            size="sm"
            className="border-gray-300 hover:border-primary text-muted-foreground hover:text-primary p-2"
          >
            <Info className="w-4 h-4" />
          </Button>
        </div>
        
        {/* Payment Link */}
        {!isCompleted && program.paymentLink && (
          <div className="mt-3 pt-3 border-t border-gray-200">
            <a
              href={program.paymentLink}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary text-sm hover:underline inline-flex items-center font-medium"
            >
              BNI Korea Store 결제 →
            </a>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

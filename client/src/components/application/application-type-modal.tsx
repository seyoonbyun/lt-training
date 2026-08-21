import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ApplicationForm } from "./application-form";
import { BulkUpload } from "./bulk-upload";
import { ArrowLeft, FileText, Upload, User, Users } from "lucide-react";
import type { TrainingProgram, SecondaryProgram } from "@shared/schema";

interface ApplicationTypeModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** 신청 가능한 전체 과목. 개별 신청은 이 중 여러 개를, 일괄 신청은 하나를 고른다 */
  programs: SecondaryProgram[];
}

type ApplicationType = "individual" | "bulk" | null;

export function ApplicationTypeModal({ isOpen, onClose, programs }: ApplicationTypeModalProps) {
  const [selectedType, setSelectedType] = useState<ApplicationType>(null);
  const availablePrograms = programs.filter((program) => program.isAvailable);

  const handleClose = () => {
    setSelectedType(null);
    onClose();
  };

  const handleSuccess = () => {
    // 개별 신청은 토스 결제창에서 끝난다 (스토어로 보내지 않는다)
    handleClose();
  };

  const handleBulkSuccess = () => {
    // 일괄 신청 시에는 BulkUpload 컴포넌트에서 일괄 결제 링크만 열고 
    // 추가 결제 링크는 열지 않음
    handleClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto pt-12 md:pt-6">
        <DialogHeader className="pr-8 md:pr-8 space-y-2">
          <DialogTitle className="text-xl font-bold text-red-600 pr-0 md:pr-4 text-left md:text-center">
            리더십 트레이닝 신청 - 신청 방법 선택
          </DialogTitle>
          <DialogDescription className="pr-0 md:pr-4 text-center text-sm text-muted-foreground">
신청 방법을 선택해주세요. 본인 신청은 개별 신청, 여러 명을 대신 신청하시면 일괄 신청입니다.
          </DialogDescription>
        </DialogHeader>

        {!selectedType ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 py-6">
            {/* Individual Application */}
            <Card 
              className="cursor-pointer hover:shadow-lg transition-shadow border-2 hover:border-red-600"
              onClick={() => setSelectedType("individual")}
            >
              <CardHeader className="text-center">
                <div className="mx-auto w-16 h-16 bg-red-600 rounded-full flex items-center justify-center mb-4">
                  <User className="w-8 h-8 text-white" />
                </div>
                <CardTitle className="text-lg">개별 신청</CardTitle>
                <CardDescription>
                  개인 정보를 입력하여 신청합니다
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm text-gray-600 dark:text-gray-400">
                  <li>• 신청자 1명의 정보 입력</li>
                  <li>• 원하는 과목을 여러 개 선택 가능</li>
                  <li>• 선택한 과목 합계로 한 번에 결제</li>
                </ul>
                <Button className="w-full mt-4 bg-red-600 hover:bg-red-700">
                  <FileText className="w-4 h-4 mr-2" />
                  개별 신청하기
                </Button>
              </CardContent>
            </Card>

            {/* Bulk Application */}
            <Card 
              className="cursor-pointer hover:shadow-lg transition-shadow border-2 hover:border-red-600"
              onClick={() => setSelectedType("bulk")}
            >
              <CardHeader className="text-center">
                <div className="mx-auto w-16 h-16 bg-red-600 rounded-full flex items-center justify-center mb-4">
                  <Users className="w-8 h-8 text-white" />
                </div>
                <CardTitle className="text-lg">일괄 신청</CardTitle>
                <CardDescription>
여러 명의 신청을 대신합니다
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm text-gray-600 dark:text-gray-400">
                  <li>• 과목별로 수강자 명단 입력</li>
                  <li>• 수강자는 성명만 필수</li>
                  <li>• 전체 합계로 한 번에 결제</li>
                </ul>
                <Button className="w-full mt-4 bg-red-600 hover:bg-red-700">
                  <Upload className="w-4 h-4 mr-2" />
                  일괄 신청하기
                </Button>
              </CardContent>
            </Card>
          </div>
        ) : selectedType === "individual" ? (
          <div className="py-6">
            <div className="flex items-center justify-end mb-6">
              <Button 
                onClick={() => setSelectedType(null)} 
                variant="outline"
                size="sm"
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                돌아가기
              </Button>
            </div>
            <ApplicationForm programs={availablePrograms} onSuccess={handleSuccess} />
          </div>
        ) : (
          <div className="py-6">
            <div className="flex items-center justify-end mb-6">
              <Button 
                onClick={() => setSelectedType(null)} 
                variant="outline"
                size="sm"
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                돌아가기
              </Button>
            </div>
            <BulkUpload programs={availablePrograms} onSuccess={handleBulkSuccess} />
          </div>
        )}

      </DialogContent>
    </Dialog>
  );
}
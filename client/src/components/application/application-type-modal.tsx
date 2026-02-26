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
import { ArrowLeft, FileText, Upload, User, Users, ExternalLink } from "lucide-react";
import type { TrainingProgram, SecondaryProgram } from "@shared/schema";

interface ApplicationTypeModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedProgram: (TrainingProgram | SecondaryProgram) & { storeUrl?: string } | null;
}

type ApplicationType = "individual" | "bulk" | null;

export function ApplicationTypeModal({ isOpen, onClose, selectedProgram }: ApplicationTypeModalProps) {
  const [selectedType, setSelectedType] = useState<ApplicationType>(null);

  const handleClose = () => {
    setSelectedType(null);
    onClose();
  };

  const handleSuccess = () => {
    // 개별 신청 시에만 개별 과목 결제 페이지로 이동
    if (selectedType === "individual" && selectedProgram?.storeUrl) {
      setTimeout(() => {
        window.open(selectedProgram.storeUrl, "_blank");
      }, 1500);
    }
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
            {selectedProgram?.title || "프로그램"} - 신청 방법 선택
          </DialogTitle>
          <DialogDescription className="pr-0 md:pr-4 text-center text-sm text-muted-foreground">
            신청 방법을 선택해주세요. 개별 신청 또는 엑셀 파일을 통한 일괄 신청이 가능합니다.
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
                  <li>• 즉시 결제 페이지 연결</li>
                  <li>• 빠른 신청 처리</li>
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
                  엑셀 파일로 여러 명을 한번에 신청합니다
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm text-gray-600 dark:text-gray-400">
                  <li>• 여러 명의 정보를 엑셀로 업로드</li>
                  <li>• 템플릿 파일 제공</li>
                  <li>• 대량 신청 처리</li>
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
            <ApplicationForm program={selectedProgram} onSuccess={handleSuccess} />
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
            <BulkUpload 
              onSuccess={handleBulkSuccess} 
              program={{ title: selectedProgram?.title || "", id: selectedProgram?.id || "", storeUrl: selectedProgram?.storeUrl || "" }}
            />
          </div>
        )}

        {selectedProgram?.storeUrl && (
          <div className="border-t border-gray-200 dark:border-gray-700 pt-4 mt-6">
            <div className="p-4 bg-gray-100 border border-red-600 rounded-lg shadow-sm space-y-3">
              <p className="text-sm font-bold text-gray-600">
                결제 안내
              </p>
              <p className="text-sm text-gray-600">
                신청 완료 후 자동으로 BNI Korea Store 결제 페이지로 이동됩니다
              </p>
              <div className="flex justify-center">
                <Button
                  onClick={() => window.open(selectedProgram.storeUrl!, "_blank")}
                  className="w-full bg-white hover:bg-gray-50 text-red-600 border border-red-600 hover:border-red-700"
                >
                  <ExternalLink className="w-4 h-4 mr-2" />
                  스토어 결제 페이지 미리보기
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
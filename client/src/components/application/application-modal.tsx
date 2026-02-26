import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { insertApplicationSchema, type TrainingProgram } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { z } from "zod";
import { Loader2, CheckCircle } from "lucide-react";

interface ApplicationModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedProgram: TrainingProgram | null;
}

const formSchema = insertApplicationSchema.extend({
  name: z.string().min(2, "이름을 2자 이상 입력해주세요"),
  email: z.string().email("올바른 이메일 주소를 입력해주세요"),
  phone: z.string().min(10, "올바른 연락처를 입력해주세요"),
  trainingType: z.enum(["live", "recorded"], {
    required_error: "참여 방식을 선택해주세요"
  })
});

type FormData = z.infer<typeof formSchema>;

export default function ApplicationModal({ isOpen, onClose, selectedProgram }: ApplicationModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors }
  } = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      email: "",
      phone: "",
      chapter: "",
      trainingType: "live",
      notes: ""
    }
  });

  const trainingType = watch("trainingType");

  const submitApplication = useMutation({
    mutationFn: async (data: FormData) => {
      const response = await apiRequest("POST", "/api/applications", data);
      return response.json();
    },
    onSuccess: () => {
      setIsSuccess(true);
      queryClient.invalidateQueries({ queryKey: ["/api/programs"] });
      toast({
        title: "신청 완료",
        description: "트레이닝 신청이 성공적으로 접수되었습니다.",
      });
      setTimeout(() => {
        handleClose();
      }, 2000);
    },
    onError: (error: Error) => {
      toast({
        title: "신청 실패",
        description: error.message || "신청 중 오류가 발생했습니다. 다시 시도해주세요.",
        variant: "destructive",
      });
    }
  });

  const onSubmit = async (data: FormData) => {
    if (!selectedProgram) {
      toast({
        title: "오류",
        description: "프로그램을 선택해주세요.",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      await submitApplication.mutateAsync({
        ...data
      });
    } catch (error) {
      console.error("Application submission failed:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!isSubmitting) {
      setIsSuccess(false);
      reset();
      onClose();
    }
  };

  if (isSuccess) {
    return (
      <Dialog open={isOpen} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-md bg-dark-secondary border-gray-700">
          <DialogHeader>
            <DialogTitle className="sr-only">신청 완료</DialogTitle>
          </DialogHeader>
          <div className="text-center py-8">
            <CheckCircle className="w-16 h-16 text-green-400 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-white mb-2">신청 완료!</h3>
            <p className="text-gray-400">
              트레이닝 신청이 성공적으로 접수되었습니다.<br />
              검토 후 연락드리겠습니다.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-2xl bg-white border-gray-200 max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold text-foreground">
            트레이닝 신청
          </DialogTitle>
          {selectedProgram && (
            <p className="text-muted-foreground text-sm">
              선택된 프로그램: {selectedProgram.title}
            </p>
          )}
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          {/* Personal Information */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name" className="text-foreground">이름 *</Label>
              <Input
                id="name"
                {...register("name")}
                className="bg-white border-gray-300 text-foreground focus:border-primary"
                placeholder="홍길동"
              />
              {errors.name && (
                <p className="text-red-600 text-sm">{errors.name.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone" className="text-foreground">연락처 *</Label>
              <Input
                id="phone"
                type="tel"
                {...register("phone")}
                className="bg-white border-gray-300 text-foreground focus:border-primary"
                placeholder="010-1234-5678"
              />
              {errors.phone && (
                <p className="text-red-600 text-sm">{errors.phone.message}</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-foreground">이메일 *</Label>
              <Input
                id="email"
                type="email"
                {...register("email")}
                className="bg-white border-gray-300 text-foreground focus:border-primary"
                placeholder="hong@example.com"
              />
              {errors.email && (
                <p className="text-red-600 text-sm">{errors.email.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="chapter" className="text-foreground">소속 챕터</Label>
              <Input
                id="chapter"
                {...register("chapter")}
                className="bg-white border-gray-300 text-foreground focus:border-primary"
                placeholder="예: 강남챕터"
              />
            </div>
          </div>

          {/* Training Type Selection */}
          <div className="space-y-3">
            <Label className="text-foreground">참여 방식 *</Label>
            <RadioGroup
              value={trainingType}
              onValueChange={(value) => setValue("trainingType", value as "live" | "recorded")}
              className="space-y-2"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem
                  value="live"
                  id="live"
                  className="text-primary border-gray-300"
                />
                <Label htmlFor="live" className="text-foreground font-normal">
                  실시간 강의 참여
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem
                  value="recorded"
                  id="recorded"
                  className="text-primary border-gray-300"
                />
                <Label htmlFor="recorded" className="text-foreground font-normal">
                  녹화본 시청
                </Label>
              </div>
            </RadioGroup>
            {errors.trainingType && (
              <p className="text-red-600 text-sm">{errors.trainingType.message}</p>
            )}
          </div>

          {/* Additional Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes" className="text-foreground">특이사항 또는 문의</Label>
            <Textarea
              id="notes"
              {...register("notes")}
              className="bg-white border-gray-300 text-foreground focus:border-primary resize-none"
              placeholder="특별히 전달하고 싶은 내용이 있으시면 작성해주세요"
              rows={3}
            />
          </div>

          {/* Submit Buttons */}
          <div className="flex space-x-4 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={isSubmitting}
              className="flex-1 border-gray-300 text-muted-foreground hover:bg-gray-50"
            >
              취소
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 bni-button-primary disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  제출 중...
                </>
              ) : (
                "신청하기"
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { TrainingProgram, SecondaryProgram } from "@shared/schema";

const applicationSchema = z.object({
  region: z.string().min(1, "지역을 선택해주세요"),
  chapter: z.string().min(1, "챕터명을 입력해주세요"),
  name: z.string().min(1, "멤버명을 입력해주세요"),
  phone: z.string().min(1, "연락처를 입력해주세요"),
  email: z.string().email("올바른 이메일 주소를 입력해주세요"),
  participationType: z.enum(["실시간 참여", "녹화본 시청"], {
    required_error: "참여 방식을 선택해주세요",
  }),
  notes: z.string().optional(),
});

type ApplicationFormData = z.infer<typeof applicationSchema>;

interface ApplicationFormProps {
  program: TrainingProgram | SecondaryProgram | null;
  onSuccess?: () => void;
}

export function ApplicationForm({ program, onSuccess }: ApplicationFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const form = useForm<ApplicationFormData>({
    resolver: zodResolver(applicationSchema),
    defaultValues: {
      region: "",
      chapter: "",
      name: "",
      phone: "",
      email: "",
      participationType: "실시간 참여",
      notes: "",
    },
  });

  const submitMutation = useMutation({
    mutationFn: async (data: ApplicationFormData) => {
      return apiRequest("POST", "/api/applications", {
        ...data,
        programId: program?.id || "",
        programTitle: program?.title || "",
        trainingType: data.participationType === "실시간 참여" ? "live" : "recorded",
      });
    },
    onSuccess: () => {
      toast({
        title: "신청 완료",
        description: "트레이닝 신청이 성공적으로 제출되었습니다. BNI Korea Store에서 결제를 진행해주세요.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/applications"] });
      form.reset();
      
      // Notify parent component of success
      setTimeout(() => {
        onSuccess?.();
      }, 1000);
    },
    onError: (error: any) => {
      const isDuplicate = error?.status === 409 || (error?.message && error.message.includes("409"));
      
      toast({
        title: isDuplicate ? "접수보류" : "신청 실패",
        description: isDuplicate 
          ? "앗, 대표님, 이미 동일 과목에 신청이 완료되신 것으로 보입니다 !\n\n신청현황 대시보드 > 신청자 명단에서 확인하실 수 있어요 :)"
          : (error instanceof Error ? error.message : "신청 처리 중 오류가 발생했습니다."),
        variant: "destructive",
      });
    },
  });

  const onSubmit = async (data: ApplicationFormData) => {
    setIsSubmitting(true);
    try {
      await submitMutation.mutateAsync(data);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <Card className="border-red-200 dark:border-red-800">
        <CardHeader 
          className="bg-red-600 dark:bg-red-600" 
          style={{ backgroundColor: '#dc2626 !important' }}
        >
          <CardTitle 
            className="text-white dark:text-white font-bold"
            style={{ color: '#ffffff !important' }}
          >
            {program?.title || "프로그램"}
          </CardTitle>
          <CardDescription 
            className="text-white dark:text-white"
            style={{ color: '#ffffff !important' }}
          >
            신청서를 작성해주세요. 모든 필수 항목을 입력해야 합니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-6">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              {/* A : 지역 */}
              <FormField
                control={form.control}
                name="region"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>지역 *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="지역을 선택해주세요" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="부산1">부산1</SelectItem>
                        <SelectItem value="강남">강남</SelectItem>
                        <SelectItem value="송파">송파</SelectItem>
                        <SelectItem value="인천">인천</SelectItem>
                        <SelectItem value="대전">대전</SelectItem>
                        <SelectItem value="용인">용인</SelectItem>
                        <SelectItem value="고양">고양</SelectItem>
                        <SelectItem value="중구">중구</SelectItem>
                        <SelectItem value="성동">성동</SelectItem>
                        <SelectItem value="화성">화성</SelectItem>
                        <SelectItem value="창원1">창원1</SelectItem>
                        <SelectItem value="강서">강서</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* B : 챕터 */}
              <FormField
                control={form.control}
                name="chapter"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>챕터 *</FormLabel>
                    <FormControl>
                      <Input placeholder="소속 챕터명을 입력해주세요 (예: 서울강남)" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* C : 멤버명 */}
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>멤버명 *</FormLabel>
                    <FormControl>
                      <Input placeholder="성명을 입력해주세요" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* D : 연락처(H.P) */}
              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>연락처(H.P) *</FormLabel>
                    <FormControl>
                      <Input placeholder="010-1234-5678" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* E : 이메일 */}
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>이메일 *</FormLabel>
                    <FormControl>
                      <Input 
                        type="email" 
                        placeholder="example@email.com" 
                        {...field} 
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* F : 참여 방식 */}
              <FormField
                control={form.control}
                name="participationType"
                render={({ field }) => (
                  <FormItem className="space-y-3">
                    <FormLabel>참여 방식 *</FormLabel>
                    <FormControl>
                      <RadioGroup
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                        className="flex flex-col space-y-1"
                      >
                        <div className="flex items-center space-x-2">
                          <RadioGroupItem value="실시간 참여" id="live" />
                          <Label htmlFor="live">실시간 참여</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <RadioGroupItem value="녹화본 시청" id="recorded" />
                          <Label htmlFor="recorded">녹화본 시청</Label>
                        </div>
                      </RadioGroup>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* G : 특이사항 & 문의 */}
              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>특이사항 & 문의</FormLabel>
                    <FormControl>
                      <Textarea 
                        placeholder="추가로 전달할 내용이나 문의사항이 있으시면 입력해주세요 (선택사항)"
                        className="min-h-[100px]"
                        {...field} 
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex gap-4 pt-4">
                <Button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white"
                >
                  {isSubmitting ? "제출 중..." : "신청하기"}
                </Button>
              </div>
            </form>
          </Form>

          {program && 'paymentLink' in program && program.paymentLink && (
            <div className="mt-6 p-4 bg-gray-100 border border-red-600 rounded-lg">
              <p className="text-sm text-gray-600">
                <strong>결제 안내:</strong> 신청 완료 후 자동으로 결제 페이지로 이동됩니다.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
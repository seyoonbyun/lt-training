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
import { openTossPayment, type PreparedOrder } from "@/lib/toss-payment";
import { REGIONS, chaptersOf, OTHER_CHAPTER } from "@/lib/regions";
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
  // 코어 그룹처럼 목록에 없는 챕터는 '기타'를 골라 직접 입력한다
  const [chapterDirect, setChapterDirect] = useState(false);
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
      // 신청 접수와 주문 생성을 한 번에 한다. 금액은 서버가 시트에서 읽으므로 보내지 않는다.
      const response = await apiRequest("POST", "/api/payments/prepare", {
        ...data,
        programId: program?.id || "",
        programTitle: program?.title || "",
        trainingType: data.participationType === "실시간 참여" ? "live" : "recorded",
      });
      return (await response.json()) as PreparedOrder;
    },
    onSuccess: async (order) => {
      queryClient.invalidateQueries({ queryKey: ["/api/applications"] });

      toast({
        title: "결제창을 엽니다",
        description: "결제를 완료하셔야 신청이 확정됩니다.",
      });

      try {
        // 결제창이 뜨면 토스 도메인으로 넘어가고, 끝나면 /payment/success 로 돌아온다.
        await openTossPayment(order);
      } catch (error: any) {
        // 사용자가 결제창을 닫은 경우도 여기로 온다.
        toast({
          title: "결제가 진행되지 않았습니다",
          description:
            error?.message ||
            "결제창이 닫혔습니다. 신청은 접수되었으나 결제를 완료하셔야 확정됩니다.",
          variant: "destructive",
        });
      }
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
                    <Select
                      onValueChange={(value) => {
                        field.onChange(value);
                        // 지역이 바뀌면 이전 지역의 챕터가 남지 않도록 비운다
                        form.setValue("chapter", "");
                        setChapterDirect(false);
                      }}
                      value={field.value}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="지역을 선택해주세요" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {REGIONS.map((region) => (
                          <SelectItem key={region} value={region}>{region}</SelectItem>
                        ))}
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
                render={({ field }) => {
                  const region = form.watch("region");
                  const chapters = chaptersOf(region);

                  return (
                    <FormItem>
                      <FormLabel>챕터 *</FormLabel>
                      {chapterDirect ? (
                        <div className="space-y-2">
                          <FormControl>
                            <Input placeholder="챕터명을 입력해주세요" {...field} />
                          </FormControl>
                          <button
                            type="button"
                            className="text-xs text-red-600 underline"
                            onClick={() => {
                              setChapterDirect(false);
                              form.setValue("chapter", "");
                            }}
                          >
                            목록에서 선택하기
                          </button>
                        </div>
                      ) : (
                        <Select
                          onValueChange={(value) => {
                            if (value === OTHER_CHAPTER) {
                              setChapterDirect(true);
                              form.setValue("chapter", "");
                              return;
                            }
                            field.onChange(value);
                          }}
                          value={field.value}
                          disabled={!region}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue
                                placeholder={region ? "챕터를 선택해주세요" : "지역을 먼저 선택해주세요"}
                              />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {chapters.map((chapter) => (
                              <SelectItem key={chapter} value={chapter}>{chapter}</SelectItem>
                            ))}
                            <SelectItem value={OTHER_CHAPTER}>{OTHER_CHAPTER}</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                      <FormMessage />
                    </FormItem>
                  );
                }}
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
                  {isSubmitting ? "결제창 여는 중..." : "신청하고 결제하기"}
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
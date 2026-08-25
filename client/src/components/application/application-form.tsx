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
import { startPayment, type PreparedOrder } from "@/lib/toss-payment";
import { Check } from "lucide-react";
import { REGIONS, chaptersOf, OTHER_CHAPTER } from "@/lib/regions";
import type { TrainingProgram, SecondaryProgram } from "@shared/schema";
import { PaymentInterruptedDialog } from "./payment-interrupted";

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
  /** 신청 가능한 전체 과목. 신청자가 이 중에서 원하는 만큼 고른다 */
  programs: SecondaryProgram[];
  /** 캘린더에서 보고 들어온 과목이 있으면 미리 체크해 둔다 */
  initialTitles?: string[];
  onSuccess?: () => void;
}

export function ApplicationForm({ programs, initialTitles = [], onSuccess }: ApplicationFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  // 코어 그룹처럼 목록에 없는 챕터는 '기타'를 골라 직접 입력한다
  const [chapterDirect, setChapterDirect] = useState(false);
  // 신청서 한 장으로 여러 과목을 담는다. 과목 하나만 골라도, 열 개를 다 골라도 결제는 한 번이다.
  const [selectedTitles, setSelectedTitles] = useState<string[]>(initialTitles);
  const [sessionError, setSessionError] = useState<string | null>(null);
  // 결제창을 닫으면 토스트 대신 이 화면이 남는다 — 그 자리에서 결제를 이어갈 수 있다.
  const [interrupted, setInterrupted] = useState<{ token?: string; reason?: string } | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const selectablePrograms = programs.filter((program) => program.isAvailable);
  const selectedPrograms = selectablePrograms.filter((program) => selectedTitles.includes(program.title));
  const totalAmount = selectedPrograms.reduce((sum, program) => sum + (program.price || 0), 0);
  const allSelected =
    selectablePrograms.length > 0 && selectedPrograms.length === selectablePrograms.length;

  const toggleTitle = (title: string) => {
    setSessionError(null);
    setSelectedTitles((prev) =>
      prev.includes(title) ? prev.filter((t) => t !== title) : [...prev, title]
    );
  };

  const toggleAll = () => {
    setSessionError(null);
    setSelectedTitles(allSelected ? [] : selectablePrograms.map((program) => program.title));
  };

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
      // 신청 접수와 주문 생성을 한 번에 한다. 금액은 서버가 시트 L열에서 읽으므로 보내지 않는다.
      const response = await apiRequest("POST", "/api/payments/prepare", {
        ...data,
        programId: selectedPrograms[0]?.id || "",
        programTitle: selectedPrograms[0]?.title || "",
        programTitles: selectedPrograms.map((program) => program.title),
        trainingType: data.participationType === "실시간 참여" ? "live" : "recorded",
      });
      return (await response.json()) as PreparedOrder;
    },
    onSuccess: async (order) => {
      queryClient.invalidateQueries({ queryKey: ["/api/applications"] });

      // 고른 과목 중 일부만 이미 신청한 경우. 서버가 그 과목을 빼고 접수했으므로
      // 말해 주지 않으면 결제 금액이 왜 줄었는지 알 수 없다.
      const skipped = order.skippedDuplicates || [];
      if (skipped.length > 0) {
        toast({
          title: "이미 신청하신 내역이 있습니다",
          description: `${skipped.join(", ")} 은(는) 이미 신청이 완료되어 이번 결제에서 빠졌습니다.`,
        });
      }

      toast({
        title: order.free ? "지원 대상으로 확인되었습니다" : "결제창을 엽니다",
        description: order.free
          ? "교육비 지원 대상이라 0원으로 신청이 확정됩니다."
          : "결제를 완료하셔야 신청이 확정됩니다.",
      });

      try {
        // 결제창이 뜨면 토스 도메인으로 넘어가고, 끝나면 /payment/success 로 돌아온다.
        await startPayment(order);
      } catch (error: any) {
        // 사용자가 결제창을 닫은 경우도 여기로 온다.
        // 토스트는 떴다 사라져 아무것도 남기지 못한다 — 이어하기 버튼이 있는 화면을 띄운다.
        setInterrupted({ token: (order as any)?.resumeToken, reason: error?.message });
      }
    },
    onError: (error: any) => {
      const isDuplicate = error?.status === 409 || (error?.message && error.message.includes("409"));
      
      toast({
        title: isDuplicate ? "이미 신청하신 내역이 있습니다" : "신청 실패",
        description: isDuplicate 
          ? "앗, 대표님, 이미 동일 과목에 신청이 완료되신 것으로 보입니다 !\n\n신청현황 대시보드 > 신청자 명단에서 확인하실 수 있어요 :)"
          : (error instanceof Error ? error.message : "신청 처리 중 오류가 발생했습니다."),
        variant: "destructive",
      });
    },
  });

  const onSubmit = async (data: ApplicationFormData) => {
    if (selectedPrograms.length === 0) {
      setSessionError("신청하실 과목을 하나 이상 선택해주세요");
      return;
    }
    setIsSubmitting(true);
    try {
      await submitMutation.mutateAsync(data);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <PaymentInterruptedDialog
        open={interrupted !== null}
        onClose={() => setInterrupted(null)}
        resumeToken={interrupted?.token}
        reason={interrupted?.reason}
      />
      <Card className="border-red-200 dark:border-red-800">
        <CardHeader 
          className="bg-red-600 dark:bg-red-600" 
          style={{ backgroundColor: '#dc2626 !important' }}
        >
          <CardTitle 
            className="text-white dark:text-white font-bold"
            style={{ color: '#ffffff !important' }}
          >
            리더십 트레이닝 신청
          </CardTitle>
          <CardDescription 
            className="text-white dark:text-white"
            style={{ color: '#ffffff !important' }}
          >
            신청하실 과목을 고르고 신청서를 작성해주세요. 여러 과목을 함께 신청하시면 한 번에 결제됩니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-6">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              {/* 과목 선택 — 신청서 한 장으로 여러 과목을 담는다 */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">신청 과목 *</Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={toggleAll}
                    disabled={selectablePrograms.length === 0}
                  >
                    {allSelected ? "전체 해제" : "전체 선택"}
                  </Button>
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  {selectablePrograms.map((program) => {
                    const checked = selectedTitles.includes(program.title);
                    return (
                      <button
                        key={program.id}
                        type="button"
                        role="checkbox"
                        aria-checked={checked}
                        onClick={() => toggleTitle(program.title)}
                        className={`flex items-start gap-2 rounded-md border p-3 text-left transition-colors ${
                          checked
                            ? "border-red-600 bg-red-50 dark:bg-red-950/30"
                            : "border-gray-200 dark:border-gray-700 hover:border-red-300"
                        }`}
                      >
                        <span
                          aria-hidden="true"
                          className={`mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-sm border ${
                            checked ? "border-red-600 bg-red-600 text-white" : "border-gray-300 dark:border-gray-600"
                          }`}
                        >
                          {checked && <Check className="h-3 w-3" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium truncate">{program.title}</span>
                          <span className="block text-xs text-muted-foreground">
                            {program.date} · {program.time}
                          </span>
                          <span className="block text-xs text-red-600">
                            {(program.price || 0).toLocaleString()}원
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>

                {selectablePrograms.length === 0 && (
                  <p className="text-sm text-muted-foreground">신청 가능한 과목이 없습니다.</p>
                )}

                <div className="flex items-center justify-between rounded-md bg-gray-50 dark:bg-gray-900/40 px-4 py-3">
                  <span className="text-sm text-muted-foreground">
                    선택 {selectedPrograms.length}과목
                  </span>
                  <span className="text-base font-bold text-red-600">
                    합계 {totalAmount.toLocaleString()}원
                  </span>
                </div>

                {sessionError && <p className="text-sm font-medium text-destructive">{sessionError}</p>}
              </div>

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
                  {isSubmitting
                    ? "결제창 여는 중..."
                    : selectedPrograms.length > 0
                      ? `${selectedPrograms.length}과목 ${totalAmount.toLocaleString()}원 결제하기`
                      : "신청하고 결제하기"}
                </Button>
              </div>
            </form>
          </Form>

        </CardContent>
      </Card>
    </div>
  );
}
import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { REGIONS, chaptersOf, OTHER_CHAPTER } from "@/lib/regions";
import { startPayment } from "@/lib/toss-payment";
import { PaymentInterruptedDialog } from "./payment-interrupted";
import { Check, Plus, Trash2, Users, Copy } from "lucide-react";
import type { SecondaryProgram } from "@shared/schema";

interface BulkUploadProps {
  /** 신청 가능한 전체 과목 */
  programs: SecondaryProgram[];
  onSuccess?: () => void;
}

/** 명단 한 줄 = 그 과목을 실제로 수강할 사람 */
interface Attendee {
  id: string;
  name: string;
  phone: string;
  email: string;
  participationType: string;
}

interface ApplicationPayload {
  programTitle: string;
  region: string;
  chapter: string;
  name: string;
  phone: string;
  email: string;
  participationType: string;
  notes: string;
  trainingType: "live" | "recorded";
}

let seq = 0;
const newAttendee = (): Attendee => ({
  id: `att-${++seq}`,
  name: "",
  phone: "",
  email: "",
  participationType: "실시간 참여",
});

/** 이름이 있어야 한 사람으로 센다. 연락처·이메일은 선택값이다 */
const isBlank = (attendee: Attendee) => !attendee.name.trim();

/**
 * 실제로 접수될 참여 방식. 과목의 실시간 참여가 마감됐으면(세션등록 N열)
 * 무조건 녹화본이다 — 화면·검증·전송이 **같은 함수**를 보게 해서
 * "화면엔 실시간인데 서버가 튕긴다" 는 어긋남을 막는다.
 */
const effectiveType = (program: SecondaryProgram, attendee: Attendee) =>
  program.isLiveAvailable === false ? "녹화본 시청" : attendee.participationType;

export function BulkUpload({ programs, onSuccess }: BulkUploadProps) {
  const [selectedTitles, setSelectedTitles] = useState<string[]>([]);
  const [rosters, setRosters] = useState<Record<string, Attendee[]>>({});
  // 결제자가 그 지역·챕터의 대표라, 여기서 받은 소속을 명단 전원에 그대로 쓴다
  const [payer, setPayer] = useState({
    name: "",
    phone: "",
    email: "",
    region: "",
    chapter: "",
    chapterDirect: false,
  });
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  // 결제창을 닫으면 토스트 대신 이 화면이 남는다 — 명단을 다시 입력하지 않고 결제만 이어간다.
  const [interrupted, setInterrupted] = useState<{ token?: string; reason?: string } | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const availablePrograms = useMemo(
    () => programs.filter((program) => program.isAvailable),
    [programs]
  );

  // 화면 순서는 과목 목록 순서를 따른다 (고른 순서가 아니라)
  const selectedPrograms = availablePrograms.filter((program) => selectedTitles.includes(program.title));

  const rosterOf = (title: string) => rosters[title] ?? [];
  const countedOf = (title: string) => rosterOf(title).filter((attendee) => !isBlank(attendee));

  const totalEntries = selectedPrograms.reduce((sum, program) => sum + countedOf(program.title).length, 0);
  const totalAmount = selectedPrograms.reduce(
    (sum, program) => sum + countedOf(program.title).length * (program.price || 0),
    0
  );
  const distinctPeople = new Set(
    selectedPrograms.flatMap((program) =>
      countedOf(program.title).map((attendee) => attendee.phone.replace(/\D/g, "") || attendee.name.trim())
    )
  ).size;

  const toggleTitle = (title: string) => {
    setSelectedTitles((prev) => {
      if (prev.includes(title)) return prev.filter((t) => t !== title);
      // 과목을 고르면 빈 수강자 한 줄로 명단을 연다
      setRosters((current) => (current[title]?.length ? current : { ...current, [title]: [newAttendee()] }));
      return [...prev, title];
    });
  };

  const updateAttendee = (title: string, id: string, patch: Partial<Attendee>) => {
    setRosters((prev) => ({
      ...prev,
      [title]: (prev[title] ?? []).map((attendee) =>
        attendee.id === id ? { ...attendee, ...patch } : attendee
      ),
    }));
  };

  const addAttendee = (title: string) =>
    setRosters((prev) => ({ ...prev, [title]: [...(prev[title] ?? []), newAttendee()] }));

  const removeAttendee = (title: string, id: string) =>
    setRosters((prev) => {
      const next = (prev[title] ?? []).filter((attendee) => attendee.id !== id);
      return { ...prev, [title]: next.length > 0 ? next : [newAttendee()] };
    });

  /** 앞 과목에 적은 명단을 그대로 가져온다 (같은 사람들이 여러 과목을 들을 때) */
  const copyRosterFrom = (fromTitle: string, toTitle: string) => {
    const source = rosterOf(fromTitle).filter((attendee) => !isBlank(attendee));
    if (source.length === 0) {
      toast({ title: "가져올 명단이 없습니다", description: `${fromTitle}에 먼저 수강자를 입력해주세요.`, variant: "destructive" });
      return;
    }
    setRosters((prev) => ({
      ...prev,
      [toTitle]: source.map((attendee) => ({ ...attendee, id: `att-${++seq}` })),
    }));
    toast({ title: `${source.length}명을 가져왔습니다` });
  };

  // ── 제출 ────────────────────────────────────────────────────────────────
  const submitMutation = useMutation({
    mutationFn: async (applications: ApplicationPayload[]) => {
      // 금액과 수량은 서버가 시트에서 다시 계산한다. 클라이언트 값은 쓰이지 않는다.
      const res = await apiRequest("POST", "/api/payments/prepare-bulk", { applications, payer });
      return res.json();
    },
    onSuccess: async (order: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/applications"] });

      const skipped = order.skippedDuplicates || [];
      // 명단이 전원 교육비 지원 대상이면 청구액이 0원이라 결제창을 띄우지 않는다.
      // "결제창을 엽니다" 라고 해 놓고 안 뜨면 이탈한 것으로 오해한다.
      const skippedLine =
        skipped.length > 0 ? `\n\n이미 신청된 건은 제외했습니다: ${skipped.join(", ")}` : "";
      toast({
        title: order.free
          ? `${order.memberCount || 0}명 · ${order.quantity}건 접수 · 교육비 지원 대상입니다`
          : `${order.memberCount || 0}명 · ${order.quantity}건 접수 · 결제창을 엽니다`,
        description: order.free
          ? `결제 없이 신청이 확정됩니다.${skippedLine}`
          : (skipped.length > 0
              ? `${skippedLine.trim()}\n\n제외분을 뺀 금액으로 결제됩니다.`
              : "결제를 완료하셔야 신청이 확정됩니다."),
      });

      try {
        await startPayment(order);
      } catch (error: any) {
        // 토스트는 떴다 사라진다. 단체 신청은 명단을 다시 입력해야 해서 이탈 손실이 더 크다.
        setInterrupted({ token: order?.resumeToken, reason: error?.message });
      }
    },
    onError: (error: any) => {
      const isDuplicate = error?.status === 409 || (error?.message && error.message.includes("409"));
      toast({
        title: isDuplicate ? "접수보류" : "일괄 신청 실패",
        description: isDuplicate
          ? "명단이 모두 이미 신청 완료된 건으로 보입니다.\n\n신청현황 대시보드 > 신청자 명단에서 확인하실 수 있어요 :)"
          : error instanceof Error
            ? error.message
            : "신청 처리 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = async () => {
    if (selectedPrograms.length === 0) {
      toast({ title: "과목을 선택해주세요", description: "신청하실 과목을 먼저 고르시면 명단을 적으실 수 있습니다.", variant: "destructive" });
      return;
    }

    const problems: string[] = [];
    const applications: ApplicationPayload[] = [];

    selectedPrograms.forEach((program) => {
      const counted = countedOf(program.title);
      const short = program.title.replace(/^LTT\s*:\s*/, "");

      if (counted.length === 0) {
        problems.push(`${short}: 수강자가 없습니다`);
        return;
      }

      // 이름 없이 연락처만 적힌 줄은 조용히 빠지므로 짚어준다
      rosterOf(program.title).forEach((attendee, index) => {
        if (!attendee.name.trim() && (attendee.phone.trim() || attendee.email.trim())) {
          problems.push(`${short} ${index + 1}번: 수강자 성명 누락`);
        }
      });

      counted.forEach((attendee) => {
        applications.push({
          programTitle: program.title,
          region: payer.region,
          chapter: payer.chapter.trim(),
          name: attendee.name.trim(),
          phone: attendee.phone.trim(),
          email: attendee.email.trim(),
          participationType: effectiveType(program, attendee),
          notes: "",
          trainingType: effectiveType(program, attendee).includes("실시간") ? "live" : "recorded",
        });
      });
    });

    if (problems.length > 0) {
      toast({
        title: "명단을 확인해주세요",
        description:
          problems.slice(0, 4).join("\n") + (problems.length > 4 ? `\n...그 외 ${problems.length - 4}건` : ""),
        variant: "destructive",
      });
      return;
    }

    if (!payer.name.trim() || !payer.phone.trim() || !payer.email.trim()) {
      toast({
        title: "결제자 정보 필요",
        description: "결제하시는 분의 성명·연락처·이메일을 입력해주세요. 영수증과 결제 문의에 쓰입니다.",
        variant: "destructive",
      });
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payer.email.trim())) {
      toast({
        title: "이메일을 확인해주세요",
        description: "결제 영수증이 가는 주소입니다. 올바른 이메일 주소를 입력해주세요.",
        variant: "destructive",
      });
      return;
    }
    if (!payer.region || !payer.chapter.trim()) {
      toast({
        title: "소속 정보 필요",
        description: "결제자 정보에 지역과 챕터를 입력해주세요. 명단 전원의 소속으로 기록됩니다.",
        variant: "destructive",
      });
      return;
    }

    setIsProcessing(true);
    setProgress(40);
    try {
      await submitMutation.mutateAsync(applications);
      setProgress(100);
    } finally {
      setIsProcessing(false);
    }
  };

  const chapterSelect = (
    region: string,
    chapter: string,
    direct: boolean,
    onChange: (patch: { chapter?: string; chapterDirect?: boolean }) => void,
    placeholder = "챕터 *"
  ) =>
    direct ? (
      <div className="flex gap-2">
        <Input
          placeholder="챕터명 직접 입력 *"
          value={chapter}
          onChange={(e) => onChange({ chapter: e.target.value })}
        />
        <Button type="button" variant="outline" size="sm" onClick={() => onChange({ chapterDirect: false, chapter: "" })}>
          목록
        </Button>
      </div>
    ) : (
      <Select
        value={chapter}
        disabled={!region}
        onValueChange={(value) =>
          value === OTHER_CHAPTER ? onChange({ chapterDirect: true, chapter: "" }) : onChange({ chapter: value })
        }
      >
        <SelectTrigger>
          <SelectValue placeholder={region ? placeholder : "지역을 먼저 선택"} />
        </SelectTrigger>
        <SelectContent>
          {(region ? chaptersOf(region) : []).map((name) => (
            <SelectItem key={name} value={name}>
              {name}
            </SelectItem>
          ))}
          <SelectItem value={OTHER_CHAPTER}>{OTHER_CHAPTER}</SelectItem>
        </SelectContent>
      </Select>
    );

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <PaymentInterruptedDialog
        open={interrupted !== null}
        onClose={() => setInterrupted(null)}
        resumeToken={interrupted?.token}
        reason={interrupted?.reason}
      />
      <Card className="border-red-200 dark:border-red-800">
        <CardHeader className="bg-red-600" style={{ backgroundColor: "#dc2626" }}>
          <CardTitle className="flex items-center gap-2 text-white" style={{ color: "#ffffff" }}>
            <Users className="w-5 h-5" />
            일괄 신청
          </CardTitle>
          <CardDescription className="text-white" style={{ color: "#ffffff" }}>
            과목을 고르고, 그 수업을 실제로 들으실 분들을 적어주세요. 결제하시는 분과 달라도 됩니다.
          </CardDescription>
        </CardHeader>

        <CardContent className="p-6 space-y-6">
          {/* 1. 과목 선택 */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">1. 신청 과목 *</Label>

            <div className="grid gap-2 sm:grid-cols-2">
              {availablePrograms.map((program) => {
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
                      <span className="block text-xs text-red-600">{(program.price || 0).toLocaleString()}원</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 3. 과목별 수강자 명단 */}
          <div className="space-y-4">
            <div>
              <Label className="text-sm font-medium">2. 과목별 수강자 명단 *</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                각 과목을 실제로 수강하실 분입니다. 이수 등록도 이 명단 기준이며, 성명만 필수입니다.
              </p>
            </div>

            {selectedPrograms.length === 0 ? (
              <p className="rounded-md border border-dashed border-gray-300 dark:border-gray-700 py-8 text-center text-sm text-muted-foreground">
                위에서 과목을 선택하시면 수강자를 입력하실 수 있습니다.
              </p>
            ) : (
              selectedPrograms.map((program, programIndex) => {
                const roster = rosterOf(program.title);
                const counted = countedOf(program.title).length;
                const firstTitle = selectedPrograms[0].title;

                return (
                  <div
                    key={program.id}
                    className="rounded-lg border border-red-200 dark:border-red-800 overflow-hidden"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 bg-red-50 dark:bg-red-950/30 px-4 py-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold truncate">{program.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {program.date} · 1인 {(program.price || 0).toLocaleString()}원
                        </p>
                        {program.isLiveAvailable === false && (
                          /* ⛔ 회색(text-gray-600 dark:text-gray-300)은 이 자주색 헤더에 묻혀
                             안 읽힌다(2026-08-31 지적). 같은 칸의 '0명 · 0원' 과 같은 레드로 쓴다. */
                          <p className="text-xs font-medium text-red-600">
                            실시간 참여 신청이 마감된 과목입니다. 명단 전원 녹화본 시청으로 접수됩니다.
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        {programIndex > 0 && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => copyRosterFrom(firstTitle, program.title)}
                          >
                            <Copy className="w-3.5 h-3.5 mr-1.5" />
                            첫 과목 명단 가져오기
                          </Button>
                        )}
                        <span className="text-sm font-bold text-red-600 whitespace-nowrap">
                          {counted}명 · {(counted * (program.price || 0)).toLocaleString()}원
                        </span>
                      </div>
                    </div>

                    <div className="p-4 space-y-3">
                      {roster.map((attendee, index) => (
                        <div key={attendee.id} className="space-y-2">
                          <div className="flex items-start gap-2">
                            <span className="mt-2.5 w-6 flex-shrink-0 text-xs text-muted-foreground">
                              {index + 1}
                            </span>
                            <div className="grid flex-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                              <Input
                                placeholder="수강자 성명 *"
                                value={attendee.name}
                                onChange={(e) => updateAttendee(program.title, attendee.id, { name: e.target.value })}
                              />
                              <Input
                                placeholder="연락처 (선택)"
                                value={attendee.phone}
                                onChange={(e) => updateAttendee(program.title, attendee.id, { phone: e.target.value })}
                              />
                              <Input
                                type="email"
                                placeholder="이메일 (선택)"
                                value={attendee.email}
                                onChange={(e) => updateAttendee(program.title, attendee.id, { email: e.target.value })}
                              />
                              {/* 마감된 과목이라도 셀렉트 자체는 살려 둔다 — 통째로 잠그면
                                  고른 값(녹화본 시청)까지 흐려져 **VOD 도 안 된다**는 뜻으로 읽힌다.
                                  개별 신청과 똑같이 **실시간 항목만** 못 고르게 한다. */}
                              <Select
                                value={effectiveType(program, attendee)}
                                onValueChange={(value) =>
                                  updateAttendee(program.title, attendee.id, { participationType: value })
                                }
                              >
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="실시간 참여" disabled={program.isLiveAvailable === false}>
                                    실시간 참여{program.isLiveAvailable === false ? " (마감)" : ""}
                                  </SelectItem>
                                  <SelectItem value="녹화본 시청">녹화본 시청</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="mt-0.5"
                              onClick={() => removeAttendee(program.title, attendee.id)}
                              aria-label={`${index + 1}번 수강자 삭제`}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>

                        </div>
                      ))}

                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => addAttendee(program.title)}
                        className="w-full"
                      >
                        <Plus className="w-4 h-4 mr-2" />
                        수강자 추가
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* 4. 결제자 */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">3. 결제자 정보 *</Label>
            <p className="text-xs text-muted-foreground">
              챕터를 대표해 결제하시는 분입니다. 결제 영수증은 여기 적으신 이메일로 갑니다.
              여기 적으신 <strong>지역·챕터가 위 명단 전원의 소속</strong>으로 기록됩니다.
              이 분이 수강하지 않으셔도 되며, 직접 수강하신다면 위 명단에도 함께 적어주세요.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Select
                value={payer.region}
                onValueChange={(value) =>
                  setPayer((v) => ({ ...v, region: value, chapter: "", chapterDirect: false }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="지역 *" />
                </SelectTrigger>
                <SelectContent>
                  {REGIONS.map((region) => (
                    <SelectItem key={region} value={region}>
                      {region}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {chapterSelect(payer.region, payer.chapter, payer.chapterDirect, (patch) =>
                setPayer((prev) => ({ ...prev, ...patch }))
              )}
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <Input
                placeholder="결제자 성명 *"
                value={payer.name}
                onChange={(e) => setPayer((v) => ({ ...v, name: e.target.value }))}
              />
              <Input
                placeholder="결제자 연락처 * (010-1234-5678)"
                value={payer.phone}
                onChange={(e) => setPayer((v) => ({ ...v, phone: e.target.value }))}
              />
              <Input
                type="email"
                placeholder="결제자 이메일 *"
                value={payer.email}
                onChange={(e) => setPayer((v) => ({ ...v, email: e.target.value }))}
              />
            </div>
          </div>

          {/* 합계 */}
          <div className="flex items-center justify-between rounded-md bg-gray-50 dark:bg-gray-900/40 px-4 py-3">
            <span className="text-sm text-muted-foreground">
              {selectedPrograms.length}과목 · 수강자 {distinctPeople}명 · 신청 {totalEntries}건
            </span>
            <span className="text-base font-bold text-red-600">합계 {totalAmount.toLocaleString()}원</span>
          </div>

          <Alert>
            <AlertDescription className="text-xs">
              이미 신청·결제된 분은 해당 과목만 자동으로 제외되고, 그만큼 금액도 줄어든 채로 결제창이 열립니다.
            </AlertDescription>
          </Alert>

          {isProcessing && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span>처리 중...</span>
                <span>{progress}%</span>
              </div>
              <Progress value={progress} className="w-full" />
            </div>
          )}

          <Button
            onClick={handleSubmit}
            disabled={isProcessing || totalEntries === 0}
            className="w-full bg-red-600 hover:bg-red-700 text-white"
          >
            {isProcessing
              ? "결제창 여는 중..."
              : totalEntries > 0
                ? `${totalEntries}건 ${totalAmount.toLocaleString()}원 결제하기`
                : "일괄 신청하고 결제하기"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

import { useState, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Upload, Download, FileText, CheckCircle, AlertCircle } from "lucide-react";

interface BulkUploadProps {
  onSuccess?: () => void;
  program?: {
    title: string;
    id: string;
    storeUrl?: string;
  };
}

interface ExcelRow {
  region: string;
  chapter: string;
  name: string;
  phone: string;
  email: string;
  participationType: string;
  notes: string;
  programTitle: string;
  trainingType: "live" | "recorded";
}

export function BulkUpload({ onSuccess, program }: BulkUploadProps) {
  const [file, setFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<{ success: number; error: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const uploadMutation = useMutation({
    mutationFn: async (applications: ExcelRow[]) => {
      const res = await apiRequest("POST", "/api/applications/bulk", {
        applications,
      });
      return res.json();
    },
    onSuccess: (data: any) => {
      setResults({ success: data.count || 1, error: 0 });
      queryClient.invalidateQueries({ queryKey: ["/api/applications"] });

      if (data.partialSuccess && data.skippedDuplicates?.length > 0) {
        toast({
          title: `일괄 신청 완료 (${data.count}명 접수)`,
          description: `신청이 완료되었습니다. 결제 페이지로 이동합니다.\n\n※ 이미 신청된 인원은 제외되었습니다: ${data.skippedDuplicates.join(', ')}`,
        });
      } else {
        toast({
          title: "일괄 신청 완료",
          description: "신청이 성공적으로 제출되었습니다. 결제 페이지로 이동합니다.",
        });
      }
      
      setTimeout(() => {
        const paymentUrl = program?.storeUrl || "https://bnikoreastore.com/surl/P/752";
        window.open(paymentUrl, "_blank");
        onSuccess?.();
      }, 2000);
    },
    onError: async (error: any) => {
      const isDuplicate = error?.status === 409 || (error?.message && error.message.includes("409"));
      
      if (isDuplicate) {
        toast({
          title: "접수보류",
          description: "앗, 대표님, 이미 동일 과목에 신청이 완료되신 것으로 보입니다 !\n\n신청현황 대시보드 > 신청자 명단에서 확인하실 수 있어요 :)",
          variant: "destructive",
        });
        return;
      }

      let errorBody: any = null;
      try {
        const msg = error instanceof Error ? error.message : String(error);
        const jsonMatch = msg.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          errorBody = JSON.parse(jsonMatch[0]);
        }
      } catch {}

      if (errorBody?.type === "validation") {
        const fieldKoreanMap: Record<string, string> = {
          "email": "올바른 이메일 주소를 입력해주세요",
          "phone": "올바른 연락처를 입력해주세요",
          "name": "멤버명을 입력해주세요",
          "region": "지역을 입력해주세요",
          "chapter": "챕터를 입력해주세요",
          "programTitle": "과목명을 입력해주세요",
          "participationType": "참여 방식을 입력해주세요",
        };

        const friendlyMessages: string[] = [];
        if (errorBody.fields && Array.isArray(errorBody.fields)) {
          for (const fieldMsg of errorBody.fields) {
            const fieldName = fieldMsg.split(":")[0]?.trim();
            friendlyMessages.push(fieldKoreanMap[fieldName] || fieldMsg);
          }
        }

        const rowInfo = errorBody.row ? `(${errorBody.row}행) ` : "";
        const nameInfo = errorBody.name ? `[${errorBody.name}] ` : "";

        toast({
          title: "일괄 신청 보류",
          description: `엇, 대표님 ! ${nameInfo}${rowInfo}명단의 양식에 오류가 있어 신청이 보류되었습니다.\n\n${friendlyMessages.length > 0 ? friendlyMessages.join('\n') : errorBody.message}`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "일괄 신청 보류",
          description: "엇, 대표님 ! 명단의 양식에 오류가 있어 신청이 보류되었습니다.\n\n다시 확인 후 시도해주세요.",
          variant: "destructive",
        });
      }
    },
  });

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setResults(null);
    }
  };

  const parseExcelFile = (file: File): Promise<ExcelRow[]> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: "array" });
          const sheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];
          const jsonData = XLSX.utils.sheet_to_json(worksheet);

          const applications: ExcelRow[] = jsonData.map((row: any) => {
            // 과목명 매칭 로직 개선 - 짧은 형태도 인식
            let matchedProgramTitle = row["과목명"] || program?.title || "선택된 프로그램";
            
            if (row["과목명"]) {
              const inputTitle = row["과목명"].toString().trim();
              
              // 과목명 매칭 맵 - 더 유연한 매칭 지원 (짧은 형태 → 전체 형태)
              const courseMap: Record<string, string> = {
                // 파운데이션 관련
                "파운데이션": "LTT : 파운데이션 T.",
                "Foundation": "LTT : 파운데이션 T.",
                
                // 멤버십 위원회 관련
                "멤버십": "LTT : 멤버십 위원회 T.",
                "멤버십 위원회": "LTT : 멤버십 위원회 T.",
                "멤버십위원회": "LTT : 멤버십 위원회 T.",
                "Membership": "LTT : 멤버십 위원회 T.",
                
                // PR 코디네이터 관련
                "PR": "LTT : PR 코디네이터T.",
                "PR 코디네이터": "LTT : PR 코디네이터T.",
                "PR코디네이터": "LTT : PR 코디네이터T.",
                "피알": "LTT : PR 코디네이터T.",
                
                // 교육 코디네이터 관련
                "교육": "LTT : 교육 코디네이터 T.",
                "교육 코디네이터": "LTT : 교육 코디네이터 T.",
                "교육코디네이터": "LTT : 교육 코디네이터 T.",
                "Education": "LTT : 교육 코디네이터 T.",
                
                // 성장 코디네이터 관련
                "성장": "LTT : 성장 코디네이터 T.",
                "성장 코디네이터": "LTT : 성장 코디네이터 T.",
                "성장코디네이터": "LTT : 성장 코디네이터 T.",
                "Growth": "LTT : 성장 코디네이터 T.",
                
                // ST 관련
                "ST": "LTT : ST T.",
                "도어퍼슨": "LTT : ST T.",
                "ST & 도어퍼슨": "LTT : ST T.",
                "ST&도어퍼슨": "LTT : ST T.",
                "ST 도어퍼슨": "LTT : ST T.",
                "에스티": "LTT : ST T.",
                "ST T.": "LTT : ST T.",
                "ST & 도어퍼슨 T.": "LTT : ST T.",
                "LTT : ST & 도어퍼슨 T.": "LTT : ST T.",
                
                // 비지터 호스트 관련
                "비지터": "LTT : 비지터 호스트 T.",
                "비지터 호스트": "LTT : 비지터 호스트 T.",
                "비지터호스트": "LTT : 비지터 호스트 T.",
                "Visitor": "LTT : 비지터 호스트 T.",
                "호스트": "LTT : 비지터 호스트 T.",
                
                // 이벤트 코디네이터 관련
                "이벤트": "LTT : 이벤트 코디네이터 T.",
                "이벤트 코디네이터": "LTT : 이벤트 코디네이터 T.",
                "이벤트코디네이터": "LTT : 이벤트 코디네이터 T.",
                "Event": "LTT : 이벤트 코디네이터 T.",
                
                // 멘토링 코디네이터 관련
                "멘토링": "LTT : 멘토링 코디네이터 T.",
                "멘토링 코디네이터": "LTT : 멘토링 코디네이터 T.",
                "멘토링코디네이터": "LTT : 멘토링 코디네이터 T.",
                "Mentoring": "LTT : 멘토링 코디네이터 T.",
                "멘토": "LTT : 멘토링 코디네이터 T.",
              };

              // 정확한 매칭 우선, 그 다음 매칭 맵 확인
              if (courseMap[inputTitle]) {
                matchedProgramTitle = courseMap[inputTitle];
              } else {
                matchedProgramTitle = inputTitle; // 입력한 그대로 사용
              }
            }

            // 다양한 열 이름 변형 지원 - 모든 값을 안전하게 문자열로 변환
            const getColumnValue = (possibleNames: string[]) => {
              for (const name of possibleNames) {
                if (row[name] !== null && row[name] !== undefined && row[name] !== "") {
                  // 숫자, 불린, 객체 등 모든 타입을 안전하게 문자열로 변환
                  const value = String(row[name]).trim();
                  if (value.length > 0) {
                    return value;
                  }
                }
              }
              return "";
            };

            // 이메일 필드를 더 안전하게 처리 - undefined, null, 빈 값 모두 빈 문자열로 설정
            const emailValue = getColumnValue(["이메일", "이메일(체크바람)", "email", "Email", "E-mail", "이메일 주소"]);
            
            return {
              region: getColumnValue(["지역"]),
              chapter: getColumnValue(["챕터"]),
              name: getColumnValue(["멤버명", "이름", "성명"]),
              phone: getColumnValue(["연락처(H.P)", "연락처", "휴대폰", "전화번호"]),
              email: emailValue === undefined || emailValue === null ? "" : String(emailValue), // undefined, null 처리
              participationType: getColumnValue(["참여 방식", "참여방식"]) || "실시간 참여",
              notes: getColumnValue(["특이사항 & 문의", "특이사항", "문의사항", "비고"]) || "", // 빈 문자열로 기본값 설정
              programTitle: matchedProgramTitle,
              trainingType: (getColumnValue(["참여 방식", "참여방식"]) || "실시간 참여").includes("실시간") ? "live" : "recorded",
            };
          });

          resolve(applications);
        } catch (error) {
          reject(new Error("엑셀 파일 파싱에 실패했습니다."));
        }
      };
      reader.onerror = () => reject(new Error("파일 읽기에 실패했습니다."));
      reader.readAsArrayBuffer(file);
    });
  };

  const handleUpload = async () => {
    if (!file) {
      toast({
        title: "파일 선택 필요",
        description: "업로드할 엑셀 파일을 선택해주세요.",
        variant: "destructive",
      });
      return;
    }

    setIsProcessing(true);
    setProgress(0);

    try {
      setProgress(25);
      const applications = await parseExcelFile(file);
      
      setProgress(50);
      
      // Validate required fields with detailed error information
      const invalidRows: { index: number; missing: string[] }[] = [];
      
      applications.forEach((app, index) => {
        const missing: string[] = [];
        if (!app.programTitle || app.programTitle.trim() === "") missing.push("과목명");
        if (!app.name || app.name.trim() === "") missing.push("멤버명");
        if (!app.phone || app.phone.trim() === "") missing.push("연락처");
        const validRegions = ["부산1", "강남", "송파", "인천", "대전", "용인", "고양", "중구", "성동", "화성", "창원1", "강서"];
        if (!app.region || app.region.trim() === "") {
          missing.push("지역");
        } else if (!validRegions.includes(app.region.trim())) {
          missing.push(`지역(${app.region} → 허용: ${validRegions.join(', ')})`);
        }
        if (!app.chapter || app.chapter.trim() === "") missing.push("챕터");
        // 이메일은 선택사항이므로 검증에서 제외
        
        if (missing.length > 0) {
          invalidRows.push({ index: index + 2, missing }); // +2 because Excel rows start at 1 and have header
        }
      });

      if (invalidRows.length > 0) {
        const errorDetails = invalidRows.slice(0, 3).map(row => 
          `${row.index}행: ${row.missing.join(', ')} 누락`
        ).join('\n');
        
        const moreRows = invalidRows.length > 3 ? `\n...그 외 ${invalidRows.length - 3}개 행 더` : '';
        
        throw new Error(`필수 정보가 누락된 ${invalidRows.length}개 행이 있습니다:\n\n${errorDetails}${moreRows}\n\n※ 필수 항목: 과목명, 지역, 챕터, 멤버명, 연락처\n※ 이메일은 선택 항목입니다`);
      }

      setProgress(75);
      await uploadMutation.mutateAsync(applications);
      setProgress(100);
      
    } catch (error) {
      toast({
        title: "일괄 신청 보류",
        description: error instanceof Error 
          ? `엇, 대표님 ! 명단의 양식에 오류가 있어 신청이 보류되었습니다.\n\n${error.message}`
          : "엇, 대표님 ! 명단의 양식에 오류가 있어 신청이 보류되었습니다.\n\n다시 확인 후 시도해주세요.",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const downloadTemplate = () => {
    // Google Sheets A-H 열 구조에 정확히 맞는 템플릿 생성 (A열에 과목명 추가됨)
    // 여러 과목을 동시에 신청할 수 있도록 다양한 과목 예시 포함
    const template = [
      {
        "과목명": "LTT : 파운데이션 T.",
        "지역": "강남",
        "챕터": "사랑",
        "멤버명": "차은우",
        "연락처(H.P)": "010-1234-5678",
        "이메일": "member1@example.com",
        "참여 방식": "실시간 참여",
        "특이사항 & 문의": "오후 시간 선호"
      },
      {
        "과목명": "LTT : 멤버십 위원회 T.",
        "지역": "강남",
        "챕터": "베러",
        "멤버명": "박보검",
        "연락처(H.P)": "010-1111-2222",
        "이메일": "",
        "참여 방식": "녹화본 시청",
        "특이사항 & 문의": "이메일 없음 (선택사항)"
      },
      {
        "과목명": "LTT : PR 코디네이터T.",
        "지역": "송파",
        "챕터": "성공",
        "멤버명": "변우석",
        "연락처(H.P)": "010-9876-5432",
        "이메일": "member3@example.com",
        "참여 방식": "실시간 참여",
        "특이사항 & 문의": "저녁 시간 희망"
      },
      {
        "과목명": "LTT : 교육 코디네이터 T.",
        "지역": "인천",
        "챕터": "지혜",
        "멤버명": "추정우",
        "연락처(H.P)": "010-3333-4444",
        "이메일": "member4@example.com",
        "참여 방식": "녹화본 시청",
        "특이사항 & 문의": "기타 등등"
      },
      {
        "과목명": "LTT : 성장 코디네이터 T.",
        "지역": "강남",
        "챕터": "행복",
        "멤버명": "한소희",
        "연락처(H.P)": "010-5555-6666",
        "이메일": "member5@example.com",
        "참여 방식": "실시간 참여",
        "특이사항 & 문의": "온종일 가능"
      },
      {
        "과목명": "LTT : ST T.",
        "지역": "용인",
        "챕터": "용기",
        "멤버명": "정해인",
        "연락처(H.P)": "010-1234-5679",
        "이메일": "member6@example.com",
        "참여 방식": "실시간 참여",
        "특이사항 & 문의": "확인 후 최대한"
      },
      {
        "과목명": "LTT : 비지터 호스트 T.",
        "지역": "성동",
        "챕터": "열정",
        "멤버명": "이도현",
        "연락처(H.P)": "010-1111-2223",
        "이메일": "member7@example.com",
        "참여 방식": "실시간 참여",
        "특이사항 & 문의": "확인 후 최대한"
      },
      {
        "과목명": "LTT : 이벤트 코디네이터 T.",
        "지역": "대전",
        "챕터": "평화",
        "멤버명": "박서준",
        "연락처(H.P)": "010-9876-5433",
        "이메일": "member8@example.com",
        "참여 방식": "실시간 참여",
        "특이사항 & 문의": "방영될 수 있는도록"
      },
      {
        "과목명": "LTT : 멘토링 코디네이터 T.",
        "지역": "고양",
        "챕터": "감동",
        "멤버명": "공유",
        "연락처(H.P)": "010-3333-4445",
        "이메일": "member9@example.com",
        "참여 방식": "실시간 참여",
        "특이사항 & 문의": "하겠습니다 :)"
      }
    ];

    const ws = XLSX.utils.json_to_sheet(template);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "신청자목록");
    XLSX.writeFile(wb, "BNI_LTT_2026_일괄신청_템플릿 (제공된 작성예시대로 기재해주세요).xlsx");
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Upload className="w-5 h-5" />
            <span>일괄 신청 업로드</span>
          </CardTitle>
          <CardDescription>
            엑셀 파일을 업로드하여 여러 명의 신청을 한번에 처리하세요.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">1. 템플릿 다운로드</span>
              <Button onClick={downloadTemplate} variant="outline" size="sm">
                <Download className="w-4 h-4 mr-2" />
                템플릿 다운로드
              </Button>
            </div>
            
            <Alert>
              <FileText className="h-4 w-4" />
              <AlertDescription>
                <div className="space-y-2">
                  <p><strong>템플릿 사용법:</strong></p>
                  <ul className="list-disc list-inside space-y-1 text-sm">
                    <li><strong>여러 과목 동시 신청 가능:</strong> 파운데이션 10명 + 성장 코디네이터 7명 등</li>
                    <li><strong>"과목명" 컬럼 활용:</strong> 각 신청자별로 원하는 과목명 입력</li>
                    <li><strong>필수 정보:</strong> 과목명, 지역, 챕터, 멤버명, 연락처</li>
                    <li><strong>지역:</strong> 부산1, 강남, 송파, 인천, 대전, 용인, 고양, 중구, 성동, 화성, 창원1, 강서 중 택1</li>
                    <li className="text-red-600 font-medium"><strong>이메일 정보는 모르시면 빈칸으로 두고 업로드 해주시면 됩니다</strong></li>
                    <li><strong>참여 방식:</strong> "실시간 참여" 또는 "녹화본 시청"</li>
                  </ul>
                </div>
              </AlertDescription>
            </Alert>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">2. 파일 업로드</span>
            </div>
            
            <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-6 text-center">
              <Input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls"
                onChange={handleFileChange}
                className="hidden"
              />
              
              {file ? (
                <div className="space-y-2">
                  <FileText className="w-8 h-8 mx-auto text-green-600" />
                  <p className="text-sm font-medium">{file.name}</p>
                  <p className="text-xs text-gray-500">
                    {(file.size / 1024).toFixed(1)} KB
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <Upload className="w-8 h-8 mx-auto text-gray-400" />
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    클릭하여 파일을 선택하거나 여기에 드래그하세요
                  </p>
                  <p className="text-xs text-gray-500">
                    Excel 파일만 지원됩니다 (.xlsx, .xls)
                  </p>
                </div>
              )}
              
              <Button
                onClick={() => fileInputRef.current?.click()}
                variant="outline"
                className="mt-4"
              >
                파일 선택
              </Button>
            </div>
          </div>

          {isProcessing && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span>처리 중...</span>
                <span>{progress}%</span>
              </div>
              <Progress value={progress} className="w-full" />
            </div>
          )}

          {results && (
            <Alert className="border-[#059807] bg-[#059807]/10 dark:bg-[#059807]/20">
              <CheckCircle className="h-4 w-4 text-[#059807]" />
              <AlertDescription className="text-[#059807] dark:text-[#059807]">
                성공적으로 완료되었습니다! {results.success}개의 신청이 처리되었습니다.
              </AlertDescription>
            </Alert>
          )}

          <Button
            onClick={handleUpload}
            disabled={!file || isProcessing}
            className="w-full bg-red-600 hover:bg-red-700 text-white"
          >
            {isProcessing ? "처리 중..." : "일괄 신청하기"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
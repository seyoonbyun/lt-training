import { useState } from "react";
import { Phone, Mail, Clock, ExternalLink } from "lucide-react";
import { REFUND_POLICY, REFUND_FORM_URL, REFUND_CONTACT } from "@shared/refund-policy";
import { CS_KAKAO_URL } from "@shared/site-links";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import bniLogo from "@assets/BNI_logo_Red_PMS pabicon_1754892420885.png";

export default function Footer() {
  // 규정 전문은 길어서 푸터에 늘어놓지 않고 팝업으로 연다.
  const [policyOpen, setPolicyOpen] = useState(false);

  const scrollToSection = (id: string) => {
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: "smooth" });
    }
  };

  return (
    <footer className="bg-white border-t border-gray-200 py-12">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div>
          {/* Company Info */}
          <div className="w-full">
            <div className="flex items-center mb-4">
              <img 
                src={bniLogo} 
                alt="BNI Korea" 
                className="h-8 w-auto"
              />
            </div>
            <div className="text-muted-foreground text-sm">
              <div className="pt-3 grid grid-cols-1 lg:grid-cols-2 gap-8 w-full">
                <div className="space-y-4">
                  <div>
                    <div className="flex items-center mb-1">
                      <strong className="text-white bg-black px-2 py-1 text-xs rounded-md">Location</strong>
                    </div>
                    <div className="pl-1">
                      <span style={{fontSize: '14px'}}>서울 성동구 왕십리로 58 서울숲 포휴(FORHU) 209호</span>
                    </div>
                  </div>
                  
                  <div className="flex items-center">
                    <strong className="text-white bg-black px-2 py-1 text-xs mr-3 rounded-md">Business number</strong>
                    <span style={{fontSize: '14px'}}>
                      220-87-68060 |
                      <a href="https://docs.google.com/forms/d/e/1FAIpQLSfCOt4K1j-nuyqQgOsidfsijFepJZBkmT8AgqANSGZ1S178ew/viewform" target="_blank" rel="noopener noreferrer" className="text-red-600 hover:underline ml-1">세금계산서</a>
                    </span>
                  </div>
                </div>
                
                <div className="space-y-4 lg:ml-8">
                  <div>
                    <div className="flex items-center mb-1">
                      <strong className="text-white bg-black px-2 py-1 text-xs rounded-md">
                        <span className="hidden md:inline">Member Support</span>
                        <span className="md:hidden">M.Support</span>
                      </strong>
                    </div>
                    <div className="pl-1">
                      <div style={{fontSize: '14px'}}>
                        <a href="http://pf.kakao.com/_xewxmrT" target="_blank" rel="noopener noreferrer" className="text-red-600 hover:underline">내셔널 오피스 CS 팀</a>
                        <span className="ml-2">Tel 02-6261-8838</span>
                      </div>
                    </div>
                  </div>

                  {/* 취소·환불 — 접수는 신청서로, 규정은 팝업으로 */}
                  <div className="flex items-center">
                    <a
                      href={REFUND_FORM_URL || CS_KAKAO_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-white bg-red-600 px-2 py-1 text-xs mr-3 rounded-md font-bold hover:bg-red-700 transition-colors"
                    >
                      취소 · 환불 접수
                    </a>
                    <button
                      type="button"
                      onClick={() => setPolicyOpen(true)}
                      className="text-red-600 hover:underline"
                      style={{fontSize: '14px'}}
                    >
                      취소 · 환불 규정
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        
        <div className="border-t border-gray-200 mt-8 pt-8 text-center text-muted-foreground text-sm">
          <p>&copy; 2026 BNI Korea. All rights reserved. | Leadership Training System</p>
          <p className="mt-2">본 신청페이지 및 시스템 관련 문의 : hq@joy-bnikorea.com</p>
        </div>
      </div>

      {/* 취소 · 환불 규정 — 문구는 shared/refund-policy 한 곳에서만 정한다(메일·문자와 같은 원본) */}
      <Dialog open={policyOpen} onOpenChange={setPolicyOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-lg">취소 · 환불 규정</DialogTitle>
          </DialogHeader>

          <div className="space-y-5 pt-2">
            {REFUND_POLICY.map((section) => (
              <div key={section.heading}>
                <div className="text-sm font-bold text-foreground mb-1.5">{section.heading}</div>
                <ul className="text-sm text-muted-foreground space-y-1 leading-relaxed">
                  {section.items.map((item) => (
                    <li key={item}>· {item}</li>
                  ))}
                </ul>
              </div>
            ))}

            <div className="border-t border-gray-200 pt-4 space-y-2">
              <p className="text-sm text-muted-foreground">
                일괄(대리) 신청 건을 취소하실 때는{" "}
                <strong className="text-foreground">어느 과목의 어느 수강자</strong>를 취소하는지 함께 알려주셔야 처리됩니다.
              </p>
              <p className="text-sm text-muted-foreground">접수 : {REFUND_CONTACT}</p>
            </div>

            <a
              href={REFUND_FORM_URL || CS_KAKAO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-md bg-red-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-red-700 transition-colors"
            >
              취소 · 환불 접수
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </DialogContent>
      </Dialog>
    </footer>
  );
}

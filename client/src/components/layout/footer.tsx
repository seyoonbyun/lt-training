import { Phone, Mail, Clock } from "lucide-react";
import bniLogo from "@assets/BNI_logo_Red_PMS pabicon_1754892420885.png";

export default function Footer() {
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
                      <span style={{fontSize: '14px'}}>서울 성동구 왕십리로 58 서울숲 포휴(FORHU) 211호</span>
                    </div>
                  </div>
                  
                  <div className="flex items-center">
                    <strong className="text-white bg-black px-2 py-1 text-xs mr-3 rounded-md">Business number</strong>
                    <span style={{fontSize: '14px'}}>220-87-68060</span>
                  </div>
                </div>
                
                <div className="space-y-4 lg:ml-8">
                  <div>
                    <div className="flex items-center mb-1">
                      <strong className="text-white bg-black px-2 py-1 text-xs rounded-md">Bank</strong>
                    </div>
                    <div className="pl-1">
                      <div style={{fontSize: '14px'}}>
                        농협 355-0061-5184-03 (주)비엔아이코리아 | 
                        <a href="https://docs.google.com/forms/d/e/1FAIpQLSfCOt4K1j-nuyqQgOsidfsijFepJZBkmT8AgqANSGZ1S178ew/viewform" target="_blank" rel="noopener noreferrer" className="text-red-600 hover:underline ml-1">세금계산서</a>
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center">
                    <strong className="text-white bg-black px-2 py-1 text-xs mr-3 rounded-md">
                      <span className="hidden md:inline">Member Support</span>
                      <span className="md:hidden">M.Support</span>
                    </strong>
                    <span style={{fontSize: '14px'}}>
                      <a href="http://pf.kakao.com/_xewxmrT" target="_blank" rel="noopener noreferrer" className="text-red-600 hover:underline" style={{fontSize: '14px'}}>내셔널 오피스 CS 팀</a>
                      <span className="ml-2">Tel 02-6261-8838</span>
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        
        <div className="border-t border-gray-200 mt-8 pt-8 text-center text-muted-foreground text-sm">
          <p>&copy; 2026 BNI Korea. All rights reserved. | Leadership Training System</p>
          <p className="mt-2">본 신청페이지 및 시스템 관련 문의 : joy.byun@bnikorea.com</p>
        </div>
      </div>
    </footer>
  );
}

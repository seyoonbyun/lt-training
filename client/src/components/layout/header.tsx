import { useState } from "react";
import { Menu, X, Home, BarChart3, ChevronDown, ArrowUpDown, Navigation, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import bniLogo from "@assets/BNI_logo_Red_PMS pabicon_1754892420885.png";

export default function Header() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [hoveredButton, setHoveredButton] = useState<string | null>(null);
  const [location] = useLocation();

  const navigationItems = [
    {
      name: "홈 프로그램 신청",
      href: "/",
      icon: Home,
      description: ""
    },
    {
      name: "신청현황 대시보드",
      href: "/dashboard", 
      icon: BarChart3,
      description: ""
    }
  ];

  const scrollToSection = (id: string) => {
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: "smooth" });
    }
    setIsMobileMenuOpen(false);
  };

  return (
    <header className="bni-header sticky top-0 z-50">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <div className="flex items-center space-x-1">
            <img 
              src={bniLogo} 
              alt="BNI Korea" 
              className="md:h-8 h-6 w-auto"
            />
            <div className="border-l border-gray-300" style={{ paddingLeft: '5px' }}>
              <div className="font-black text-gray-400 md:text-[35px] md:h-8 md:leading-8 text-[26px] h-6 leading-6 font-bold">KOREA</div>
            </div>
          </div>
          
          {/* Desktop Navigation */}
          <nav className="hidden md:flex space-x-2">
            {navigationItems.map((item) => {
              const Icon = item.icon;
              const isActive = location === item.href;
              
              // 각 버튼의 스타일을 hover 상태에 따라 결정 (상호 호버 효과)
              const getButtonStyle = () => {
                const isHovered = hoveredButton === item.name;
                const otherButtonHovered = hoveredButton && hoveredButton !== item.name;
                
                if (item.name === "홈 프로그램 신청") {
                  // 홈 버튼: 기본은 빨간 배경, 자신이나 다른 버튼 hover시 흰 배경
                  if (isHovered || otherButtonHovered) {
                    return "!bg-white !text-red-600 border-red-600";
                  }
                  return "bg-red-600 text-white border-red-600";
                } else {
                  // 신청현황 버튼: 기본은 흰 배경, 자신이나 다른 버튼 hover시 빨간 배경
                  if (isHovered || otherButtonHovered) {
                    return "bg-red-600 text-white border-red-600";
                  }
                  return "!bg-white !text-red-600 border-red-600";
                }
              };
              
              return (
                <Link key={item.name} href={item.href}>
                  <Button
                    variant="outline"
                    className={cn(
                      "flex items-center gap-2 px-4 py-2 h-auto transition-all duration-150 hover:scale-105 active:scale-95 touch-manipulation cursor-pointer",
                      getButtonStyle()
                    )}
                    onMouseEnter={() => setHoveredButton(item.name)}
                    onMouseLeave={() => setHoveredButton(null)}
                    onTouchStart={() => setHoveredButton(item.name)}
                    onTouchEnd={() => setTimeout(() => setHoveredButton(null), 100)}
                  >
                    <Icon className="h-4 w-4" />
                    {item.name}
                  </Button>
                </Link>
              );
            })}
          </nav>
          
          {/* Mobile menu button */}
          <button
            className="md:hidden text-foreground hover:text-primary p-2 transition-colors"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          >
            {isMobileMenuOpen ? <X className="md:w-6 md:h-6 w-7 h-7" /> : <Menu className="md:w-6 md:h-6 w-7 h-7" />}
          </button>
        </div>

        {/* Mobile Navigation */}
        {isMobileMenuOpen && (
          <div className="md:hidden border-t border-gray-200 py-4">
            <nav className="space-y-4">
              {/* 두 버튼을 한 줄에 배치 */}
              <div className="flex gap-2">
                {navigationItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = location === item.href;
                  
                  // 모바일용 스타일 결정 로직 (상호 호버 효과)
                  const getMobileButtonStyle = () => {
                    const isHovered = hoveredButton === item.name;
                    const otherButtonHovered = hoveredButton && hoveredButton !== item.name;
                    
                    if (item.name === "홈 프로그램 신청") {
                      // 홈 버튼: 자신이 호버되거나 다른 버튼이 호버될 때 화이트 배경
                      if (isHovered || otherButtonHovered) {
                        return "!bg-white !text-red-600 border border-red-600";
                      } else {
                        return "!bg-red-600 !text-white border border-red-600";
                      }
                    } else {
                      // 신청현황 대시보드 버튼: 자신이 호버되거나 다른 버튼이 호버될 때 레드 배경
                      if (isHovered || otherButtonHovered) {
                        return "!bg-red-600 !text-white border border-red-600";
                      } else {
                        return "!bg-white !text-red-600 border border-red-600";
                      }
                    }
                  };
                  
                  return (
                    <div
                      key={item.name}
                      className="flex-1 py-1"
                    >
                      <Link href={item.href}>
                        <div
                          className={cn(
                            "w-full flex items-center justify-center gap-2 px-3 py-3 rounded-lg font-medium transition-all duration-150 text-center active:scale-95 hover:scale-105 touch-manipulation cursor-pointer",
                            getMobileButtonStyle()
                          )}
                          onClick={() => setIsMobileMenuOpen(false)}
                          onTouchStart={(e) => {
                            e.currentTarget.style.transform = 'scale(0.95)';
                            setHoveredButton(item.name);
                          }}
                          onTouchEnd={(e) => {
                            e.currentTarget.style.transform = '';
                            setTimeout(() => setHoveredButton(null), 100);
                          }}
                          onMouseEnter={() => setHoveredButton(item.name)}
                          onMouseLeave={() => setHoveredButton(null)}
                        >
                          <Icon className="h-5 w-5 flex-shrink-0" />
                          <div className="text-xs font-medium leading-tight whitespace-nowrap">{item.name}</div>
                        </div>
                      </Link>
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-end">
                <button
                  onClick={() => scrollToSection('programs')}
                  className="text-right px-3 py-2 text-foreground hover:text-primary transition-colors font-medium flex items-center gap-2"
                >
                  <ArrowUpDown className="h-4 w-4" />
                  프로그램으로 스크롤
                </button>
              </div>
            </nav>
          </div>
        )}
      </div>
    </header>
  );
}

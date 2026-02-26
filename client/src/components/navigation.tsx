import { Link, useLocation } from "wouter";
import { Home, BarChart3, Menu, X } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

export function Navigation() {
  const [location] = useLocation();
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const navigationItems = [
    {
      name: "홈",
      href: "/",
      icon: Home,
      description: "프로그램 신청"
    },
    {
      name: "신청현황",
      href: "/dashboard", 
      icon: BarChart3,
      description: "실시간 대시보드"
    }
  ];

  return (
    <>
      {/* 모바일 헤더 */}
      <div className="lg:hidden bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 bg-gradient-to-br from-red-600 to-red-800 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-sm">B</span>
            </div>
            <div>
              <h1 className="font-bold text-gray-900 dark:text-white text-sm">BNI Korea</h1>
              <p className="text-xs text-gray-500 dark:text-gray-400">Leadership Training 2026</p>
            </div>
          </div>
          <button
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            {isMenuOpen ? (
              <X className="h-5 w-5 text-gray-600 dark:text-gray-300" />
            ) : (
              <Menu className="h-5 w-5 text-gray-600 dark:text-gray-300" />
            )}
          </button>
        </div>

        {/* 모바일 메뉴 */}
        {isMenuOpen && (
          <div className="mt-4 border-t border-gray-200 dark:border-gray-700 pt-4">
            <nav className="space-y-2">
              {navigationItems.map((item) => {
                const Icon = item.icon;
                const isActive = location === item.href;
                return (
                  <Link key={item.name} href={item.href}>
                    <div
                      className={cn(
                        "flex items-center space-x-3 px-3 py-2 rounded-lg transition-colors cursor-pointer",
                        isActive
                          ? "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800"
                          : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
                      )}
                      onClick={() => setIsMenuOpen(false)}
                    >
                      <Icon className="h-5 w-5" />
                      <div>
                        <div className="font-medium">{item.name}</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">{item.description}</div>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </nav>
          </div>
        )}
      </div>

      {/* 데스크톱 사이드바 */}
      <div className="hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0">
        <div className="flex flex-col flex-grow bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700 pt-8 pb-4 overflow-y-auto">
          {/* 로고 */}
          <div className="flex items-center flex-shrink-0 px-6 mb-8">
            <div className="w-10 h-10 bg-gradient-to-br from-red-600 to-red-800 rounded-xl flex items-center justify-center">
              <span className="text-white font-bold text-lg">B</span>
            </div>
            <div className="ml-3">
              <h1 className="font-bold text-gray-900 dark:text-white">BNI Korea</h1>
              <p className="text-sm text-gray-500 dark:text-gray-400">Leadership Training 2026</p>
            </div>
          </div>

          {/* 네비게이션 */}
          <nav className="flex-1 px-4 space-y-2">
            {navigationItems.map((item) => {
              const Icon = item.icon;
              const isActive = location === item.href;
              return (
                <Link key={item.name} href={item.href}>
                  <div
                    className={cn(
                      "group flex items-center px-3 py-3 text-sm font-medium rounded-lg transition-all duration-200 cursor-pointer",
                      isActive
                        ? "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 shadow-sm"
                        : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white"
                    )}
                  >
                    <Icon
                      className={cn(
                        "mr-3 flex-shrink-0 h-5 w-5 transition-colors",
                        isActive
                          ? "text-red-600 dark:text-red-400"
                          : "text-gray-400 dark:text-gray-500 group-hover:text-gray-600 dark:group-hover:text-gray-300"
                      )}
                    />
                    <div>
                      <div>{item.name}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        {item.description}
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </nav>

          {/* 하단 정보 */}
          <div className="px-6 py-4">
            <div className="text-xs text-gray-500 dark:text-gray-400">
              <p>실시간 Google Sheets 연동</p>
              <p className="mt-1">© 2026 BNI Korea</p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
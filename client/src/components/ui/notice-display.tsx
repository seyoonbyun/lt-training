import { Star } from "lucide-react";
import { Notice } from "@shared/schema";
import { Card, CardContent } from "@/components/ui/card";

interface NoticeDisplayProps {
  notices: Notice[];
  isLoading: boolean;
  error: Error | null;
}

function CustomIcon() {
  return (
    <div 
      style={{ 
        backgroundColor: '#dc2626',
        border: '4px solid #ef4444',
        borderRadius: '16px',
        width: '80px',
        height: '80px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: '4px'
      }}
    >
      <Star 
        style={{ 
          color: '#fbbf24',
          width: '48px',
          height: '48px'
        }}
      />
    </div>
  );
}

export default function NoticeDisplay({ notices, isLoading, error }: NoticeDisplayProps) {
  if (isLoading) {
    return (
      <section className="py-12 bg-background">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="animate-pulse">
            <div className="h-6 bg-gray-200 rounded mb-4 w-1/4"></div>
            <div className="space-y-2">
              <div className="h-4 bg-gray-200 rounded w-3/4"></div>
              <div className="h-4 bg-gray-200 rounded w-1/2"></div>
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="py-12 bg-background">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <Card className="bg-red-50 border-red-200">
            <CardContent className="p-6">
              <div className="text-red-700">
                공지사항을 불러오는데 실패했습니다. Google Sheets 연결을 확인해주세요.
              </div>
            </CardContent>
          </Card>
        </div>
      </section>
    );
  }

  if (notices.length === 0) {
    return (
      <section className="py-12 bg-background">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <Card className="bg-gradient-to-r from-primary/10 to-primary/5 border-primary/20">
            <CardContent className="p-6">
              <div className="flex items-start space-x-4">
                <CustomIcon />
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-foreground mb-2">공지사항</h3>
                  <p className="text-muted-foreground text-sm">
                    현재 표시할 공지사항이 없습니다.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>
    );
  }

  return (
    <section className="py-12 bg-background">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <Card className="bg-gradient-to-r from-primary/10 to-primary/5 border-primary/20">
          <CardContent className="p-6">
            <div className="flex items-start space-x-4">
              <CustomIcon />
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-foreground mb-4">
                  {notices.some(notice => notice.priority > 0) ? '중요 공지사항' : '공지사항'}
                </h3>
                <div className="space-y-3 text-foreground">
                  {notices.map((notice, index) => (
                    <div key={notice.id || index} className="flex items-start">
                      <span className="text-primary mr-2 flex-shrink-0 mt-1">•</span>
                      <div className="flex-1">
                        {notice.priority > 0 && (
                          <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-red-50 text-red-700 mr-2 mb-1">
                            중요
                          </span>
                        )}
                        <p className="text-sm leading-relaxed">
                          <span className="font-medium text-foreground">{notice.title}</span>
                          {notice.content && (
                            <span className="ml-2 text-muted-foreground">{notice.content}</span>
                          )}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
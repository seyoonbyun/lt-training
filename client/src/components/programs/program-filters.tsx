import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Search, RefreshCw } from "lucide-react";

interface ProgramFiltersProps {
  filters: {
    search: string;
    status: string;
    date: string;
  };
  onFiltersChange: (filters: any) => void;
  onRefresh: () => void;
}

export default function ProgramFilters({ filters, onFiltersChange, onRefresh }: ProgramFiltersProps) {
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await onRefresh();
    setTimeout(() => setIsRefreshing(false), 1000);
  };

  const handleSearchChange = (value: string) => {
    onFiltersChange({ ...filters, search: value });
  };

  const handleStatusChange = (value: string) => {
    onFiltersChange({ ...filters, status: value === "all" ? "" : value });
  };

  const handleDateChange = (value: string) => {
    onFiltersChange({ ...filters, date: value === "all" ? "" : value });
  };

  return (
    <section className="bni-section py-8">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col lg:flex-row gap-4 items-center justify-between">
          {/* Search */}
          <div className="relative flex-1 max-w-md">
            <Input
              type="text"
              placeholder="프로그램 검색..."
              value={filters.search}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="w-full bg-white border-gray-300 rounded-lg pl-10 text-foreground placeholder-muted-foreground focus:border-primary"
            />
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
          </div>
          
          {/* Filters */}
          <div className="flex flex-wrap gap-2 items-center">
            <Select value={filters.status || "all"} onValueChange={handleStatusChange}>
              <SelectTrigger className="w-32 bg-white border-gray-300 text-foreground text-sm focus:border-primary">
                <SelectValue placeholder="전체 상태" />
              </SelectTrigger>
              <SelectContent className="bg-white border-gray-300">
                <SelectItem value="all">전체 상태</SelectItem>
                <SelectItem value="upcoming">예정</SelectItem>
                <SelectItem value="ongoing">진행중</SelectItem>
                <SelectItem value="completed">종료</SelectItem>
              </SelectContent>
            </Select>
            
            <Select value={filters.date || "all"} onValueChange={handleDateChange}>
              <SelectTrigger className="w-32 bg-white border-gray-300 text-foreground text-sm focus:border-primary">
                <SelectValue placeholder="전체 기간" />
              </SelectTrigger>
              <SelectContent className="bg-white border-gray-300">
                <SelectItem value="all">전체 기간</SelectItem>
                <SelectItem value="thisMonth">이번 달</SelectItem>
                <SelectItem value="nextMonth">다음 달</SelectItem>
                <SelectItem value="thisQuarter">이번 분기</SelectItem>
              </SelectContent>
            </Select>

            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="border-gray-300 hover:border-primary text-muted-foreground hover:text-primary"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

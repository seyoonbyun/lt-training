import { Loader2 } from "lucide-react";

export function Loading() {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="text-center space-y-4">
        <Loader2 className="h-8 w-8 animate-spin mx-auto text-red-600 dark:text-red-400" />
        <p className="text-gray-600 dark:text-gray-400">로딩 중...</p>
      </div>
    </div>
  );
}
import { QueryClient, QueryFunction } from "@tanstack/react-query";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    
    if (res.status === 409) {
      let errorMessage = text;
      try {
        const errorData = JSON.parse(text);
        errorMessage = errorData.message || '이미 신청이 완료되었습니다.';
      } catch {
        errorMessage = text || '이미 신청이 완료되었습니다.';
      }
      const err = new Error(errorMessage);
      (err as any).status = 409;
      throw err;
    }
    
    if (res.status === 429) {
      let errorMessage = text;
      try {
        const errorData = JSON.parse(text);
        errorMessage = errorData.message || `${errorData.error || '요청이 너무 많습니다'} ${errorData.retryAfter || 60}초 후 다시 시도해주세요.`;
      } catch {
        errorMessage = text || '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.';
      }
      throw new Error(`${res.status}: ${errorMessage}`);
    }
    
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const headers: Record<string, string> = {
    'User-Agent': navigator.userAgent,
  };
  
  if (data) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(url, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
    mode: 'cors',
    cache: 'no-cache',
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey.join("/") as string, {
      credentials: "include",
      mode: 'cors',
      cache: 'no-cache',
      headers: {
        'User-Agent': navigator.userAgent,
      }
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: (failureCount, error) => {
        // 429 에러의 경우 최대 2번 재시도 (총 3번 시도)
        if (error.message.includes('429:')) {
          return failureCount < 2;
        }
        return false;
      },
      retryDelay: (attemptIndex, error) => {
        // 429 에러의 경우 지수 백오프로 재시도 간격 설정
        if (error.message.includes('429:')) {
          return Math.min(1000 * (2 ** attemptIndex), 30000); // 1초, 2초, 4초... 최대 30초
        }
        return 1000;
      },
    },
    mutations: {
      retry: (failureCount, error) => {
        // 뮤테이션은 429 에러에 대해서만 1번 재시도
        if (error.message.includes('429:')) {
          return failureCount < 1;
        }
        return false;
      },
      retryDelay: (attemptIndex, error) => {
        if (error.message.includes('429:')) {
          return 3000; // 3초 후 재시도
        }
        return 1000;
      },
    },
  },
});

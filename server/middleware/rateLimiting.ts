// Rate Limiting 미들웨어 - 300명 동시접속 대비
import { Request, Response, NextFunction } from 'express';

interface RateLimitStore {
  [key: string]: {
    count: number;
    resetTime: number;
  };
}

class MemoryStore {
  private store: RateLimitStore = {};
  
  // 5분마다 스토어 정리
  constructor() {
    setInterval(() => {
      const now = Date.now();
      Object.keys(this.store).forEach(key => {
        if (this.store[key].resetTime < now) {
          delete this.store[key];
        }
      });
    }, 300000); // 5분
  }
  
  get(key: string): { count: number; resetTime: number } | null {
    const record = this.store[key];
    if (!record || record.resetTime < Date.now()) {
      return null;
    }
    return record;
  }
  
  set(key: string, value: { count: number; resetTime: number }): void {
    this.store[key] = value;
  }
}

const store = new MemoryStore();

export interface RateLimitOptions {
  windowMs: number; // 시간 윈도우 (밀리초)
  max: number; // 최대 요청 수
  message?: string; // 제한 시 메시지
  skipSuccessfulRequests?: boolean;
}

export function createRateLimit(options: RateLimitOptions) {
  const {
    windowMs,
    max,
    message = '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.',
    skipSuccessfulRequests = false
  } = options;
  
  return (req: Request, res: Response, next: NextFunction) => {
    const key = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const resetTime = now + windowMs;
    
    const current = store.get(key);
    
    if (!current) {
      store.set(key, { count: 1, resetTime });
      return next();
    }
    
    if (current.count >= max) {
      const retryAfterSeconds = Math.ceil((current.resetTime - now) / 1000);
      return res.status(429).json({
        error: message,
        retryAfter: retryAfterSeconds,
        message: `${message} ${retryAfterSeconds}초 후 다시 시도해주세요.`
      });
    }
    
    // 성공한 요청만 카운트 증가 (옵션)
    if (!skipSuccessfulRequests) {
      current.count++;
      store.set(key, current);
    } else {
      // 응답 완료 후 성공한 경우에만 카운트 증가
      const originalSend = res.send;
      res.send = function(body) {
        if (res.statusCode < 400) {
          current.count++;
          store.set(key, current);
        }
        return originalSend.call(this, body);
      };
    }
    
    next();
  };
}

// 프리셋 Rate Limit 설정들
export const apiRateLimit = createRateLimit({
  windowMs: 60 * 1000, // 1분
  max: 100, // 분당 100회
  message: 'API 요청이 너무 많습니다.'
});

export const strictApiRateLimit = createRateLimit({
  windowMs: 60 * 1000, // 1분  
  max: 900, // 분당 900회 (안전한 여유 마진 확보)
  message: 'Google Sheets API 보호를 위해 요청을 제한합니다.'
});

export const applicationSubmitRateLimit = createRateLimit({
  windowMs: 1 * 60 * 1000, // 1분
  max: 60, // 1분당 60회 신청 (사용자별 IP 기반)
  message: '신청 요청이 너무 많습니다.'
});
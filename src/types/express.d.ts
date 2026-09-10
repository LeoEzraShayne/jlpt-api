import type { JlptLevel, Theme, UserRole } from '@prisma/client';

interface CurrentUser {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  role: UserRole;
  timezone: string;
  targetLevel: JlptLevel;
  colorTheme: Theme;
  createdAt: Date;
  updatedAt: Date;
}

declare global {
  namespace Express {
    interface Request {
      currentUser?: CurrentUser;
      sessionId?: string;
      requestId?: string;
    }
  }
}
export {};

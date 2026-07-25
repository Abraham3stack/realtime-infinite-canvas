// Guest user and session types

export interface GuestUser {
  id: string;
  displayName: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface GuestSession {
  id: string;
  userId: string;
  sessionToken: string;
  expiresAt: Date;
  createdAt: Date;
}

export type AuthResponse = {
  sessionToken: string;
  userId: string;
  displayName: string;
};

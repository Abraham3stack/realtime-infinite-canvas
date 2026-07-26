import { useCallback, useEffect, useState } from 'react';
import { setSocketToken } from '../socket.js';
import {
  clearPersistedCollaborationState,
  readPersistedGuestSession,
  writePersistedGuestSession,
} from '../utils/persistence.js';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

export interface GuestSession {
  sessionToken: string;
  sessionId: string;
  userId: string;
  displayName: string;
  expiresAt: string;
}

// Hook to create a guest session.
export function useCreateSession() {
  const [session, setSession] = useState<GuestSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isActive = true;

    const restoreSession = async () => {
      const persisted = readPersistedGuestSession();
      if (!persisted) {
        if (isActive) setLoading(false);
        return;
      }

      try {
        const res = await fetch(`${API_URL}/auth/validate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${persisted.sessionToken}`,
          },
          body: JSON.stringify({ sessionToken: persisted.sessionToken }),
        });

        if (!res.ok) {
          throw new Error('Session invalid or expired');
        }

        const data = (await res.json()) as {
          valid: boolean;
          sessionId: string;
          userId: string;
          displayName: string;
          expiresAt: string;
        };

        if (!data.valid) {
          throw new Error('Session invalid or expired');
        }

        const restoredSession: GuestSession = {
          sessionToken: persisted.sessionToken,
          sessionId: data.sessionId,
          userId: data.userId,
          displayName: data.displayName,
          expiresAt: data.expiresAt,
        };

        if (!isActive) return;

        setSession(restoredSession);
        setSocketToken(restoredSession.sessionToken);
        writePersistedGuestSession(restoredSession);
      } catch {
        clearPersistedCollaborationState();

        if (isActive) {
          setSession(null);
          setError('Your previous guest session expired. Please create a new session to continue.');
        }
      } finally {
        if (isActive) {
          setLoading(false);
        }
      }
    };

    void restoreSession();

    return () => {
      isActive = false;
    };
  }, []);

  const createSession = useCallback(async (displayName: string): Promise<void> => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${API_URL}/auth/guest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName }),
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`${res.status}: ${body}`);
      }

      const data = (await res.json()) as GuestSession;
      setSession(data);
      setSocketToken(data.sessionToken);
      writePersistedGuestSession(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return { session, loading, error, createSession };
}

// Hook to validate an existing guest session.
export function useValidateSession() {
  const [valid, setValid] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validateSession = useCallback(async (sessionToken: string): Promise<void> => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${API_URL}/auth/validate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({ sessionToken }),
      });

      if (!res.ok) {
        throw new Error(`${res.status}: Session invalid or expired`);
      }

      const data = await res.json();
      setValid(data.valid);
      if (data.valid) {
        setSocketToken(sessionToken);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return { valid, loading, error, validateSession };
}

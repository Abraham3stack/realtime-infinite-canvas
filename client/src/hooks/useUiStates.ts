import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConnectionStatus } from './useConnectionStatus.js';

export type RoomLoadingPhase = 'idle' | 'connecting' | 'hydrating' | 'syncing';

export function useToast(timeoutMs = 1800) {
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), timeoutMs);
    return () => window.clearTimeout(timer);
  }, [toast, timeoutMs]);

  const showToast = useCallback((message: string) => {
    setToast(message);
  }, []);

  return { toast, showToast };
}

export function useConnectionToasts(status: ConnectionStatus, onToast: (message: string) => void) {
  const previousStatus = useRef(status);
  const hasBootstrapped = useRef(false);

  useEffect(() => {
    if (!hasBootstrapped.current) {
      hasBootstrapped.current = true;
      previousStatus.current = status;
      return;
    }

    const prev = previousStatus.current;
    if (prev === status) return;

    if ((status === 'disconnected' || status === 'error') && (prev === 'connected' || prev === 'connecting')) {
      onToast('✓ Connection lost');
    }

    if (status === 'connecting' && prev !== 'connecting') {
      onToast('✓ Reconnecting...');
    }

    if (status === 'connected' && (prev === 'disconnected' || prev === 'error' || prev === 'connecting')) {
      onToast(prev === 'connecting' ? '✓ Reconnected' : '✓ Connection restored');
    }

    previousStatus.current = status;
  }, [onToast, status]);
}

export function useRoomHydrationLoading() {
  const [phase, setPhase] = useState<RoomLoadingPhase>('idle');
  const [showSkeleton, setShowSkeleton] = useState(false);
  const timers = useRef<number[]>([]);

  const clearTimers = useCallback(() => {
    timers.current.forEach((timer) => window.clearTimeout(timer));
    timers.current = [];
  }, []);

  const resetLoading = useCallback(() => {
    clearTimers();
    setPhase('idle');
    setShowSkeleton(false);
  }, [clearTimers]);

  const beginLoading = useCallback(() => {
    clearTimers();
    setShowSkeleton(true);
    setPhase('connecting');
  }, [clearTimers]);

  const completeLoading = useCallback(() => {
    clearTimers();
    setPhase('hydrating');

    const syncingTimer = window.setTimeout(() => {
      setPhase('syncing');
    }, 180);

    const finishTimer = window.setTimeout(() => {
      setPhase('idle');
      setShowSkeleton(false);
    }, 900);

    timers.current = [syncingTimer, finishTimer];
  }, [clearTimers]);

  useEffect(() => {
    return () => {
      clearTimers();
    };
  }, [clearTimers]);

  return {
    phase,
    showSkeleton,
    isLoading: phase !== 'idle',
    beginLoading,
    completeLoading,
    resetLoading,
  };
}

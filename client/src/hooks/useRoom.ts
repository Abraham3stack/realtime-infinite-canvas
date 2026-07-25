import { useCallback, useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { socket } from '../socket.js';
import { useRoomStore } from '../store/room.js';
import { useCanvasObjectsStore, type CanvasObject } from '../store/objects.js';

interface RoomCreateResponse {
  code?: string;
  message?: string;
  roomId?: string;
  shareCode?: string;
  session?: { id: string; token: string };
  participant?: Record<string, unknown>;
  initialState?: Record<string, unknown>;
}

interface RoomJoinResponse {
  code?: string;
  message?: string;
  roomId?: string;
  title?: string;
  participants?: Array<Record<string, unknown>>;
  canvasObjects?: Array<Record<string, unknown>>;
}

interface RoomLeaveResponse {
  success?: boolean;
}

interface UserJoinedPayload {
  participant: Record<string, unknown>;
  serverTs: string;
}

interface UserLeftPayload {
  participantId: string;
  roomId: string;
  serverTs: string;
}

// Hook to create a new room.
// Returns a function that accepts a room title and returns a promise
// resolving to the room creation response or error.
export function useCreateRoom() {
  const setRoom = useRoomStore(useShallow((s) => s.setRoom));
  const setParticipants = useRoomStore(useShallow((s) => s.setParticipants));

  const createRoom = useCallback(
    async (displayName?: string): Promise<void> => {
      return new Promise((resolve, reject) => {
        socket.emit('room:create', { displayName }, (response: RoomCreateResponse) => {
          if (response.code) {
            reject(new Error(`${response.code}: ${response.message}`));
            return;
          }

          // Store room and participant state.
          setRoom({
            id: response.roomId || '',
            shareCode: response.shareCode || '',
            title: response.initialState?.roomId as string || '',
          });
          const participants = (response.initialState as { participants?: Array<Record<string, unknown>> })?.participants || [];
          setParticipants(participants.map((p) => ({
            id: p.id as string,
            roomId: p.roomId as string,
            displayName: p.displayName as string,
            joinedAt: p.joinedAt as string,
            lastSeenAt: p.lastSeenAt as string,
            isActive: p.isActive as boolean,
          })));
          resolve();
        });
      });
    },
    [setRoom, setParticipants]
  );

  return createRoom;
}

// Hook to join an existing room.
// Returns a function that accepts roomId or shareCode and returns a promise
// resolving when join is complete or rejecting on error.
export function useJoinRoom() {
  const setRoom = useRoomStore(useShallow((s) => s.setRoom));
  const setParticipants = useRoomStore(useShallow((s) => s.setParticipants));
  const setObjects = useCanvasObjectsStore(useShallow((s) => s.setObjects));

  const joinRoom = useCallback(
    async (roomId?: string, shareCode?: string): Promise<void> => {
      return new Promise((resolve, reject) => {
        socket.emit('room:join', { roomId, shareCode }, (response: RoomJoinResponse) => {
          if (response.code) {
            reject(new Error(`${response.code}: ${response.message}`));
            return;
          }

          setRoom({
            id: response.roomId || '',
            shareCode: shareCode || '',
            title: response.title || '',
          });
          const participants = response.participants || [];
          setParticipants(participants.map((p) => ({
            id: p.id as string,
            roomId: p.roomId as string,
            displayName: p.displayName as string,
            joinedAt: p.joinedAt as string,
            lastSeenAt: p.lastSeenAt as string,
            isActive: p.isActive as boolean,
          })));

          // Set initial canvas objects from server
          const canvasObjects = (response.canvasObjects || []) as Array<Record<string, unknown>>;
          setObjects(canvasObjects as unknown as CanvasObject[]);

          resolve();
        });
      });
    },
    [setRoom, setParticipants, setObjects]
  );

  return joinRoom;
}

// Hook to leave the current room.
export function useLeaveRoom() {
  const clearRoom = useRoomStore(useShallow((s) => s.clearRoom));
  const clearObjects = useCanvasObjectsStore(useShallow((s) => s.clear));

  const leaveRoom = useCallback(async (): Promise<void> => {
    return new Promise((resolve, reject) => {
      socket.emit('room:leave', {}, (response: RoomLeaveResponse) => {
        if (!response.success) {
          reject(new Error('Failed to leave room'));
          return;
        }
        clearRoom();
        clearObjects();
        resolve();
      });
    });
  }, [clearRoom, clearObjects]);

  return leaveRoom;
}

// Hook to listen for participant join events in the current room.
export function useRoomUserJoined(callback: (participant: Record<string, unknown>) => void): void {
  const handleUserJoined = useCallback(
    (payload: UserJoinedPayload) => {
      callback(payload.participant);
    },
    [callback]
  );

  // Subscribe on mount, unsubscribe on unmount.
  useEffect(() => {
    socket.on('room:userJoined', handleUserJoined);
    return () => {
      socket.off('room:userJoined', handleUserJoined);
    };
  }, [handleUserJoined]);
}

// Hook to listen for participant leave events in the current room.
export function useRoomUserLeft(callback: (participantId: string) => void): void {
  const handleUserLeft = useCallback(
    (payload: UserLeftPayload) => {
      callback(payload.participantId);
    },
    [callback]
  );

  useEffect(() => {
    socket.on('room:userLeft', handleUserLeft);
    return () => {
      socket.off('room:userLeft', handleUserLeft);
    };
  }, [handleUserLeft]);
}

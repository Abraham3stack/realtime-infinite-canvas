import { useCallback, useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { socket } from '../socket.js';
import { useRoomStore } from '../store/room.js';
import { useCanvasObjectsStore, type CanvasObject } from '../store/objects.js';
import { clearPersistedRoom, writePersistedRoom } from '../utils/persistence.js';
import { DEFAULT_ROOM_PHYSICS_STATE, type RoomPhysicsState, usePhysicsStore } from '../store/physics.js';

interface RoomCreateResponse {
  code?: string;
  message?: string;
  roomId?: string;
  shareCode?: string;
  session?: { id: string; token: string };
  participant?: Record<string, unknown>;
  initialState?: Record<string, unknown>;
  createdBySessionId?: string;
  physicsState?: RoomPhysicsState;
}

interface RoomJoinResponse {
  code?: string;
  message?: string;
  roomId?: string;
  title?: string;
  participants?: Array<Record<string, unknown>>;
  canvasObjects?: Array<Record<string, unknown>>;
  createdBySessionId?: string;
  physicsState?: RoomPhysicsState;
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

/**
 * Creates a room on the server and seeds local room/participant state from the
 * authoritative callback payload.
 *
 * The hook writes server-derived data (instead of local guesses) so all clients
 * start from the same baseline identifiers and participant metadata.
 */
export function useCreateRoom() {
  const setRoom = useRoomStore(useShallow((s) => s.setRoom));
  const setParticipants = useRoomStore(useShallow((s) => s.setParticipants));
  const setRoomPhysics = usePhysicsStore(useShallow((s) => s.setRoomPhysics));

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
            createdBySessionId: response.createdBySessionId,
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

          if (response.physicsState) {
            setRoomPhysics(response.physicsState);
          }

          if (response.roomId && response.shareCode) {
            writePersistedRoom({ roomId: response.roomId, shareCode: response.shareCode });
          }
          resolve();
        });
      });
    },
    [setRoom, setParticipants, setRoomPhysics]
  );

  return createRoom;
}

/**
 * Joins an existing room by id or share code and hydrates both participant and
 * canvas-object state from the server snapshot.
 *
 * Hydration overwrites local object state by design because reconnect/join should
 * converge to server truth after transient disconnects or tab restores.
 */
export function useJoinRoom() {
  const setRoom = useRoomStore(useShallow((s) => s.setRoom));
  const setParticipants = useRoomStore(useShallow((s) => s.setParticipants));
  const setObjects = useCanvasObjectsStore(useShallow((s) => s.setObjects));
  const setRoomPhysics = usePhysicsStore(useShallow((s) => s.setRoomPhysics));

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
            createdBySessionId: response.createdBySessionId,
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

          // Snapshot hydration is atomic at the store boundary to avoid mixed
          // participant/object versions during first paint after join.
          const canvasObjects = (response.canvasObjects || []) as Array<Record<string, unknown>>;
          setObjects(canvasObjects as unknown as CanvasObject[]);

          setRoomPhysics(response.physicsState || DEFAULT_ROOM_PHYSICS_STATE);

          const resolvedRoomId = response.roomId || roomId || '';
          if (resolvedRoomId) {
            writePersistedRoom({
              roomId: resolvedRoomId,
              shareCode: shareCode || '',
            });
          }

          resolve();
        });
      });
    },
    [setRoom, setParticipants, setObjects, setRoomPhysics]
  );

  return joinRoom;
}

/**
 * Leaves the active room and clears room-scoped state locally only after server
 * acknowledgement, preventing accidental local teardown on failed leave attempts.
 */
export function useLeaveRoom() {
  const clearRoom = useRoomStore(useShallow((s) => s.clearRoom));
  const clearObjects = useCanvasObjectsStore(useShallow((s) => s.clear));
  const clearRoomPhysics = usePhysicsStore(useShallow((s) => s.clearRoomPhysics));

  const leaveRoom = useCallback(async (): Promise<void> => {
    return new Promise((resolve, reject) => {
      socket.emit('room:leave', {}, (response: RoomLeaveResponse) => {
        if (!response.success) {
          reject(new Error('Failed to leave room'));
          return;
        }
        clearRoom();
        clearObjects();
        clearRoomPhysics();
        clearPersistedRoom();
        resolve();
      });
    });
  }, [clearRoom, clearObjects, clearRoomPhysics]);

  return leaveRoom;
}

/**
 * Subscribes to participant-join broadcasts.
 * Callback shape stays transport-friendly (`Record<string, unknown>`) because the
 * payload originates from socket events, not compile-time typed RPC.
 */
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

/**
 * Subscribes to participant-leave broadcasts for room presence convergence.
 */
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

/**
 * Rejoins the current room after transport reconnect.
 *
 * Reconnect restores the low-level socket connection, but room membership is
 * application-level state and must be explicitly re-established. We also refresh
 * participants and objects to reconcile any events missed while offline.
 */
export function useRoomAutoRejoin(): void {
  const room = useRoomStore(useShallow((s) => s.room));
  const setRoom = useRoomStore(useShallow((s) => s.setRoom));
  const setParticipants = useRoomStore(useShallow((s) => s.setParticipants));
  const setObjects = useCanvasObjectsStore(useShallow((s) => s.setObjects));
  const setRoomPhysics = usePhysicsStore(useShallow((s) => s.setRoomPhysics));

  useEffect(() => {
    if (!room) return;

    const handleReconnect = () => {
      socket.emit('room:join', { roomId: room.id }, (response: RoomJoinResponse) => {
        if (response.code) {
          return;
        }

        setRoom({
          id: response.roomId || room.id,
          shareCode: room.shareCode,
          title: response.title || room.title,
          createdBySessionId: response.createdBySessionId || room.createdBySessionId,
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

        const canvasObjects = (response.canvasObjects || []) as Array<Record<string, unknown>>;
        setObjects(canvasObjects as unknown as CanvasObject[]);

        setRoomPhysics(response.physicsState || DEFAULT_ROOM_PHYSICS_STATE);
      });
    };

    socket.on('connect', handleReconnect);
    return () => {
      socket.off('connect', handleReconnect);
    };
  }, [room, setObjects, setParticipants, setRoom, setRoomPhysics]);
}

import { FC, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useConnectionStatus } from './hooks/useConnectionStatus.js';
import { useCreateSession } from './hooks/useAuth.js';
import { useCreateRoom, useJoinRoom, useLeaveRoom, useRoomAutoRejoin, useRoomUserJoined, useRoomUserLeft } from './hooks/useRoom.js';
import { useConnectionToasts, useRoomHydrationLoading, useToast, type RoomLoadingPhase } from './hooks/useUiStates.js';
import { useRoomStore } from './store/room.js';
import { Canvas } from './components/Canvas.js';
import { LoadingButton } from './components/ui/LoadingButton.js';
import { SkeletonBlock } from './components/ui/SkeletonBlock.js';
import { StatusBadge } from './components/ui/StatusBadge.js';
import { clearPersistedRoom, readPersistedRoom } from './utils/persistence.js';

type ActionLoading = 'create-session' | 'create-room' | 'join-room' | 'leave-room' | null;
type CopyLoading = 'room-id' | 'share-code' | null;

const ROOM_LOADING_COPY: Record<Exclude<RoomLoadingPhase, 'idle'>, { title: string; sub: string }> = {
  connecting: {
    title: 'Connecting...',
    sub: 'Joining room and requesting initial state.',
  },
  hydrating: {
    title: 'Hydrating objects...',
    sub: 'Applying room data to your canvas.',
  },
  syncing: {
    title: 'Loading canvas...',
    sub: 'Finalizing realtime synchronization.',
  },
};

const App: FC = () => {
  const { status, statusLabel, reconnecting, error: connError } = useConnectionStatus();
  const {
    session,
    loading: sessionLoading,
    error: sessionError,
    createSession,
  } = useCreateSession();
  const createRoom = useCreateRoom();
  const joinRoom = useJoinRoom();
  const leaveRoom = useLeaveRoom();
  const { room, participants } = useRoomStore();

  const [displayName, setDisplayName] = useState('');
  const [roomInput, setRoomInput] = useState('');
  const [roomIdOrCode, setRoomIdOrCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loadingAction, setLoadingAction] = useState<ActionLoading>(null);
  const [copyLoading, setCopyLoading] = useState<CopyLoading>(null);
  const { toast, showToast } = useToast();
  const {
    phase: roomLoadingPhase,
    showSkeleton: showRoomSkeleton,
    isLoading: isRoomLoading,
    beginLoading: beginRoomLoading,
    completeLoading: completeRoomLoading,
    resetLoading: resetRoomLoading,
  } = useRoomHydrationLoading();

  const connectedCount = useMemo(() => participants.filter((participant) => participant.isActive).length, [participants]);
  const attemptedStartupRoomRestoreRef = useRef(false);

  useConnectionToasts(status, showToast);
  useRoomAutoRejoin();

  useEffect(() => {
    if (!session || room || sessionLoading) return;
    if (attemptedStartupRoomRestoreRef.current) return;

    attemptedStartupRoomRestoreRef.current = true;

    const persistedRoom = readPersistedRoom();
    if (!persistedRoom?.roomId) {
      return;
    }

    setLoadingAction('join-room');
    beginRoomLoading();

    void joinRoom(persistedRoom.roomId, persistedRoom.shareCode || undefined)
      .then(() => {
        completeRoomLoading();
        showToast('Welcome back. Restored your previous room.');
      })
      .catch(() => {
        clearPersistedRoom();
        resetRoomLoading();
        showToast('Session restored, but your previous room could not be reopened.');
      })
      .finally(() => {
        setLoadingAction(null);
      });
  }, [
    beginRoomLoading,
    completeRoomLoading,
    joinRoom,
    resetRoomLoading,
    room,
    session,
    sessionLoading,
    showToast,
  ]);

  const copyToClipboard = async (value: string, label: string, loadingKey: Exclude<CopyLoading, null>) => {
    try {
      setCopyLoading(loadingKey);
      await navigator.clipboard.writeText(value);
      showToast(`✓ ${label} copied`);
    } catch {
      showToast(`Unable to copy ${label.toLowerCase()}`);
    } finally {
      setCopyLoading(null);
    }
  };

  const handleUserJoined = useCallback((participant: Record<string, unknown>) => {
    useRoomStore.getState().addParticipant({
      id: participant.id as string,
      roomId: participant.roomId as string,
      sessionId: participant.sessionId as string | undefined,
      displayName: participant.displayName as string,
      joinedAt: participant.joinedAt as string,
      lastSeenAt: participant.lastSeenAt as string,
      isActive: participant.isActive as boolean,
      lastViewportX: participant.lastViewportX as number | undefined,
      lastViewportY: participant.lastViewportY as number | undefined,
      lastViewportZoom: participant.lastViewportZoom as number | undefined,
      lastViewportWidth: participant.lastViewportWidth as number | undefined,
      lastViewportHeight: participant.lastViewportHeight as number | undefined,
    });
  }, []);

  const handleUserLeft = useCallback((participantId: string) => {
    useRoomStore.getState().removeParticipant(participantId);
  }, []);

  // Listen for participant lifecycle events.
  useRoomUserJoined(handleUserJoined);
  useRoomUserLeft(handleUserLeft);

  const handleCreateSession = async () => {
    try {
      setError(null);
      if (!displayName.trim()) {
        setError('Please enter a display name');
        return;
      }
      setLoadingAction('create-session');
      await createSession(displayName);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create session');
    } finally {
      setLoadingAction(null);
    }
  };

  const handleEnterSubmit = (event: ReactKeyboardEvent<HTMLInputElement>, action: () => void) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    action();
  };

  const handleCreateRoom = async () => {
    try {
      setError(null);
      setLoadingAction('create-room');
      beginRoomLoading();
      await createRoom(roomInput || undefined);
      completeRoomLoading();
      setRoomInput('');
      showToast('✓ Room created');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create room');
      resetRoomLoading();
    } finally {
      setLoadingAction(null);
    }
  };

  const handleJoinRoom = async () => {
    try {
      setError(null);
      if (!roomIdOrCode.trim()) {
        setError('Please enter a room ID or share code');
        return;
      }
      setLoadingAction('join-room');
      beginRoomLoading();
      // Check if it's a UUID (looks like one) or a share code
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(roomIdOrCode);
      if (isUUID) {
        await joinRoom(roomIdOrCode, undefined);
      } else {
        await joinRoom(undefined, roomIdOrCode);
      }
      completeRoomLoading();
      showToast('✓ Joined room');
      setRoomIdOrCode('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to join room');
      resetRoomLoading();
    } finally {
      setLoadingAction(null);
    }
  };

  const handleLeaveRoom = async () => {
    try {
      setError(null);
      setLoadingAction('leave-room');
      await leaveRoom();
      showToast('✓ Left room');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to leave room');
    } finally {
      setLoadingAction(null);
    }
  };

  return (
    <div className="app-shell">
      {room ? (
        <div className="room-layout">
          <aside className="room-panel" aria-label="Room control panel">
            <header className="panel-header">
              <div>
                <p className="eyebrow">Realtime Infinite Canvas</p>
                <h1 className="panel-title">Collaborative Session</h1>
              </div>
              <span className="participant-badge" title="Active participants">
                {connectedCount} active
              </span>
            </header>

            <section className="info-grid" aria-label="Room information cards">
              <article className="info-card">
                <p className="card-label">Connection</p>
                <StatusBadge status={status} label={statusLabel} />
                {connError && <p className="inline-error">{connError}</p>}
                {reconnecting ? <p className="subtle-text">Attempting automatic reconnection...</p> : null}
              </article>

              <article className="info-card">
                <p className="card-label">Room ID</p>
                {showRoomSkeleton ? <SkeletonBlock className="skeleton-line skeleton-room-meta" /> : <p className="mono-value">{room.id}</p>}
                <LoadingButton
                  className="ghost-btn"
                  type="button"
                  onClick={() => copyToClipboard(room.id, 'Room ID', 'room-id')}
                  loading={copyLoading === 'room-id'}
                  loadingLabel="Copying..."
                  disabled={isRoomLoading}
                  aria-label="Copy room ID"
                >
                  Copy
                </LoadingButton>
              </article>

              <article className="info-card">
                <p className="card-label">Share Code</p>
                {showRoomSkeleton ? <SkeletonBlock className="skeleton-line skeleton-share-code" /> : <p className="mono-value large room-code-value">{room.shareCode}</p>}
                <LoadingButton
                  className="ghost-btn"
                  type="button"
                  onClick={() => copyToClipboard(room.shareCode, 'Share code', 'share-code')}
                  loading={copyLoading === 'share-code'}
                  loadingLabel="Copying..."
                  disabled={isRoomLoading}
                  aria-label="Copy room share code"
                >
                  Copy
                </LoadingButton>
              </article>

              <article className="info-card">
                <p className="card-label">Session</p>
                {showRoomSkeleton ? (
                  <>
                    <SkeletonBlock className="skeleton-line skeleton-name" />
                    <SkeletonBlock className="skeleton-line skeleton-session" />
                  </>
                ) : (
                  <>
                    <p className="card-strong">{session?.displayName ?? 'Guest'}</p>
                    <p className="subtle-text">{session?.sessionId.slice(0, 8)}...</p>
                  </>
                )}
              </article>
            </section>

            <section className="participants-card" aria-label="Participants list" aria-busy={isRoomLoading}>
              <div className="participants-header">
                <h2>Participants</h2>
                <span>{participants.length}</span>
              </div>
              {showRoomSkeleton ? (
                <div className="participants-skeleton" aria-hidden="true">
                  <SkeletonBlock className="skeleton-line skeleton-participant" />
                  <SkeletonBlock className="skeleton-line skeleton-participant" />
                  <SkeletonBlock className="skeleton-line skeleton-participant" />
                </div>
              ) : participants.length === 0 ? (
                <p className="empty-state">Nobody has joined this room yet. Share the room code to invite collaborators.</p>
              ) : (
                <ul className="participant-list">
                  {participants.map((participant) => (
                    <li key={participant.id} className="participant-item">
                      <div>
                        <p className="participant-name">{participant.displayName}</p>
                        <p className="participant-meta">Joined {new Date(participant.joinedAt).toLocaleTimeString()}</p>
                      </div>
                      <span className={participant.isActive ? 'participant-status active' : 'participant-status'}>
                        {participant.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="info-card" aria-label="Keyboard shortcuts">
              <p className="card-label">Keyboard Shortcuts</p>
              <ul className="shortcut-list">
                <li><span>R</span> Rectangle</li>
                <li><span>C</span> Circle</li>
                <li><span>T</span> Text</li>
                <li><span>S</span> Sticky Note</li>
              </ul>
            </section>

            <LoadingButton
              className="danger-btn"
              type="button"
              onClick={handleLeaveRoom}
              loading={loadingAction === 'leave-room'}
              loadingLabel="Leaving..."
              aria-label="Leave current room"
            >
              Leave Room
            </LoadingButton>
          </aside>

          <main className="canvas-layout" aria-label="Canvas workspace">
            <Canvas
              participantCount={participants.length}
              loadingPhase={isRoomLoading && roomLoadingPhase !== 'idle' ? roomLoadingPhase : null}
              loadingCopy={roomLoadingPhase === 'idle' ? null : ROOM_LOADING_COPY[roomLoadingPhase]}
              onObjectDeleted={() => showToast('✓ Object deleted')}
              onNotify={showToast}
              sessionToken={session?.sessionToken}
              sessionId={session?.sessionId}
            />
          </main>
        </div>
      ) : (
        <main className="entry-layout">
          <section className="entry-card">
            <header className="entry-header">
              <p className="eyebrow">Realtime Infinite Canvas</p>
              <h1>Build ideas together, instantly</h1>
              <p className="subtle-text">Create a guest session, open a room, and share the code with collaborators.</p>
            </header>

            <article className="info-card entry-status-card">
              <p className="card-label">Server Connection</p>
              <StatusBadge status={status} label={statusLabel} />
              {connError && <p className="inline-error">{connError}</p>}
            </article>

            {!session ? (
              <section className="entry-section" aria-busy={sessionLoading}>
                <h2>Create Guest Session</h2>
                <div className="form-row">
                  <label className="visually-hidden" htmlFor="display-name-input">Display name</label>
                  <input
                    id="display-name-input"
                    type="text"
                    placeholder="Enter display name"
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    onKeyDown={(event) => handleEnterSubmit(event, handleCreateSession)}
                    disabled={sessionLoading}
                    className="text-input"
                    aria-label="Display name"
                    autoComplete="nickname"
                  />
                  <LoadingButton
                    type="button"
                    className="primary-btn"
                    onClick={handleCreateSession}
                    disabled={sessionLoading}
                    loading={loadingAction === 'create-session'}
                    loadingLabel="Creating session..."
                    aria-label="Create guest session"
                  >
                    Create Session
                  </LoadingButton>
                </div>
                {sessionError && <p className="inline-error">{sessionError}</p>}
              </section>
            ) : (
              <>
                <section className="entry-section">
                  <h2>Guest Session</h2>
                  <div className="session-summary">
                    <p><strong>Name:</strong> {session.displayName}</p>
                    <p><strong>Session ID:</strong> {session.sessionId.slice(0, 8)}...</p>
                    <p><strong>Expires:</strong> {new Date(session.expiresAt).toLocaleTimeString()}</p>
                  </div>
                </section>

                <section className="entry-section">
                  <h2>Create New Room</h2>
                  <div className="form-row">
                    <label className="visually-hidden" htmlFor="room-title-input">Room title</label>
                    <input
                      id="room-title-input"
                      type="text"
                      placeholder="Room title (optional)"
                      value={roomInput}
                      onChange={(event) => setRoomInput(event.target.value)}
                      onKeyDown={(event) => handleEnterSubmit(event, handleCreateRoom)}
                      disabled={loadingAction === 'create-room'}
                      className="text-input"
                      aria-label="Room title"
                    />
                    <LoadingButton
                      type="button"
                      className="success-btn"
                      onClick={handleCreateRoom}
                      loading={loadingAction === 'create-room'}
                      loadingLabel="Creating room..."
                      aria-label="Create room"
                    >
                      Create Room
                    </LoadingButton>
                  </div>
                </section>

                <section className="entry-section">
                  <h2>Join Existing Room</h2>
                  <p id="join-room-help" className="subtle-text">Paste either a full Room ID or a short Share Code.</p>
                  <div className="form-row">
                    <label className="visually-hidden" htmlFor="room-join-input">Room ID or Share Code</label>
                    <input
                      id="room-join-input"
                      type="text"
                      placeholder="Room ID or Share Code"
                      value={roomIdOrCode}
                      onChange={(event) => setRoomIdOrCode(event.target.value)}
                      onKeyDown={(event) => handleEnterSubmit(event, handleJoinRoom)}
                      disabled={loadingAction === 'join-room'}
                      className="text-input"
                      aria-label="Room ID or share code"
                      aria-describedby="join-room-help"
                      autoCapitalize="off"
                      autoCorrect="off"
                    />
                    <LoadingButton
                      type="button"
                      className="accent-btn"
                      onClick={handleJoinRoom}
                      loading={loadingAction === 'join-room'}
                      loadingLabel="Joining room..."
                      aria-label="Join room"
                    >
                      Join Room
                    </LoadingButton>
                  </div>
                </section>
              </>
            )}

            {error && (
              <div className="error-banner" role="alert">
                <strong>Error:</strong> {error}
              </div>
            )}
          </section>
        </main>
      )}

      {toast && (
        <div className="app-toast" role="status" aria-live="polite">
          {toast}
        </div>
      )}
    </div>
  );
};

export default App;

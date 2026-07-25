import { FC, useState } from 'react';
import { useConnectionStatus } from './hooks/useConnectionStatus.js';
import { useCreateSession } from './hooks/useAuth.js';
import { useCreateRoom, useJoinRoom, useLeaveRoom, useRoomUserJoined, useRoomUserLeft } from './hooks/useRoom.js';
import { useRoomStore } from './store/room.js';
import { Canvas } from './components/Canvas.js';

const STATUS_COLOR: Record<string, string> = {
  connected: '#22c55e',
  connecting: '#f59e0b',
  disconnected: '#94a3b8',
  error: '#ef4444',
};

const App: FC = () => {
  const { status, error: connError } = useConnectionStatus();
  const { session, loading: sessionLoading, error: sessionError, createSession } = useCreateSession();
  const createRoom = useCreateRoom();
  const joinRoom = useJoinRoom();
  const leaveRoom = useLeaveRoom();
  const { room, participants } = useRoomStore();

  const [displayName, setDisplayName] = useState('');
  const [roomInput, setRoomInput] = useState('');
  const [roomIdOrCode, setRoomIdOrCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Listen for participant joins
  useRoomUserJoined((participant) => {
    useRoomStore.getState().addParticipant({
      id: participant.id as string,
      roomId: participant.roomId as string,
      displayName: participant.displayName as string,
      joinedAt: participant.joinedAt as string,
      lastSeenAt: participant.lastSeenAt as string,
      isActive: participant.isActive as boolean,
    });
  });

  // Listen for participant leaves
  useRoomUserLeft((participantId) => {
    useRoomStore.getState().removeParticipant(participantId);
  });

  const handleCreateSession = async () => {
    try {
      setError(null);
      if (!displayName.trim()) {
        setError('Please enter a display name');
        return;
      }
      await createSession(displayName);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create session');
    }
  };

  const handleCreateRoom = async () => {
    try {
      setError(null);
      await createRoom(roomInput || undefined);
      setRoomInput('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create room');
    }
  };

  const handleJoinRoom = async () => {
    try {
      setError(null);
      if (!roomIdOrCode.trim()) {
        setError('Please enter a room ID or share code');
        return;
      }
      // Check if it's a UUID (looks like one) or a share code
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(roomIdOrCode);
      if (isUUID) {
        await joinRoom(roomIdOrCode, undefined);
      } else {
        await joinRoom(undefined, roomIdOrCode);
      }
      setRoomIdOrCode('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to join room');
    }
  };

  const handleLeaveRoom = async () => {
    try {
      setError(null);
      await leaveRoom();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to leave room');
    }
  };

  return (
    <>
      {/* When in a room: full-screen split layout (sidebar + canvas) */}
      {room ? (
        <div style={{ display: 'flex', height: '100vh', width: '100vw' }}>
          {/* Control Panel Sidebar */}
          <div style={{
            width: '400px',
            borderRight: '1px solid #e2e8f0',
            overflowY: 'auto',
            padding: '2rem',
            fontFamily: 'system-ui, sans-serif',
            background: '#ffffff',
          }}>
            <h1 style={{ fontSize: '1.25rem', marginBottom: '1.5rem' }}>Realtime Canvas</h1>

            {/* Connection Status */}
            <section style={{ marginBottom: '1.5rem', paddingBottom: '1.5rem', borderBottom: '1px solid #e2e8f0' }}>
              <h2 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.5rem', color: '#64748b' }}>
                SERVER CONNECTION
              </h2>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    backgroundColor: STATUS_COLOR[status] ?? STATUS_COLOR.disconnected,
                    display: 'inline-block',
                  }}
                />
                <span style={{ textTransform: 'capitalize', fontWeight: 500 }}>{status}</span>
              </div>
            </section>

            {/* Session Info */}
            <section style={{ marginBottom: '1.5rem', paddingBottom: '1.5rem', borderBottom: '1px solid #e2e8f0' }}>
              <h2 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.5rem', color: '#64748b' }}>
                GUEST SESSION
              </h2>
              <p style={{ fontSize: '0.875rem', margin: '0.25rem 0' }}>
                <strong>Name:</strong> {session?.displayName}
              </p>
              <p style={{ fontSize: '0.875rem', margin: '0.25rem 0' }}>
                <strong>Session ID:</strong> {session?.sessionId.slice(0, 8)}...
              </p>
            </section>

            {/* Room Display */}
            <section style={{ marginBottom: '1.5rem', paddingBottom: '1.5rem', borderBottom: '1px solid #e2e8f0' }}>
              <h2 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.5rem', color: '#64748b' }}>
                CURRENT ROOM
              </h2>
              <p style={{ fontSize: '0.875rem', margin: '0.25rem 0' }}>
                <strong>Title:</strong> {room.title}
              </p>
              <p style={{ fontSize: '0.875rem', margin: '0.25rem 0' }}>
                <strong>Share Code:</strong> {room.shareCode}
              </p>
              <p style={{ fontSize: '0.875rem', margin: '0.25rem 0' }}>
                <strong>Room ID:</strong> {room.id.slice(0, 8)}...
              </p>
              <button
                onClick={handleLeaveRoom}
                style={{
                  marginTop: '0.75rem',
                  padding: '0.5rem 1rem',
                  background: '#ef4444',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  width: '100%',
                }}
              >
                Leave Room
              </button>
            </section>

            {/* Participants */}
            <section>
              <h2 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.75rem', color: '#64748b' }}>
                PARTICIPANTS ({participants.length})
              </h2>
              {participants.length === 0 ? (
                <p style={{ fontSize: '0.8rem', color: '#94a3b8' }}>No participants yet</p>
              ) : (
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {participants.map((p) => (
                    <li
                      key={p.id}
                      style={{
                        padding: '0.5rem',
                        background: '#f8fafc',
                        borderRadius: '4px',
                        marginBottom: '0.5rem',
                        fontSize: '0.875rem',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontWeight: 500 }}>{p.displayName}</span>
                        <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                          {p.isActive ? '🟢 Active' : '⚫ Inactive'}
                        </span>
                      </div>
                      <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.25rem' }}>
                        Joined: {new Date(p.joinedAt).toLocaleTimeString()}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          {/* Canvas Workspace */}
          <div style={{ flex: 1, background: '#fafafa' }}>
            <Canvas />
          </div>
        </div>
      ) : (
        /* When not in a room: centered control panel */
        <div style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif', maxWidth: '800px' }}>
          <h1 style={{ fontSize: '1.5rem', marginBottom: '1.5rem' }}>Realtime Infinite Canvas</h1>

          {/* Connection Status */}
          <section style={{ marginBottom: '1.5rem', paddingBottom: '1.5rem', borderBottom: '1px solid #e2e8f0' }}>
            <h2 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.5rem', color: '#64748b' }}>
              SERVER CONNECTION
            </h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  backgroundColor: STATUS_COLOR[status] ?? STATUS_COLOR.disconnected,
                  display: 'inline-block',
                }}
              />
              <span style={{ textTransform: 'capitalize', fontWeight: 500 }}>{status}</span>
            </div>
            {connError && (
              <p style={{ color: STATUS_COLOR.error, fontSize: '0.8rem', marginTop: '0.5rem' }}>
                {connError}
              </p>
            )}
          </section>

          {/* Auth Section */}
          {!session ? (
            <section style={{ marginBottom: '1.5rem', paddingBottom: '1.5rem', borderBottom: '1px solid #e2e8f0' }}>
              <h2 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.75rem', color: '#64748b' }}>
                CREATE GUEST SESSION
              </h2>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  type="text"
                  placeholder="Enter display name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  style={{
                    flex: 1,
                    padding: '0.5rem',
                    border: '1px solid #e2e8f0',
                    borderRadius: '4px',
                    fontSize: '0.875rem',
                  }}
                />
                <button
                  onClick={handleCreateSession}
                  disabled={sessionLoading}
                  style={{
                    padding: '0.5rem 1rem',
                    background: '#3b82f6',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: sessionLoading ? 'not-allowed' : 'pointer',
                    opacity: sessionLoading ? 0.5 : 1,
                  }}
                >
                  {sessionLoading ? 'Creating...' : 'Create Session'}
                </button>
              </div>
              {sessionError && (
                <p style={{ color: STATUS_COLOR.error, fontSize: '0.8rem', marginTop: '0.5rem' }}>
                  {sessionError}
                </p>
              )}
            </section>
          ) : (
            <>
              {/* Session Display */}
              <section style={{ marginBottom: '1.5rem', paddingBottom: '1.5rem', borderBottom: '1px solid #e2e8f0' }}>
                <h2 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.5rem', color: '#64748b' }}>
                  GUEST SESSION
                </h2>
                <p style={{ fontSize: '0.875rem', margin: '0.25rem 0' }}>
                  <strong>Name:</strong> {session.displayName}
                </p>
                <p style={{ fontSize: '0.875rem', margin: '0.25rem 0' }}>
                  <strong>Session ID:</strong> {session.sessionId.slice(0, 8)}...
                </p>
                <p style={{ fontSize: '0.875rem', margin: '0.25rem 0' }}>
                  <strong>Expires:</strong> {new Date(session.expiresAt).toLocaleTimeString()}
                </p>
              </section>

              {/* Room Operations */}
              {!room ? (
                <>
                  {/* Create Room */}
                  <section style={{ marginBottom: '1.5rem', paddingBottom: '1.5rem', borderBottom: '1px solid #e2e8f0' }}>
                    <h2 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.75rem', color: '#64748b' }}>
                      CREATE NEW ROOM
                    </h2>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <input
                        type="text"
                        placeholder="Room title (optional)"
                        value={roomInput}
                        onChange={(e) => setRoomInput(e.target.value)}
                        style={{
                          flex: 1,
                          padding: '0.5rem',
                          border: '1px solid #e2e8f0',
                          borderRadius: '4px',
                          fontSize: '0.875rem',
                        }}
                      />
                      <button
                        onClick={handleCreateRoom}
                        style={{
                          padding: '0.5rem 1rem',
                          background: '#10b981',
                          color: 'white',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: 'pointer',
                        }}
                      >
                        Create
                      </button>
                    </div>
                  </section>

                  {/* Join Room */}
                  <section style={{ marginBottom: '1.5rem', paddingBottom: '1.5rem', borderBottom: '1px solid #e2e8f0' }}>
                    <h2 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.75rem', color: '#64748b' }}>
                      JOIN EXISTING ROOM
                    </h2>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <input
                        type="text"
                        placeholder="Room ID or Share Code"
                        value={roomIdOrCode}
                        onChange={(e) => setRoomIdOrCode(e.target.value)}
                        style={{
                          flex: 1,
                          padding: '0.5rem',
                          border: '1px solid #e2e8f0',
                          borderRadius: '4px',
                          fontSize: '0.875rem',
                        }}
                      />
                      <button
                        onClick={handleJoinRoom}
                        style={{
                          padding: '0.5rem 1rem',
                          background: '#8b5cf6',
                          color: 'white',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: 'pointer',
                        }}
                      >
                        Join
                      </button>
                    </div>
                  </section>
                </>
              ) : null}
            </>
          )}

          {/* Error Display */}
          {error && (
            <div style={{ marginTop: '1.5rem', padding: '1rem', background: '#fee2e2', borderRadius: '4px', border: '1px solid #fecaca' }}>
              <p style={{ fontSize: '0.875rem', color: '#991b1b', margin: 0 }}>
                <strong>Error:</strong> {error}
              </p>
            </div>
          )}
        </div>
      )}
    </>
  );
};

export default App;

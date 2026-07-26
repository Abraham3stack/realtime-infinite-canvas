import type { Server, Socket } from 'socket.io';
import type { AuthenticatedSocket } from '../types.js';

export interface RoomPhysicsState {
	enabled: boolean;
	simulationRunning: boolean;
	gravityY: number;
	restitution: number;
	frictionAir: number;
	staticObjectIds: string[];
	resetNonce: number;
	revision: number;
}

interface PhysicsStatePatch {
	enabled?: boolean;
	simulationRunning?: boolean;
	gravityY?: number;
	restitution?: number;
	frictionAir?: number;
}

interface PhysicsUpdateStatePayload {
	roomId: string;
	patch: PhysicsStatePatch;
}

interface PhysicsSetStaticPayload {
	roomId: string;
	objectId: string;
	isStatic: boolean;
}

interface PhysicsResetPayload {
	roomId: string;
}

const roomPhysicsState = new Map<string, RoomPhysicsState>();

const DEFAULT_STATE: Omit<RoomPhysicsState, 'revision'> = {
	enabled: false,
	simulationRunning: false,
	gravityY: 1,
	restitution: 0.75,
	frictionAir: 0.02,
	staticObjectIds: [],
	resetNonce: 0,
};

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function ensureRoomPhysicsState(roomId: string): RoomPhysicsState {
	const existing = roomPhysicsState.get(roomId);
	if (existing) {
		return existing;
	}

	const created: RoomPhysicsState = {
		...DEFAULT_STATE,
		revision: 1,
	};
	roomPhysicsState.set(roomId, created);
	return created;
}

function emitRoomState(io: Server, roomId: string, state: RoomPhysicsState): void {
	io.to(roomId).emit('physics:state', {
		roomId,
		state,
		serverTs: new Date().toISOString(),
	});
}

function isRoomAuthorized(socket: AuthenticatedSocket, roomId: string): boolean {
	return Boolean(socket.roomId && socket.roomId === roomId);
}

export function getRoomPhysicsState(roomId: string): RoomPhysicsState {
	return ensureRoomPhysicsState(roomId);
}

export function clearRoomPhysicsState(roomId: string): void {
	roomPhysicsState.delete(roomId);
}

export function registerPhysicsHandlers(io: Server): void {
	io.on('connection', (socket: Socket) => {
		const authSocket = socket as AuthenticatedSocket;

		socket.on('physics:update-state', (payload: PhysicsUpdateStatePayload) => {
			if (!payload || typeof payload.roomId !== 'string' || typeof payload.patch !== 'object' || payload.patch === null) {
				return;
			}

			if (!isRoomAuthorized(authSocket, payload.roomId)) {
				return;
			}

			const current = ensureRoomPhysicsState(payload.roomId);
			const patch = payload.patch;

			const next: RoomPhysicsState = {
				...current,
				enabled: typeof patch.enabled === 'boolean' ? patch.enabled : current.enabled,
				simulationRunning:
					typeof patch.simulationRunning === 'boolean' ? patch.simulationRunning : current.simulationRunning,
				gravityY: typeof patch.gravityY === 'number' ? clamp(patch.gravityY, 0, 10) : current.gravityY,
				restitution: typeof patch.restitution === 'number' ? clamp(patch.restitution, 0, 1.2) : current.restitution,
				frictionAir: typeof patch.frictionAir === 'number' ? clamp(patch.frictionAir, 0, 0.2) : current.frictionAir,
				revision: current.revision + 1,
			};

			// Turning physics mode off always pauses simulation.
			if (!next.enabled) {
				next.simulationRunning = false;
			}

			roomPhysicsState.set(payload.roomId, next);
			emitRoomState(io, payload.roomId, next);
		});

		socket.on('physics:set-static', (payload: PhysicsSetStaticPayload) => {
			if (!payload || typeof payload.roomId !== 'string' || typeof payload.objectId !== 'string') {
				return;
			}

			if (!isRoomAuthorized(authSocket, payload.roomId)) {
				return;
			}

			const current = ensureRoomPhysicsState(payload.roomId);
			const staticSet = new Set(current.staticObjectIds);

			if (payload.isStatic) {
				staticSet.add(payload.objectId);
			} else {
				staticSet.delete(payload.objectId);
			}

			const next: RoomPhysicsState = {
				...current,
				staticObjectIds: Array.from(staticSet),
				revision: current.revision + 1,
			};

			roomPhysicsState.set(payload.roomId, next);
			emitRoomState(io, payload.roomId, next);
		});

		socket.on('physics:reset', (payload: PhysicsResetPayload) => {
			if (!payload || typeof payload.roomId !== 'string') {
				return;
			}

			if (!isRoomAuthorized(authSocket, payload.roomId)) {
				return;
			}

			const current = ensureRoomPhysicsState(payload.roomId);
			const next: RoomPhysicsState = {
				...current,
				resetNonce: current.resetNonce + 1,
				revision: current.revision + 1,
			};

			roomPhysicsState.set(payload.roomId, next);
			emitRoomState(io, payload.roomId, next);
		});
	});
}

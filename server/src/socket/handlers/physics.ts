import type { Server, Socket } from 'socket.io';
import { prisma } from '../../db/prisma.js';
import type { AuthenticatedSocket } from '../types.js';
import type { RoomEventType } from '@realtime-canvas/shared';
import { appendRoomEvent, ROOM_EVENT_SCHEMA_VERSION, type RoomEventJournalEntry } from '../../journal/roomEvents.js';

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
	operationId: string;
	roomId: string;
	patch: PhysicsStatePatch;
}

interface PhysicsSetStaticPayload {
	operationId: string;
	roomId: string;
	objectId: string;
	isStatic: boolean;
}

interface PhysicsResetPayload {
	operationId: string;
	roomId: string;
}

const roomPhysicsState = new Map<string, RoomPhysicsState>();
const roomPhysicsJournalQueue = new Map<string, Promise<void>>();

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

function buildRoomEventEntry(params: {
	roomId: string;
	operationId: string;
	actorSessionId: string;
	actorDisplayName: string;
	eventType: RoomEventType;
	payload: Record<string, unknown>;
}): RoomEventJournalEntry {
	return {
		roomId: params.roomId,
		operationId: params.operationId,
		actorSessionId: params.actorSessionId,
		actorDisplayName: params.actorDisplayName,
		eventType: params.eventType,
		payload: params.payload,
		schemaVersion: ROOM_EVENT_SCHEMA_VERSION,
	};
}

function enqueueRoomPhysicsJournalWrite(params: {
	roomId: string;
	logLabel: string;
	task: () => Promise<void>;
}): void {
	const prior = roomPhysicsJournalQueue.get(params.roomId) ?? Promise.resolve();

	const next = prior
		.catch(() => {
			// Preserve queue progression after prior failures.
		})
		.then(params.task)
		.catch((err) => {
			console.error(`[${params.logLabel}] journal error:`, err);
		})
		.finally(() => {
			if (roomPhysicsJournalQueue.get(params.roomId) === next) {
				roomPhysicsJournalQueue.delete(params.roomId);
			}
		});

	roomPhysicsJournalQueue.set(params.roomId, next);
}

export function getRoomPhysicsState(roomId: string): RoomPhysicsState {
	return ensureRoomPhysicsState(roomId);
}

export function clearRoomPhysicsState(roomId: string): void {
	roomPhysicsState.delete(roomId);
	roomPhysicsJournalQueue.delete(roomId);
}

export function registerPhysicsHandlers(io: Server): void {
	io.on('connection', (socket: Socket) => {
		const authSocket = socket as AuthenticatedSocket;

			socket.on('physics:update-state', (payload: PhysicsUpdateStatePayload) => {
			if (
				!payload ||
				typeof payload.operationId !== 'string' ||
				typeof payload.roomId !== 'string' ||
				typeof payload.patch !== 'object' ||
				payload.patch === null
			) {
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

			enqueueRoomPhysicsJournalWrite({
				roomId: payload.roomId,
				logLabel: 'physics:update-state',
				task: async () => {
					await prisma.$transaction(async (tx) => {
						await appendRoomEvent(
							tx,
							buildRoomEventEntry({
								roomId: payload.roomId,
								operationId: payload.operationId,
								actorSessionId: authSocket.sessionId as string,
								actorDisplayName: authSocket.displayName as string,
								eventType: 'physics:update-state',
								payload: { patch },
							})
						);
					});
				},
			});
		});

			socket.on('physics:set-static', (payload: PhysicsSetStaticPayload) => {
			if (
				!payload ||
				typeof payload.operationId !== 'string' ||
				typeof payload.roomId !== 'string' ||
				typeof payload.objectId !== 'string'
			) {
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

			enqueueRoomPhysicsJournalWrite({
				roomId: payload.roomId,
				logLabel: 'physics:set-static',
				task: async () => {
					await prisma.$transaction(async (tx) => {
						await appendRoomEvent(
							tx,
							buildRoomEventEntry({
								roomId: payload.roomId,
								operationId: payload.operationId,
								actorSessionId: authSocket.sessionId as string,
								actorDisplayName: authSocket.displayName as string,
								eventType: 'physics:set-static',
								payload: { objectId: payload.objectId, isStatic: payload.isStatic },
							})
						);
					});
				},
			});
		});

			socket.on('physics:reset', (payload: PhysicsResetPayload) => {
			if (!payload || typeof payload.operationId !== 'string' || typeof payload.roomId !== 'string') {
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

			enqueueRoomPhysicsJournalWrite({
				roomId: payload.roomId,
				logLabel: 'physics:reset',
				task: async () => {
					await prisma.$transaction(async (tx) => {
						await appendRoomEvent(
							tx,
							buildRoomEventEntry({
								roomId: payload.roomId,
								operationId: payload.operationId,
								actorSessionId: authSocket.sessionId as string,
								actorDisplayName: authSocket.displayName as string,
								eventType: 'physics:reset',
								payload: {},
							})
						);
					});
				},
			});
		});
	});
}

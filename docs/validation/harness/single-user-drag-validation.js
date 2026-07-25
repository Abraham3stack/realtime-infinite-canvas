/*
 * Single-user drag validation harness for Phase 4.
 *
 * This script is intentionally isolated from production app code.
 * It validates one genuine drag path using shared coordinate conversion helpers.
 */

import {
  captureKonvaGeometry,
  inspectPointConsistency,
  objectCenterInStage,
  stageLocalToScreen,
} from './coordinate-space-helper.js';

export async function runSingleUserDragValidation(page, targetObjectId) {
  const geometryBefore = await captureKonvaGeometry(page, targetObjectId);
  const centerStageBefore = objectCenterInStage(geometryBefore);

  const consistency = await inspectPointConsistency(page, geometryBefore, centerStageBefore);

  await page.evaluate((id) => {
    const stage = window.Konva?.stages?.[0];
    const group = stage?.find('Group').find((node) => node.id() === id);
    if (!group) {
      throw new Error('Target group not found for drag probe');
    }

    window.__phase4DragProbe = {
      dragEndCount: 0,
      before: { x: group.x(), y: group.y() },
      after: null,
      emittedObjectUpdate: 0,
    };

    // Sync uses websocket transport; count outbound object:update frames.
    if (!window.__phase4WsWrapped) {
      window.__phase4WsWrapped = true;
      const originalSend = WebSocket.prototype.send;
      WebSocket.prototype.send = function patchedSend(payload) {
        try {
          const text = typeof payload === 'string' ? payload : '';
          if (text.includes('object:update')) {
            window.__phase4DragProbe.emittedObjectUpdate += 1;
          }
        } catch {
          // Ignore probe parse failures and preserve application behavior.
        }
        return originalSend.call(this, payload);
      };
    }

    group.on('dragend.phase4probe', () => {
      window.__phase4DragProbe.dragEndCount += 1;
      window.__phase4DragProbe.after = { x: group.x(), y: group.y() };
    });
  }, targetObjectId);

  const screenStart = stageLocalToScreen(geometryBefore, centerStageBefore);
  const screenEnd = { x: screenStart.x + 110, y: screenStart.y + 70 };

  await page.mouse.move(screenStart.x, screenStart.y);
  await page.mouse.down();
  await page.mouse.move(screenEnd.x, screenEnd.y, { steps: 18 });
  await page.mouse.up();

  await page.evaluate(() => {
    // Capture JSON export to prove store state changed after drag.
    const originalCreateObjectURL = URL.createObjectURL.bind(URL);
    window.__phase4ExportPromise = new Promise((resolve) => {
      URL.createObjectURL = (blob) => {
        if (blob?.type?.includes('json')) {
          blob
            .text()
            .then((text) => resolve(text))
            .catch(() => resolve(null));
        }
        return originalCreateObjectURL(blob);
      };
    });
  });

  await page.getByRole('button', { name: 'Export JSON' }).click();

  const postDrag = await page.evaluate((id) => {
    const stage = window.Konva?.stages?.[0];
    const group = stage?.find('Group').find((node) => node.id() === id);
    const probe = window.__phase4DragProbe || null;
    if (!group || !probe) {
      throw new Error('Missing post-drag probe state');
    }

    const exportedText = window.__phase4ExportPromise || null;

    return Promise.resolve(exportedText).then((raw) => {
      const parsed = raw ? JSON.parse(raw) : null;
      return {
      groupPosition: { x: group.x(), y: group.y() },
      probe,
      exportedObject: parsed?.objects?.find((obj) => obj.id === id) || null,
      exportedCount: parsed?.objects?.length ?? null,
    };
    });
  }, targetObjectId);

  const geometryAfter = await captureKonvaGeometry(page, targetObjectId);

  return {
    geometryBefore,
    consistency,
    dragPointer: {
      screenStart,
      screenEnd,
    },
    postDrag,
    geometryAfter,
  };
}

/*
 * Single-user resize validation harness for Phase 4.
 *
 * Goal:
 * Reliably drive resize handle drag and capture hard evidence for each lifecycle stage.
 */

import {
  captureKonvaGeometry,
  resizeHandlePointInStage,
  stageLocalToScreen,
} from './coordinate-space-helper.js';

function buildHandleCandidatePoints(basePoint) {
  return [
    { x: basePoint.x, y: basePoint.y, label: 'base' },
    { x: basePoint.x - 1, y: basePoint.y - 1, label: 'inset-1' },
    { x: basePoint.x - 2, y: basePoint.y - 2, label: 'inset-2' },
    { x: basePoint.x - 3, y: basePoint.y - 3, label: 'inset-3' },
    { x: basePoint.x - 1, y: basePoint.y - 2, label: 'inset-x1y2' },
    { x: basePoint.x - 2, y: basePoint.y - 1, label: 'inset-x2y1' },
  ];
}

export async function runSingleUserResizeValidation(
  page,
  targetObjectId,
  options = {}
) {
  const dragDeltaX = options.dragDeltaX ?? 80;
  const dragDeltaY = options.dragDeltaY ?? 60;

  const geometryBefore = await captureKonvaGeometry(page, targetObjectId);
  const baseHandleStage = resizeHandlePointInStage(geometryBefore, 3);
  const handleCandidatesStage = buildHandleCandidatePoints(baseHandleStage);

  const probeSetup = await page.evaluate(
    ({ objectId, handleCandidates }) => {
      const stage = window.Konva?.stages?.[0];
      if (!stage) {
        throw new Error('No Konva Stage found');
      }

      stage.off('.phase4ResizeProbe');

      const group = stage.find('Group').find((node) => node.id() === objectId);
      if (!group) {
        throw new Error(`Target group not found for resize probe: ${objectId}`);
      }

      // Ensure the probe interacts with the intended object when multiple shapes overlap.
      group.moveToTop();
      stage.batchDraw();

      const bodyRect =
        group.find((node) => node.getClassName?.() === 'Rect' && !node.draggable?.())[0] || null;
      const handleRect =
        group
          .find((node) => {
            const isRect = node.getClassName?.() === 'Rect';
            if (!isRect) return false;
            if (!node.draggable?.()) return false;
            return node.width() <= 20 && node.height() <= 20;
          })[0] || null;

      if (!bodyRect || !handleRect) {
        throw new Error('Resize probe could not find body rect and handle rect');
      }

      const objectDragStates = stage
        .find('Group')
        .filter((node) => !!node.id())
        .map((node) => ({ id: node.id(), draggable: node.draggable(), x: node.x(), y: node.y() }));

      const hitCandidates = handleCandidates.map((point) => {
        const hit = stage.getIntersection(point);
        return {
          ...point,
          hit: hit
            ? {
                className: hit.getClassName?.(),
                id: hit.id?.() || null,
                parentId: hit.getParent?.()?.id?.() || null,
                draggable: hit.draggable?.() || false,
                isHandle: hit === handleRect,
                isBody: hit === bodyRect,
                isGroup: hit === group,
              }
            : null,
        };
      });

      const selectedCandidate = hitCandidates.find((candidate) => candidate.hit?.isHandle) || null;
      if (!selectedCandidate) {
        throw new Error(`Resize handle is not top-most/hittable for target object: ${objectId}`);
      }

      const stageContentRect = stage.content.getBoundingClientRect();
      const pointerScreen = {
        x: stageContentRect.left + stage.x() + selectedCandidate.x * stage.scaleX(),
        y: stageContentRect.top + stage.y() + selectedCandidate.y * stage.scaleY(),
      };

      const eventLog = [];
      const pushEvent = (source, eventName, event) => {
        const target = event.target;
        eventLog.push({
          at: Date.now(),
          source,
          eventName,
          targetClass: target?.getClassName?.() || null,
          targetId: target?.id?.() || null,
          targetParentId: target?.getParent?.()?.id?.() || null,
          targetDraggable: target?.draggable?.() || false,
          targetIsHandle: target === handleRect,
          targetIsBody: target === bodyRect,
          targetIsGroup: target === group,
          stageIsDragging: stage.isDragging(),
          handleIsDragging: handleRect.isDragging(),
          groupIsDragging: group.isDragging(),
          pointerPosition: stage.getPointerPosition(),
        });
      };

      ['mousedown', 'dragstart', 'dragmove', 'dragend'].forEach((eventName) => {
        handleRect.on(`${eventName}.phase4ResizeProbe`, (event) => pushEvent('handle', eventName, event));
        group.on(`${eventName}.phase4ResizeProbe`, (event) => pushEvent('group', eventName, event));
        stage.on(`${eventName}.phase4ResizeProbe`, (event) => pushEvent('stage', eventName, event));
      });

      const domLog = [];
      const domListener = (event) => {
        domLog.push({
          at: Date.now(),
          eventName: event.type,
          clientX: event.clientX,
          clientY: event.clientY,
          buttons: event.buttons,
          button: event.button,
          pointerId: event.pointerId ?? null,
          targetTag: event.target?.tagName || null,
          hasPointerCapture:
            event.pointerId != null && stage.content.hasPointerCapture
              ? stage.content.hasPointerCapture(event.pointerId)
              : null,
        });
      };

      ['pointerdown', 'pointermove', 'pointerup', 'mousedown', 'mousemove', 'mouseup'].forEach((eventName) => {
        stage.content.addEventListener(eventName, domListener, true);
      });

      window.__phase4ResizeProbe = {
        objectId,
        stageContentRect: {
          left: stageContentRect.left,
          top: stageContentRect.top,
          width: stageContentRect.width,
          height: stageContentRect.height,
        },
        bodyBefore: {
          width: bodyRect.width(),
          height: bodyRect.height(),
        },
        groupBefore: {
          x: group.x(),
          y: group.y(),
        },
        handleVisible: handleRect.visible(),
        handleDraggable: handleRect.draggable(),
        handleRectStage: handleRect.getClientRect({ relativeTo: stage }),
        hitCandidates,
        selectedCandidate,
        pointerScreen,
        eventLog,
        domLog,
        objectDragStates,
      };

      return window.__phase4ResizeProbe;
    },
    { objectId: targetObjectId, handleCandidates: handleCandidatesStage }
  );

  const dragStartScreen =
    probeSetup.pointerScreen || stageLocalToScreen(geometryBefore, baseHandleStage);
  const dragEndScreen = {
    x: dragStartScreen.x + dragDeltaX,
    y: dragStartScreen.y + dragDeltaY,
  };

  await page.mouse.move(dragStartScreen.x, dragStartScreen.y);
  await page.mouse.down();
  await page.mouse.move(dragEndScreen.x, dragEndScreen.y, { steps: 16 });
  await page.mouse.up();

  const postResize = await page.evaluate((objectId) => {
    const stage = window.Konva?.stages?.[0];
    const probe = window.__phase4ResizeProbe;
    if (!stage || !probe) {
      throw new Error('Resize probe state missing');
    }

    const group = stage.find('Group').find((node) => node.id() === objectId);
    if (!group) {
      throw new Error(`Target group not found after resize: ${objectId}`);
    }

    const bodyRect =
      group.find((node) => node.getClassName?.() === 'Rect' && !node.draggable?.())[0] || null;
    if (!bodyRect) {
      throw new Error('Target body rect missing after resize');
    }

    const counts = probe.eventLog.reduce((acc, entry) => {
      const key = `${entry.source}:${entry.eventName}`;
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

    const firstMissingHandleStage =
      ['mousedown', 'dragstart', 'dragmove', 'dragend'].find(
        (name) => !probe.eventLog.some((entry) => entry.source === 'handle' && entry.eventName === name)
      ) || null;

    const groupDragStarted = probe.eventLog.some(
      (entry) => entry.eventName === 'dragstart' && entry.targetClass === 'Group'
    );

    return {
      counts,
      firstMissingHandleStage,
      groupDragStarted,
      bodyAfter: {
        width: bodyRect.width(),
        height: bodyRect.height(),
      },
      groupAfter: {
        x: group.x(),
        y: group.y(),
      },
      eventLog: probe.eventLog,
      domLog: probe.domLog,
      stageDraggingAfter: stage.isDragging(),
    };
  }, targetObjectId);

  return {
    geometryBefore,
    probeSetup,
    dragPointer: {
      startScreen: dragStartScreen,
      endScreen: dragEndScreen,
      deltaX: dragDeltaX,
      deltaY: dragDeltaY,
    },
    postResize,
  };
}

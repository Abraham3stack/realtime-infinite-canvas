/*
 * Phase 4 validation harness helper.
 *
 * Why this exists:
 * Konva Stage hit testing requires Stage-local coordinates.
 * Browser APIs like elementFromPoint and Playwright mouse APIs use screen/viewport coordinates.
 * Mixing these spaces causes false null intersections.
 */

/**
 * Capture runtime geometry from a live Konva stage for one object.
 * Returns all transforms and bounds needed to convert coordinates safely.
 */
export async function captureKonvaGeometry(page, objectId) {
  return await page.evaluate((targetId) => {
    const stages = window.Konva?.stages || [];
    const stage = stages[0] || null;
    if (!stage) {
      throw new Error('No Konva Stage found');
    }

    const layer = stage.getLayers?.()[0] || null;
    const groups = stage.find('Group');
    const group = targetId
      ? groups.find((node) => node.id() === targetId) || null
      : groups[0] || null;
    if (!group) {
      throw new Error(
        `No Konva Group found for target object: ${targetId || '(missing id)'}; available groups: ${groups
          .map((node) => node.id())
          .filter(Boolean)
          .join(', ')}`
      );
    }

    const bodyRect = group.find((node) => node.getClassName?.() === 'Rect' && !node.draggable?.())[0] || null;
    const objectRectStage = (bodyRect ? bodyRect : group).getClientRect({ relativeTo: stage });
    const stageContentRect = stage.content.getBoundingClientRect();

    return {
      stageCount: stages.length,
      stage: {
        x: stage.x(),
        y: stage.y(),
        scaleX: stage.scaleX(),
        scaleY: stage.scaleY(),
        width: stage.width(),
        height: stage.height(),
      },
      layer: layer
        ? {
            x: layer.x(),
            y: layer.y(),
            scaleX: layer.scaleX(),
            scaleY: layer.scaleY(),
            listening: layer.listening(),
            visible: layer.visible(),
          }
        : null,
      group: {
        id: group.id(),
        x: group.x(),
        y: group.y(),
        scaleX: group.scaleX(),
        scaleY: group.scaleY(),
        abs: group.getAbsolutePosition(),
        draggable: group.draggable(),
      },
      objectRectStage,
      stageContentRect: {
        left: stageContentRect.left,
        top: stageContentRect.top,
        width: stageContentRect.width,
        height: stageContentRect.height,
      },
      canvasCount: document.querySelectorAll('canvas').length,
      canvases: Array.from(document.querySelectorAll('canvas')).map((canvas, i) => {
        const rect = canvas.getBoundingClientRect();
        return {
          i,
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
          inKonvaContent: !!canvas.closest('.konvajs-content'),
        };
      }),
    };
  }, objectId);
}

/**
 * Convert Stage-local point to screen/viewport coordinates.
 * Use this when driving Playwright pointer APIs.
 */
export function stageLocalToScreen(geometry, stagePoint) {
  return {
    x:
      geometry.stageContentRect.left +
      geometry.stage.x +
      stagePoint.x * geometry.stage.scaleX,
    y:
      geometry.stageContentRect.top +
      geometry.stage.y +
      stagePoint.y * geometry.stage.scaleY,
  };
}

/**
 * Convert screen/viewport point to Stage-local coordinates.
 * Use this before calling stage.getIntersection.
 */
export function screenToStageLocal(geometry, screenPoint) {
  return {
    x: (screenPoint.x - geometry.stageContentRect.left - geometry.stage.x) / geometry.stage.scaleX,
    y: (screenPoint.y - geometry.stageContentRect.top - geometry.stage.y) / geometry.stage.scaleY,
  };
}

export function objectCenterInStage(geometry) {
  return {
    x: geometry.objectRectStage.x + geometry.objectRectStage.width / 2,
    y: geometry.objectRectStage.y + geometry.objectRectStage.height / 2,
  };
}

/**
 * Bottom-right handle point in Stage space for resize interactions.
 * Offset keeps the pointer inside the handle rectangle.
 */
export function resizeHandlePointInStage(geometry, inset = 3) {
  return {
    x: geometry.objectRectStage.x + geometry.objectRectStage.width - inset,
    y: geometry.objectRectStage.y + geometry.objectRectStage.height - inset,
  };
}

/**
 * Validate that one visual point is consistently addressed in all spaces.
 *
 * Important:
 * - stage.getIntersection receives Stage-local only.
 * - elementFromPoint receives screen coordinates.
 */
export async function inspectPointConsistency(page, geometry, stagePoint) {
  const screenPoint = stageLocalToScreen(geometry, stagePoint);
  const stageLocalFromScreen = screenToStageLocal(geometry, screenPoint);

  return await page.evaluate(({ stagePointArg, screenPointArg, stageLocalFromScreenArg }) => {
    const stage = window.Konva?.stages?.[0];
    const layer = stage?.getLayers?.()[0];
    if (!stage) {
      throw new Error('No Konva Stage found');
    }

    const hitAtStagePoint = stage.getIntersection(stagePointArg);
    const hitAtStageLocalFromScreen = stage.getIntersection(stageLocalFromScreenArg);

    const elementAtScreenPoint = document.elementFromPoint(screenPointArg.x, screenPointArg.y);

    let hitPixelAtStagePoint = null;
    let hitPixelAtStageLocalFromScreen = null;
    if (layer?.hitCanvas?.context?._context) {
      const ctx = layer.hitCanvas.context._context;
      hitPixelAtStagePoint = Array.from(
        ctx.getImageData(Math.floor(stagePointArg.x), Math.floor(stagePointArg.y), 1, 1).data
      );
      hitPixelAtStageLocalFromScreen = Array.from(
        ctx.getImageData(Math.floor(stageLocalFromScreenArg.x), Math.floor(stageLocalFromScreenArg.y), 1, 1).data
      );
    }

    return {
      stagePoint: stagePointArg,
      screenPoint: screenPointArg,
      stageLocalFromScreen: stageLocalFromScreenArg,
      hits: {
        stagePoint: hitAtStagePoint
          ? {
              className: hitAtStagePoint.getClassName?.(),
              parentId: hitAtStagePoint.getParent?.()?.id?.() || null,
            }
          : null,
        stageLocalFromScreen: hitAtStageLocalFromScreen
          ? {
              className: hitAtStageLocalFromScreen.getClassName?.(),
              parentId: hitAtStageLocalFromScreen.getParent?.()?.id?.() || null,
            }
          : null,
      },
      hitPixels: {
        stagePoint: hitPixelAtStagePoint,
        stageLocalFromScreen: hitPixelAtStageLocalFromScreen,
      },
      elementFromPoint: elementAtScreenPoint
        ? {
            tag: elementAtScreenPoint.tagName,
            inKonvaContent: !!elementAtScreenPoint.closest('.konvajs-content'),
          }
        : null,
    };
  }, {
    stagePointArg: stagePoint,
    screenPointArg: screenPoint,
    stageLocalFromScreenArg: stageLocalFromScreen,
  });
}

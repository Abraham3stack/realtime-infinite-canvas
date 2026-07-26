import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { runSingleUserDragValidation } from './single-user-drag-validation.js';
import { runSingleUserResizeValidation } from './single-user-resize-validation.js';

const BASE_URL = process.env.HARNESS_BASE_URL || 'http://localhost:5173';
const EVIDENCE_DIR = path.resolve('docs/validation/evidence');

function nowIsoCompact() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function ensureConnected(page) {
  await page.waitForSelector('text=Create Guest Session', { timeout: 20000 });
}

async function createGuestSession(page, displayName) {
  await page.getByPlaceholder('Enter display name').fill(displayName);
  await page.getByRole('button', { name: 'Create guest session' }).click();
  await page.waitForSelector('text=Guest Session', { timeout: 20000 });
}

async function createRoom(page) {
  await page.getByRole('button', { name: 'Create room' }).click();
  await page.waitForSelector('text=Collaborative Session', { timeout: 20000 });

  const roomId = await page.locator('article:has-text("Room ID") p').nth(1).innerText();
  const shareCode = await page.locator('article:has-text("Share Code") p').nth(1).innerText();

  return { roomId: roomId.trim(), shareCode: shareCode.trim() };
}

async function joinRoom(page, shareCode) {
  await page.getByPlaceholder('Room ID or Share Code').fill(shareCode);
  await page.getByRole('button', { name: 'Join room' }).click();
  await page.waitForSelector('text=Collaborative Session', { timeout: 20000 });
}

async function createRectangleAndGetId(page) {
  await page.getByRole('button', { name: 'Rectangle (R)' }).click();

  const id = await page.evaluate(() => {
    const stage = window.Konva?.stages?.[0];
    if (!stage) return null;
    const groups = stage.find('Group').filter((g) => !!g.id());
    return groups.length ? groups[groups.length - 1].id() : null;
  });

  if (!id) {
    throw new Error('Could not resolve created rectangle id from Konva stage');
  }

  return id;
}

async function waitForObjectOnPage(page, objectId) {
  await page.waitForFunction(
    (id) => {
      const stage = window.Konva?.stages?.[0];
      if (!stage) return false;
      return stage.find('Group').some((g) => g.id() === id);
    },
    objectId,
    { timeout: 20000 }
  );
}

async function getObjectState(page, objectId) {
  return await page.evaluate((id) => {
    const stage = window.Konva?.stages?.[0];
    if (!stage) return null;
    const group = stage.find('Group').find((g) => g.id() === id);
    if (!group) return null;

    const body =
      group.find((node) => node.getClassName?.() === 'Rect' && !node.draggable?.())[0] ||
      group.find('Rect')[0] ||
      null;

    if (!body) {
      return {
        x: group.x(),
        y: group.y(),
        width: null,
        height: null,
      };
    }

    return {
      x: group.x(),
      y: group.y(),
      width: body.width(),
      height: body.height(),
    };
  }, objectId);
}

async function waitForObjectState(page, objectId, predicate, timeoutMs = 5000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const state = await getObjectState(page, objectId);
    if (state && predicate(state)) {
      return state;
    }

    await page.waitForTimeout(100);
  }

  return await getObjectState(page, objectId);
}

async function clickObjectCenter(page, objectId) {
  const point = await page.evaluate((id) => {
    const stage = window.Konva?.stages?.[0];
    if (!stage) return null;
    const group = stage.find('Group').find((g) => g.id() === id);
    if (!group) return null;

    const body =
      group.find((node) => node.getClassName?.() === 'Rect' && !node.draggable?.())[0] ||
      group.find('Rect')[0] ||
      null;
    if (!body) return null;

    const bodyRect = body.getClientRect({ relativeTo: stage });
    const stageRect = stage.content.getBoundingClientRect();
    return {
      x: stageRect.left + stage.x() + (bodyRect.x + bodyRect.width / 2) * stage.scaleX(),
      y: stageRect.top + stage.y() + (bodyRect.y + bodyRect.height / 2) * stage.scaleY(),
    };
  }, objectId);

  if (!point) {
    return false;
  }

  await page.mouse.click(point.x, point.y);
  return true;
}

async function ensureObjectSelected(page, objectId) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const clicked = await clickObjectCenter(page, objectId);
    if (!clicked) {
      continue;
    }

    const visible = await page
      .getByRole('button', { name: 'Delete selected object' })
      .isVisible()
      .catch(() => false);

    if (visible) {
      return true;
    }
  }

  return false;
}

async function runHarness() {
  const browser = await chromium.launch({ headless: true });
  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();
  const alicePage = await aliceContext.newPage();
  const bobPage = await bobContext.newPage();

  try {
    await alicePage.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await bobPage.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

    await ensureConnected(alicePage);
    await ensureConnected(bobPage);

    await createGuestSession(alicePage, 'Phase4 Harness Alice');
    await createGuestSession(bobPage, 'Phase4 Harness Bob');

    const room = await createRoom(alicePage);
    await joinRoom(bobPage, room.shareCode);

    // Browser smoke: create + select + drag + resize + export in one run
    const targetObjectId = await createRectangleAndGetId(alicePage);
    await waitForObjectOnPage(bobPage, targetObjectId);

    const selectedForDrag = await ensureObjectSelected(alicePage, targetObjectId);
    if (!selectedForDrag) {
      throw new Error('Could not reliably select target object before resize validation');
    }

    const resizeBobBefore = await getObjectState(bobPage, targetObjectId);
    const resizeResult = await runSingleUserResizeValidation(alicePage, targetObjectId);
    const expectedResizeAfter = resizeResult?.postResize?.bodyAfter || null;
    const resizeBobAfter = await waitForObjectState(
      bobPage,
      targetObjectId,
      (state) =>
        !!expectedResizeAfter &&
        typeof state.width === 'number' &&
        typeof state.height === 'number' &&
        state.width === expectedResizeAfter.width &&
        state.height === expectedResizeAfter.height,
      8000
    );

    const dragBobBefore = await getObjectState(bobPage, targetObjectId);
    const dragResult = await runSingleUserDragValidation(alicePage, targetObjectId);
    const expectedDragAfter = dragResult?.postDrag?.probe?.after || null;
    const dragBobAfter = await waitForObjectState(
      bobPage,
      targetObjectId,
      (state) =>
        !!expectedDragAfter &&
        typeof state.x === 'number' &&
        typeof state.y === 'number' &&
        state.x === expectedDragAfter.x &&
        state.y === expectedDragAfter.y,
      8000
    );

    const resizeCounts = resizeResult?.postResize?.counts || {};
    const dragProbe = dragResult?.postDrag?.probe || {};

    const smokeChecks = {
      create: !!targetObjectId,
      select: selectedForDrag,
      drag: dragProbe.dragEndCount > 0,
      resize:
        (resizeCounts['handle:dragstart'] || 0) > 0 &&
        (resizeCounts['handle:dragmove'] || 0) > 0 &&
        (resizeCounts['handle:dragend'] || 0) > 0,
      export:
        Boolean(dragResult?.postDrag?.exportedObject) &&
        Boolean(resizeResult?.postResize?.bodyAfter),
      synchronization:
        Boolean(dragBobBefore && dragBobAfter && (dragBobBefore.x !== dragBobAfter.x || dragBobBefore.y !== dragBobAfter.y)) &&
        Boolean(
          resizeBobBefore &&
            resizeBobAfter &&
            (resizeBobBefore.width !== resizeBobAfter.width || resizeBobBefore.height !== resizeBobAfter.height)
        ),
    };

    const phase4Checks = {
      browserSmoke: Object.values(smokeChecks).every(Boolean),
      twoBrowserValidation: smokeChecks.synchronization,
      realtimeSync: smokeChecks.synchronization,
      exportValidation: smokeChecks.export,
      resizeLifecycle:
        (resizeCounts['handle:mousedown'] || 0) > 0 &&
        (resizeCounts['handle:dragstart'] || 0) > 0 &&
        (resizeCounts['handle:dragmove'] || 0) > 0 &&
        (resizeCounts['handle:dragend'] || 0) > 0,
    };

    const evidence = {
      runAt: new Date().toISOString(),
      baseUrl: BASE_URL,
      room,
      objectIds: {
        targetObjectId,
      },
      smokeChecks,
      phase4Checks,
      drag: {
        bobBefore: dragBobBefore,
        bobAfter: dragBobAfter,
        probe: dragResult?.postDrag?.probe || null,
        exportedObject: dragResult?.postDrag?.exportedObject || null,
      },
      resize: {
        bobBefore: resizeBobBefore,
        bobAfter: resizeBobAfter,
        postResize: resizeResult?.postResize || null,
      },
      notes: {
        productionCodeChangedInHarnessRun: false,
      },
    };

    await fs.mkdir(EVIDENCE_DIR, { recursive: true });
    const fileName = `phase4_harness_validation_${nowIsoCompact()}.json`;
    const filePath = path.join(EVIDENCE_DIR, fileName);
    await fs.writeFile(filePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');

    return {
      ok: Object.values(phase4Checks).every(Boolean),
      filePath,
      evidence,
    };
  } finally {
    await aliceContext.close();
    await bobContext.close();
    await browser.close();
  }
}

runHarness()
  .then((result) => {
    const summary = {
      filePath: result.filePath,
      phase4Checks: result.evidence.phase4Checks,
      smokeChecks: result.evidence.smokeChecks,
    };

    console.log(JSON.stringify(summary, null, 2));

    if (!result.ok) {
      console.error('Phase 4 harness failed: one or more required checks are false.');
      process.exit(1);
    }
  })
  .catch((error) => {
    console.error('Phase 4 harness execution error');
    console.error(error?.stack || String(error));
    process.exit(1);
  });

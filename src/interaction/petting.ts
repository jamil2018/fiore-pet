import type { FioreEvent, StrokeDirection } from '../events';

const STROKE_PX = 12;
const PET_WINDOW_MS = 2000;
const STROKES_TO_PET = 3;

export interface StrokeTracker {
  enter(t: number): FioreEvent[];
  move(x: number, t: number): FioreEvent[];
  leave(t: number): FioreEvent[];
}

export function createStrokeTracker(): StrokeTracker {
  let hovering = false;
  let extreme: number | null = null;
  let direction: StrokeDirection | null = null;
  let strokeAt: number[] = [];
  let wasPetted = false;

  function resetPath(): void {
    extreme = null;
    direction = null;
    strokeAt = [];
    wasPetted = false;
  }

  function record(next: StrokeDirection, x: number, t: number): FioreEvent[] {
    direction = next;
    extreme = x;
    const events: FioreEvent[] = [{ type: 'pet.stroke', payload: { direction: next } }];
    strokeAt.push(t);
    const newest = t;
    strokeAt = strokeAt.filter((time) => newest - time <= PET_WINDOW_MS);
    if (strokeAt.length >= STROKES_TO_PET) {
      strokeAt = [];
      wasPetted = true;
      events.push({ type: 'pet.petted', payload: {} });
    }
    return events;
  }

  return {
    enter(_t) {
      if (hovering) return [];
      hovering = true;
      resetPath();
      return [{ type: 'pet.hover_start', payload: {} }];
    },
    move(x, t) {
      if (!hovering || extreme === null) {
        if (hovering) extreme = x;
        return [];
      }
      if (direction === null) {
        if (x === extreme) return [];
        direction = x > extreme ? 'right' : 'left';
        extreme = x;
        return [];
      }
      if (direction === 'right') {
        if (x >= extreme) {
          extreme = x;
          return [];
        }
        // A shorter reversal must keep the old extreme or an 11px wiggle becomes a stroke.
        if (extreme - x < STROKE_PX) return [];
        return record('left', x, t);
      }
      if (x <= extreme) {
        extreme = x;
        return [];
      }
      if (x - extreme < STROKE_PX) return [];
      return record('right', x, t);
    },
    leave(_t) {
      if (!hovering) return [];
      hovering = false;
      const petted = wasPetted;
      resetPath();
      return [{ type: 'pet.hover_end', payload: { wasPetted: petted } }];
    },
  };
}

export function createPettingDetector(
  target: HTMLElement,
  emit: (event: FioreEvent) => void,
  options: { startDragging?: () => Promise<void> } = {},
): () => void {
  const tracker = createStrokeTracker();
  let dragging = false;
  const emitAll = (events: readonly FioreEvent[]): void => {
    for (const event of events) emit(event);
  };
  const onEnter = (event: PointerEvent): void => {
    if (dragging || event.buttons) return;
    emitAll(tracker.enter(event.timeStamp));
  };
  const onMove = (event: PointerEvent): void => {
    if (dragging || event.buttons) return;
    // Native dragging may consume pointerup/enter; the first free move restores hover.
    emitAll(tracker.enter(event.timeStamp));
    emitAll(tracker.move(event.clientX, event.timeStamp));
  };
  const onLeave = (event: PointerEvent): void => {
    emitAll(tracker.leave(event.timeStamp));
  };
  const onDown = (event: PointerEvent): void => {
    if (event.button !== 0 || dragging || !options.startDragging) return;
    event.preventDefault();
    dragging = true;
    emitAll(tracker.leave(event.timeStamp));
    emit({ type: 'pet.drag_start', payload: {} });
    void (async () => {
      try {
        await options.startDragging?.();
      } catch (error: unknown) {
        console.debug('window drag failed', error);
      } finally {
        dragging = false;
        emit({ type: 'pet.drag_end', payload: {} });
      }
    })();
  };
  const onCancel = (event: PointerEvent): void => {
    emitAll(tracker.leave(event.timeStamp));
  };
  target.addEventListener('pointerenter', onEnter);
  target.addEventListener('pointermove', onMove);
  target.addEventListener('pointerleave', onLeave);
  target.addEventListener('pointerdown', onDown);
  target.addEventListener('pointercancel', onCancel);
  return () => {
    target.removeEventListener('pointerenter', onEnter);
    target.removeEventListener('pointermove', onMove);
    target.removeEventListener('pointerleave', onLeave);
    target.removeEventListener('pointerdown', onDown);
    target.removeEventListener('pointercancel', onCancel);
  };
}

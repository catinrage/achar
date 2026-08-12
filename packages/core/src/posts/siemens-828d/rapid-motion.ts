import type { Builder, GCodeWord } from '../../lib/builder';
import type { PostDefinitionApi } from '../../lib/post-definition';
import type { CommandsType, EventsType } from '../../types';
import type { SiemensPostContextState } from './context';
import { siemens828dPolicy } from './policy';
import type { SiemensPostRuntime } from './runtime';

export interface SiemensRapidMotionSettings {
  forceInitialApproachPosition: boolean;
}

function emitDeferredJobStart(
  builder: Builder,
  params: EventsType['RapidMove'],
  runtime: SiemensPostRuntime,
  settings: SiemensRapidMotionSettings,
): boolean {
  const { state } = runtime;
  if (
    !(state.deferredJobStartZ || state.lastPosition.z === undefined) ||
    params.xpos !== undefined ||
    params.ypos !== undefined ||
    params.zpos !== undefined
  ) {
    return false;
  }

  builder.Word('Z', siemens828dPolicy.formatNumber(state.currentJobStartZ));
  state.lastPosition.z = state.currentJobStartZ;
  if (settings.forceInitialApproachPosition && state.currentJob) {
    builder.Block([
      {
        letter: 'X',
        value: runtime.formatCoordinate(state.currentJob.xnext),
      },
      {
        letter: 'Y',
        value: runtime.formatCoordinate(state.currentJob.ynext),
      },
    ]);
    state.lastPosition.x = state.currentJob.xnext;
    state.lastPosition.y = state.currentJob.ynext;
    state.forceNextApproachXY = state.currentJobHadToolChange;
  }
  state.deferredJobStartZ = false;
  state.forceFeedOutput = true;
  return true;
}

function emitToolChangeApproach(
  builder: Builder,
  params: EventsType['RapidMove'] | EventsType['Move5x'],
  runtime: SiemensPostRuntime,
): boolean {
  const { state } = runtime;
  if (
    !state.pendingPathMode ||
    !state.forceNextApproachXY ||
    !state.currentJobHadToolChange ||
    (params.xpos === undefined &&
      params.ypos === undefined &&
      params.zpos === undefined)
  ) {
    return false;
  }

  // The job-start block after a tool change already positioned XY(A);
  // the approach move only descends to the clearance Z.
  if (params.zpos !== undefined) {
    builder.RapidResolved({
      z: runtime.compactCoordinate(params.zpos),
    });
  }
  runtime.updateLastPosition(params);
  state.forceNextApproachXY = false;
  state.deferredJobStartZ = false;
  state.forceFeedOutput = true;
  return true;
}

function shouldEmitInitialApproach(state: SiemensPostContextState): boolean {
  return (
    state.pendingPathMode &&
    state.forceNextApproachXY &&
    !state.currentJobHadToolChange
  );
}

function initialRapidWords(
  params: EventsType['RapidMove'],
  runtime: SiemensPostRuntime,
): GCodeWord[] {
  return [
    params.xpos !== undefined
      ? { letter: 'X' as const, value: runtime.formatCoordinate(params.xpos) }
      : undefined,
    params.ypos !== undefined
      ? { letter: 'Y' as const, value: runtime.formatCoordinate(params.ypos) }
      : undefined,
  ].filter((word) => word !== undefined) as GCodeWord[];
}

function emitInitialRapidPosition(
  builder: Builder,
  params: EventsType['RapidMove'],
  runtime: SiemensPostRuntime,
  words: GCodeWord[],
): void {
  if (words.length > 0) {
    builder.Block(words);
  }
  if (params.zpos !== undefined) {
    builder.Word('Z', runtime.formatCoordinate(params.zpos));
  }
}

function emitConfiguredInitialPosition(
  builder: Builder,
  params: EventsType['RapidMove'],
  runtime: SiemensPostRuntime,
  settings: SiemensRapidMotionSettings,
  words: GCodeWord[],
): void {
  const { state } = runtime;
  if (
    words.length > 0 ||
    !settings.forceInitialApproachPosition ||
    params.zpos === undefined ||
    !state.currentJob
  ) {
    return;
  }
  builder.Block([
    {
      letter: 'X',
      value: runtime.formatCoordinate(state.currentJob.xnext),
    },
    {
      letter: 'Y',
      value: runtime.formatCoordinate(state.currentJob.ynext),
    },
  ]);
}

function emitInitialRapidApproach(
  builder: Builder,
  params: EventsType['RapidMove'],
  runtime: SiemensPostRuntime,
  settings: SiemensRapidMotionSettings,
): boolean {
  const { state } = runtime;
  if (!shouldEmitInitialApproach(state)) return false;

  const words = initialRapidWords(params, runtime);
  emitInitialRapidPosition(builder, params, runtime, words);
  emitConfiguredInitialPosition(builder, params, runtime, settings, words);
  runtime.updateLastPosition(params);
  if (words.length > 0 || settings.forceInitialApproachPosition) {
    state.forceNextApproachXY = false;
  }
  state.deferredJobStartZ = false;
  state.forceFeedOutput = true;
  return true;
}

function coordinateChanged(
  params: object,
  key: string,
  current: number | undefined,
  previous: number | undefined,
  same: (left: number | undefined, right: number | undefined) => boolean,
): boolean {
  const changed = siemens828dPolicy.traceChanged(params, key);
  return changed === true || (changed !== false && !same(current, previous));
}

function changedCoordinate(
  params: object,
  key: string,
  current: number | undefined,
  previous: number | undefined,
  same: (left: number | undefined, right: number | undefined) => boolean,
  runtime: SiemensPostRuntime,
): number | undefined {
  return coordinateChanged(params, key, current, previous, same)
    ? runtime.compactCoordinate(current)
    : undefined;
}

function rapidCoordinates(
  params: EventsType['RapidMove'],
  runtime: SiemensPostRuntime,
): CommandsType['Rapid'] {
  const { state } = runtime;
  return {
    x: changedCoordinate(
      params,
      'xpos',
      params.xpos,
      state.lastPosition.x,
      siemens828dPolicy.sameNumber,
      runtime,
    ),
    y: changedCoordinate(
      params,
      'ypos',
      params.ypos,
      state.lastPosition.y,
      siemens828dPolicy.sameNumber,
      runtime,
    ),
    z: changedCoordinate(
      params,
      'zpos',
      params.zpos,
      state.lastPosition.z,
      siemens828dPolicy.sameNumber,
      runtime,
    ),
  };
}

function emitPendingRapidZ(
  builder: Builder,
  params: EventsType['RapidMove'],
  coords: CommandsType['Rapid'],
  runtime: SiemensPostRuntime,
): boolean {
  const { state } = runtime;
  if (
    !state.pendingPathMode ||
    coords.x !== undefined ||
    coords.y !== undefined ||
    (coords.z !== undefined && !state.deferredJobStartZ) ||
    params.zpos === undefined
  ) {
    return false;
  }

  builder.Word('Z', siemens828dPolicy.formatNumber(params.zpos));
  runtime.updateLastPosition(params);
  state.deferredJobStartZ = false;
  state.forceFeedOutput = true;
  return true;
}

function rapidMove(
  builder: Builder,
  params: EventsType['RapidMove'],
  runtime: SiemensPostRuntime,
  settings: SiemensRapidMotionSettings,
): void {
  if (emitDeferredJobStart(builder, params, runtime, settings)) return;
  if (emitToolChangeApproach(builder, params, runtime)) return;
  if (emitInitialRapidApproach(builder, params, runtime, settings)) return;

  const coords = rapidCoordinates(params, runtime);
  if (emitPendingRapidZ(builder, params, coords, runtime)) return;

  builder.RapidResolved(coords);
  runtime.updateLastPosition(params);
  runtime.state.deferredJobStartZ = false;
  runtime.state.forceFeedOutput = true;
}

function approachCoordinateChanged(
  params: EventsType['Move5x'],
  key: string,
  current: number | undefined,
  previous: number | undefined,
  state: SiemensPostContextState,
): boolean {
  return state.currentJob && !siemens828dPolicy.isDrillJob(state.currentJob)
    ? (siemens828dPolicy.traceChanged(params, key) ??
        !siemens828dPolicy.sameNumber(current, previous))
    : !siemens828dPolicy.sameNumber(current, previous);
}

function initialLinearApproachWord(
  letter: 'X' | 'Y',
  key: 'xpos' | 'ypos',
  current: number | undefined,
  previous: number | undefined,
  params: EventsType['Move5x'],
  runtime: SiemensPostRuntime,
): GCodeWord | undefined {
  if (
    current === undefined ||
    !approachCoordinateChanged(params, key, current, previous, runtime.state)
  ) {
    return undefined;
  }
  return { letter, value: runtime.formatCoordinate(current) };
}

function initialRotaryApproachWord(
  params: EventsType['Move5x'],
  runtime: SiemensPostRuntime,
): GCodeWord | undefined {
  const { state } = runtime;
  if (
    params.apos === undefined ||
    state.currentJob?.used_in_transform_4x ||
    !approachCoordinateChanged(
      params,
      'apos',
      params.apos,
      state.lastPosition.a,
      state,
    )
  ) {
    return undefined;
  }
  return {
    letter: 'A',
    value: siemens828dPolicy.formatRotary(
      runtime.compactCoordinate(params.apos) ?? params.apos,
    ),
  };
}

function initialFiveAxisWords(
  params: EventsType['Move5x'],
  runtime: SiemensPostRuntime,
): GCodeWord[] {
  return [
    initialLinearApproachWord(
      'X',
      'xpos',
      params.xpos,
      runtime.state.lastPosition.x,
      params,
      runtime,
    ),
    initialLinearApproachWord(
      'Y',
      'ypos',
      params.ypos,
      runtime.state.lastPosition.y,
      params,
      runtime,
    ),
    initialRotaryApproachWord(params, runtime),
  ].filter((word) => word !== undefined) as GCodeWord[];
}

function appendStandaloneApproachZ(
  words: GCodeWord[],
  params: EventsType['Move5x'],
  runtime: SiemensPostRuntime,
  hasPlanarPosition: boolean,
): void {
  if (
    params.zpos === undefined ||
    params.apos === undefined ||
    hasPlanarPosition
  ) {
    return;
  }
  words.push({
    letter: 'Z',
    value: runtime.formatCoordinate(params.zpos),
  });
}

function emitFiveAxisApproachPosition(
  builder: Builder,
  words: GCodeWord[],
  params: EventsType['Move5x'],
  runtime: SiemensPostRuntime,
  hasPlanarPosition: boolean,
): void {
  if (words.length > 0) {
    builder.Block(words);
  }
  if (
    params.zpos !== undefined &&
    (hasPlanarPosition || params.apos === undefined)
  ) {
    builder.Word('Z', runtime.formatCoordinate(params.zpos));
  }
}

function emitInitialFiveAxisApproach(
  builder: Builder,
  params: EventsType['Move5x'],
  runtime: SiemensPostRuntime,
): boolean {
  const { state } = runtime;
  if (!shouldEmitInitialApproach(state)) return false;

  // Drill jobs already emitted their position in the job-start block, so
  // the approach repeat only re-emits coordinates that actually moved.
  // Other jobs repeat every coordinate the trace flags as changed.
  const words = initialFiveAxisWords(params, runtime);
  const hasPlanarPosition =
    params.xpos !== undefined || params.ypos !== undefined;
  appendStandaloneApproachZ(words, params, runtime, hasPlanarPosition);
  emitFiveAxisApproachPosition(
    builder,
    words,
    params,
    runtime,
    hasPlanarPosition,
  );

  runtime.updateLastPosition(params);
  state.forceNextApproachXY = false;
  state.forceFeedOutput = true;
  return true;
}

function fiveAxisCoordinates(
  params: EventsType['Move5x'],
  runtime: SiemensPostRuntime,
): CommandsType['Rapid'] {
  const { state } = runtime;
  return {
    x: changedCoordinate(
      params,
      'xpos',
      params.xpos,
      state.lastPosition.x,
      siemens828dPolicy.sameRapidNumber,
      runtime,
    ),
    y: changedCoordinate(
      params,
      'ypos',
      params.ypos,
      state.lastPosition.y,
      siemens828dPolicy.sameRapidNumber,
      runtime,
    ),
    z: changedCoordinate(
      params,
      'zpos',
      params.zpos,
      state.lastPosition.z,
      siemens828dPolicy.sameNumber,
      runtime,
    ),
    a: changedCoordinate(
      params,
      'apos',
      params.apos,
      state.lastPosition.a,
      siemens828dPolicy.sameNumber,
      runtime,
    ),
  };
}

function emitDeferredFiveAxisZ(
  builder: Builder,
  coords: CommandsType['Rapid'],
  runtime: SiemensPostRuntime,
): boolean {
  if (!runtime.state.deferredJobStartZ || coords.z === undefined) return false;
  builder.Word('Z', siemens828dPolicy.formatNumber(coords.z));
  runtime.state.deferredJobStartZ = false;
  return true;
}

function emitRotaryAndZ(
  builder: Builder,
  coords: CommandsType['Rapid'],
  runtime: SiemensPostRuntime,
): boolean {
  if (
    coords.z === undefined ||
    coords.a === undefined ||
    coords.x !== undefined ||
    coords.y !== undefined
  ) {
    return false;
  }
  builder.Rapid({}, { skipNewLine: true });
  builder.Word('A', siemens828dPolicy.formatRotary(coords.a), {
    skipNewLine: true,
  });
  builder.Word('Z', runtime.formatCoordinate(coords.z));
  return true;
}

function emitCombinedPositionAndZ(
  builder: Builder,
  coords: CommandsType['Rapid'],
  runtime: SiemensPostRuntime,
): boolean {
  if (
    coords.z === undefined ||
    (coords.x === undefined && coords.y === undefined && coords.a === undefined)
  ) {
    return false;
  }
  builder.RapidResolved({ ...coords, z: undefined });
  builder.Word('Z', runtime.formatCoordinate(coords.z));
  return true;
}

function emitFiveAxisRapid(
  builder: Builder,
  coords: CommandsType['Rapid'],
  runtime: SiemensPostRuntime,
): void {
  if (emitDeferredFiveAxisZ(builder, coords, runtime)) return;
  if (emitRotaryAndZ(builder, coords, runtime)) return;
  if (emitCombinedPositionAndZ(builder, coords, runtime)) return;
  builder.RapidResolved(coords);
}

function moveFiveAxis(
  builder: Builder,
  params: EventsType['Move5x'],
  runtime: SiemensPostRuntime,
): void {
  if (emitInitialFiveAxisApproach(builder, params, runtime)) return;
  if (emitToolChangeApproach(builder, params, runtime)) return;

  emitFiveAxisRapid(builder, fiveAxisCoordinates(params, runtime), runtime);
  runtime.updateLastPosition(params);
  runtime.state.forceFeedOutput = true;
}

export function registerRapidMotionHandlers(
  post: PostDefinitionApi<SiemensPostContextState>,
  runtime: SiemensPostRuntime,
  settings: SiemensRapidMotionSettings,
): void {
  post.on('RapidMove', (builder, params) => {
    rapidMove(builder, params, runtime, settings);
  });
  post.on('Move5x', (builder, params) => {
    moveFiveAxis(builder, params, runtime);
  });
}

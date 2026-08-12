import type { Builder } from '../../lib/builder';
import type { EventsType } from '../../types';
import type { SiemensPostContextState } from './context';
import { type Siemens828dDriver, siemens828dDriver } from './driver';
import { siemens828dPolicy } from './policy';

export interface SiemensPostRuntimeOptions {
  callMode: 'call' | 'extcall';
  compactCoordinates: boolean;
  dwellAfterCoolantOn: boolean;
}

export interface SiemensPosition {
  xpos?: number;
  ypos?: number;
  zpos?: number;
  apos?: number;
}

export interface SiemensPostRuntime {
  state: SiemensPostContextState;
  controller(builder: Builder): Siemens828dDriver;
  compactCoordinate(value: number | undefined): number | undefined;
  formatCoordinate(value: number): string;
  changedOrDifferent(
    params: object,
    key: string,
    current: number | undefined,
    previous: number | undefined,
  ): boolean;
  updateLastPosition(params: SiemensPosition): void;
  emitCoolantOn(builder: Builder): void;
  emitPathMode(builder: Builder): void;
  callSubprogram(builder: Builder, file: string): void;
}

export function createSiemensPostRuntime(
  state: SiemensPostContextState,
  options: SiemensPostRuntimeOptions,
): SiemensPostRuntime {
  const controller = (builder: Builder) => builder.driver(siemens828dDriver);

  const compactCoordinate = (value: number | undefined): number | undefined => {
    if (value === undefined || !options.compactCoordinates) return value;
    return Number(siemens828dPolicy.formatNumber(value));
  };

  const formatCoordinate = (value: number): string =>
    siemens828dPolicy.formatNumber(compactCoordinate(value) ?? value);

  const changedOrDifferent = (
    params: object,
    key: string,
    current: number | undefined,
    previous: number | undefined,
  ): boolean =>
    siemens828dPolicy.traceChanged(params, key) ??
    !siemens828dPolicy.sameNumber(current, previous);

  const updateLastPosition = (params: SiemensPosition): void => {
    if (params.xpos !== undefined) state.lastPosition.x = params.xpos;
    if (params.ypos !== undefined) state.lastPosition.y = params.ypos;
    if (params.zpos !== undefined) state.lastPosition.z = params.zpos;
    if (params.apos !== undefined) state.lastPosition.a = params.apos;
  };

  const emitCoolantOn = (builder: Builder): void => {
    controller(builder).CoolantOn();
    if (options.dwellAfterCoolantOn) {
      controller(builder).Dwell(2);
    }
  };

  const emitPathMode = (builder: Builder): void => {
    if (!state.pendingPathMode) return;

    if (!state.emittedCpmForJob) {
      if (state.currentJobFloodCoolant === 'on' && !state.coolantActive) {
        emitCoolantOn(builder);
        state.coolantActive = true;
      }
      controller(builder).PathMode(
        state.currentPathMode,
        state.currentSoftMode,
      );
      state.emittedCpmForJob = true;
    }
    state.pendingPathMode = false;
  };

  const callSubprogram = (builder: Builder, file: string): void => {
    if (options.callMode === 'extcall') {
      builder.ExtCall(file);
    } else {
      builder.Call(file);
    }
  };

  return {
    state,
    controller,
    compactCoordinate,
    formatCoordinate,
    changedOrDifferent,
    updateLastPosition,
    emitCoolantOn,
    emitPathMode,
    callSubprogram,
  };
}

export function lineCoordinates(
  runtime: SiemensPostRuntime,
  params: EventsType['Line'] | EventsType['Line5x'],
) {
  const coords: {
    x?: number;
    y?: number;
    z?: number;
    a?: number;
  } = {};
  const { state } = runtime;

  if (
    runtime.changedOrDifferent(
      params,
      'xpos',
      params.xpos,
      state.lastPosition.x,
    )
  ) {
    coords.x = runtime.compactCoordinate(params.xpos);
  }
  if (
    runtime.changedOrDifferent(
      params,
      'ypos',
      params.ypos,
      state.lastPosition.y,
    )
  ) {
    coords.y = runtime.compactCoordinate(params.ypos);
  }
  if (
    runtime.changedOrDifferent(
      params,
      'zpos',
      params.zpos,
      state.lastPosition.z,
    )
  ) {
    coords.z = runtime.compactCoordinate(params.zpos);
  }
  if (
    'apos' in params &&
    params.apos !== undefined &&
    runtime.changedOrDifferent(
      params,
      'apos',
      params.apos,
      state.lastPosition.a,
    )
  ) {
    coords.a = runtime.compactCoordinate(params.apos);
  }
  return coords;
}

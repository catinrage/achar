import { DirectionEnum } from '../../common/enums';
import type { Builder } from '../../lib/builder';
import type { PostDefinitionApi } from '../../lib/post-definition';
import type { SiemensPostContextState } from './context';
import type { Siemens828dDriver } from './driver';

export interface SiemensDrillingDependencies {
  post: PostDefinitionApi<SiemensPostContextState>;
  state: SiemensPostContextState;
  controller: (builder: Builder) => Siemens828dDriver;
  coolantOn: (builder: Builder) => void;
  formatCoordinate: (value: number) => string;
  formatRotary: (value: number) => string;
  sameNumber: (left: number | undefined, right: number | undefined) => boolean;
  traceChanged: (params: object, key: string) => boolean | undefined;
  updateLastPosition: (params: {
    xpos?: number;
    ypos?: number;
    zpos?: number;
    apos?: number;
  }) => void;
}

export function registerDrillingHandlers({
  post,
  state,
  controller,
  coolantOn,
  formatCoordinate,
  formatRotary,
  sameNumber,
  traceChanged,
  updateLastPosition,
}: SiemensDrillingDependencies): void {
  post.on('Drill', ($, params) => {
    state.currentDrill = params;
    if (params.drill_cycle_name !== 'CYCLE84') {
      $.SetSpindleSpeed(Math.round(params.spin));
      $.SetSpindleDirection(
        params.drill_type === 3 ? DirectionEnum.CCW : DirectionEnum.CW,
      );
    }
    if (
      state.machineProfile?.features?.drillApproachZBeforeCoolant === true &&
      (traceChanged(params, 'zpos') === true ||
        !sameNumber(params.zpos, state.lastPosition.z))
    ) {
      $.Word('Z', formatCoordinate(params.zpos));
      state.lastPosition.z = params.zpos;
    }
    if (
      state.machineProfile?.features?.retainCoolantAcrossJobs !== true ||
      !state.coolantActive
    ) {
      coolantOn($);
      state.coolantActive = true;
    }
    if (params.drill_cycle_name === 'CYCLE84') {
      $.SetSpindleSpeed(100, { forcePrint: true, skipNewLine: true });
      $.SetSpindleDirection(DirectionEnum.CW, { forcePrint: true });
    }
  });

  post.on('DrillPoint', ($, params) => {
    if (!state.currentDrill || !state.currentJob) return;

    $.Block([
      'G0',
      !sameNumber(params.xpos, state.lastPosition.x)
        ? { letter: 'X', value: formatCoordinate(params.xpos) }
        : undefined,
      !sameNumber(params.ypos, state.lastPosition.y)
        ? { letter: 'Y', value: formatCoordinate(params.ypos) }
        : undefined,
      state.numberOfAxes !== 3 &&
      params.apos !== undefined &&
      !sameNumber(params.apos, state.lastPosition.a)
        ? { letter: 'A', value: formatRotary(params.apos) }
        : undefined,
    ]);
    $.SetFeedRate(state.currentDrill.feed, { forcePrint: true });
    controller($).DrillCycle(state.currentDrill, {
      clearance: state.currentJobClearance,
      upper: state.currentJobUpper,
      safety: state.currentJobSafety,
      job: state.currentJob,
      toolDiameter: state.currentToolDiameter,
      cycle81Dtb: state.currentJobCycle81Dtb,
      cycle85Dtb: state.currentJobCycle85Dtb,
      cycle85RetractFactor: state.currentJobCycle85RetractFactor,
    });
    updateLastPosition(params);
  });

  post.on('EndDrill', () => {
    state.currentDrill = null;
  });
}

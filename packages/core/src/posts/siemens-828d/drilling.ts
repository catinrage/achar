import { DirectionEnum } from '../../common/enums';
import type { PostDefinitionApi } from '../../lib/post-definition';
import type { SiemensPostContextState } from './context';
import { siemens828dPolicy } from './policy';
import type { SiemensPostRuntime } from './runtime';

export function registerDrillingHandlers(
  post: PostDefinitionApi<SiemensPostContextState>,
  runtime: SiemensPostRuntime,
): void {
  const {
    state,
    controller,
    emitCoolantOn,
    formatCoordinate,
    updateLastPosition,
  } = runtime;
  const { formatRotary, sameNumber, traceChanged } = siemens828dPolicy;

  post.on('Drill', ($, params) => {
    state.currentDrill = params;
    if (params.drill_cycle_name !== 'CYCLE84') {
      $.SetSpindleSpeed(Math.round(params.spin));
      state.lastSpindleSpeed = Math.round(params.spin);
      $.SetSpindleDirection(
        params.drill_type === 3 ? DirectionEnum.CCW : DirectionEnum.CW,
      );
    }
    if (
      state.dialect.drillApproachZBeforeCoolant &&
      params.drill_cycle_name !== 'CYCLE84' &&
      (traceChanged(params, 'zpos') === true ||
        !sameNumber(params.zpos, state.lastPosition.z))
    ) {
      $.Word('Z', formatCoordinate(params.zpos));
      state.lastPosition.z = params.zpos;
    }
    if (!state.dialect.retainCoolantAcrossJobs || !state.coolantActive) {
      emitCoolantOn($);
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
    if (
      state.machine.tapCycleOptionalStop &&
      state.currentDrill.drill_cycle_name === 'CYCLE84'
    ) {
      // Tapping cycles get an optional stop immediately before the cycle
      // call on machines with this feature — no corresponding trace flag,
      // so it is machine-profile gated rather than trace-driven. This is a
      // property of the machine, not of the output convention: the same GPP
      // omits it on machines that do not want the operator check.
      $.OptionalStop();
    }
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

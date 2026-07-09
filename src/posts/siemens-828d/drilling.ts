import { DirectionEnum } from '../../common/enums';
import type { Builder } from '../../lib/builder';
import type { PostDefinitionApi } from '../../lib/post-definition';
import type { CommandsType } from '../../types';
import type { SiemensPostContextState } from './context';
import type { Siemens828dDriver } from './driver';

export interface SiemensDrillingDependencies {
  post: PostDefinitionApi<SiemensPostContextState>;
  state: SiemensPostContextState;
  controller: (builder: Builder) => Siemens828dDriver;
  coolantOn: (builder: Builder) => void;
  sameNumber: (left: number | undefined, right: number | undefined) => boolean;
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
  sameNumber,
  updateLastPosition,
}: SiemensDrillingDependencies): void {
  post.on('Drill', ($, params) => {
    state.currentDrill = params;
    $.SetSpindleSpeed(Math.round(params.spin));
    $.SetSpindleDirection(
      params.drill_type === 3 ? DirectionEnum.CCW : DirectionEnum.CW,
    );
    coolantOn($);
    state.coolantActive = true;
  });

  post.on('DrillPoint', ($, params) => {
    if (!state.currentDrill || !state.currentJob) return;

    const coords: CommandsType['Rapid'] = {};
    if (!sameNumber(params.xpos, state.lastPosition.x)) coords.x = params.xpos;
    if (!sameNumber(params.ypos, state.lastPosition.y)) coords.y = params.ypos;
    $.RapidResolved(coords, { forcePrint: true });
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

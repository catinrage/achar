import { FeedRateModeEnum, PlaneEnum } from '../../common/enums';
import type { Builder } from '../../lib/builder';
import type { MachineProfile } from '../../lib/machine-profile';
import { definePost } from '../../lib/post-definition';
import type { Program } from '../../lib/program';
import type { CommandsType } from '../../types';
import { createSiemensPostContext } from './context';
import { registerDrillingHandlers } from './drilling';
import { registerJobLifecycleHandlers } from './job-lifecycle';
import { registerIgnoredLifecycleEvents } from './lifecycle';
import { siemens828dPolicy } from './policy';
import { registerRapidMotionHandlers } from './rapid-motion';
import { createSiemensPostRuntime, lineCoordinates } from './runtime';

export interface Siemens828dPostOptions {
  callMode?: 'call' | 'extcall';
  home?: {
    x: number;
    y: number;
    z: number;
  };
  returnHome?: {
    x: number;
    y: number;
    z: number;
  };
  measureTools?: boolean;
  machineProfile?: MachineProfile;
}

export function registerSiemens828dPost(
  program: Program,
  options: Siemens828dPostOptions = {},
): void {
  const postContext = createSiemensPostContext(options.machineProfile);
  const post = definePost(program, postContext);
  registerIgnoredLifecycleEvents(post);
  const state = post.context.state;
  const toolDefinitions = post.context.state.tools;
  const callMode = options.callMode ?? 'extcall';
  const home = {
    x: options.home?.x ?? options.machineProfile?.home?.x ?? -465,
    y: options.home?.y ?? options.machineProfile?.home?.y ?? 190,
    z: options.home?.z ?? options.machineProfile?.home?.z ?? 0,
  };
  const returnHome = {
    x: options.returnHome?.x ?? options.machineProfile?.returnHome?.x ?? 260,
    y: options.returnHome?.y ?? options.machineProfile?.returnHome?.y ?? 190,
    z: options.returnHome?.z ?? options.machineProfile?.returnHome?.z ?? 0,
  };
  const measureTools =
    options.measureTools ??
    options.machineProfile?.features?.toolMeasurementProgram ??
    true;
  const deferToolMeasurementProgram =
    options.machineProfile?.features?.toolMeasurementProgramDeferred === true;
  const mainToolListComments =
    options.machineProfile?.features?.mainToolListComments === true;
  const dwellAfterCoolantOn =
    options.machineProfile?.features?.dwellAfterCoolantOn === true;
  const dwellAfterCoolantOff =
    options.machineProfile?.features?.dwellAfterCoolantOff === true;
  const cancelAirCoolantSchedule =
    options.machineProfile?.features?.cancelAirCoolantSchedule !== false;
  const forceInitialApproachPosition =
    options.machineProfile?.features?.forceInitialApproachPosition === true;
  const inlineFeedRateMode =
    options.machineProfile?.features?.inlineFeedRateMode !== false;
  const compactCoordinates =
    options.machineProfile?.features?.compactCoordinates === true;
  const lineFeedFromChangeFlag =
    options.machineProfile?.features?.lineFeedFromChangeFlag === true;

  const measurementTools: string[] = [];

  const { formatNumber, sameNumber, traceChanged } = siemens828dPolicy;
  const runtime = createSiemensPostRuntime(state, {
    callMode,
    compactCoordinates,
    dwellAfterCoolantOn,
  });
  const {
    changedOrDifferent,
    compactCoordinate,
    controller,
    emitCoolantOn,
    emitPathMode,
    updateLastPosition,
  } = runtime;

  const emitToolMeasurementProgram = ($: Builder): void => {
    $.OpenFile('Tools_Length_Measurement', 'MPF', 'append');
    measurementTools.forEach((tool, index) => {
      if (index === 0) {
        $.SelectTool(tool, { skipNewLine: true }).ChangeTool();
      } else {
        $.SelectTool(tool);
        controller($).ToolProbeCycle();
        $.OptionalStop();
        $.ChangeTool();
      }
    });
    controller($).ToolProbeCycle();
    $.ProgramEnd();
    $.BlankLine();
    $.CloseFile();
  };

  registerDrillingHandlers(post, runtime);
  registerJobLifecycleHandlers(post, runtime, {
    home,
    returnHome,
    cancelAirCoolantSchedule,
    machineProfileConfigured: options.machineProfile !== undefined,
  });
  registerRapidMotionHandlers(post, runtime, {
    forceInitialApproachPosition,
  });

  post.on('StartOfFile', ($, params) => {
    state.numberOfAxes = params.iNumberOfAixs ?? 4;
    $.BlankLine();
    $.Comment('COMPENSATION-WEAR');
    $.Comment(`Author \t\t: ${params.user_account}`);
    $.Comment('Date \t\t: POST TIME');
    $.Comment(
      `Part Name \t: ${params.part_model_name.split('\\').pop() ?? params.part_name}`,
    );
    $.Comment(
      `CAM Project Name  : ${params.part_full_name.split('\\').pop() ?? params.part_full_name}`,
    );
    $.BlankLine();
  });

  post.on('HomeNumber', (_$, params) => {
    state.currentHomeNumber = params.home_number;
  });
  post.on('ChangeTool', ($, params, metadata) => {
    state.coolantActive = false;
    state.lastToolChange = params;
    state.pendingToolChange = params;
    const nextJob = metadata.findNearestEvent('StartOfJob')?.data;
    state.pendingWearMode = nextJob?.iWBCM ?? 0;
    state.pendingWearMessage = nextJob?.sWCM_MSG ?? '';
    state.pendingWearTool = params.tool_id_string;
    if (state.pendingWearMode > 0) {
      controller($).Label('LTC');
    }
    if (state.pendingWearMode === 1 || state.pendingWearMode === 3) {
      controller($).RestoreWearReduction();
    }
  });
  post.on('ChangeRefPoint', ($, params) => {
    state.coolantActive = false;
    if (
      !params.ref_point_init &&
      (params.xhome !== 0 || params.yhome !== 0 || params.zhome !== 0)
    ) {
      controller($).Trans({
        x: params.xhome,
        y: params.yhome,
        z: params.zhome,
      });
    } else {
      controller($).Trans();
    }
  });
  post.on('Compensation', (_$, params) => {
    if (params.side === 'comp_left') {
      state.pendingCompensation = 'G41';
    } else if (params.side === 'comp_right') {
      state.pendingCompensation = 'G42';
    } else if (params.side === 'comp_off') {
      state.pendingCompensation = 'G40';
    }
  });
  post.on('FourthAxis', ($, params) => {
    if (state.currentJob?.used_in_transform_4x) return;
    const planeAngle =
      (-Math.atan2(params.normal_to_plane_y, params.normal_to_plane_z) * 180) /
      Math.PI;
    const angle =
      Math.abs(planeAngle - params.angle) <= 0.001
        ? Number(planeAngle.toFixed(4))
        : params.angle;
    $.Word('A', formatNumber(angle));
    state.lastPosition.a = angle;
  });

  post.on('DefTool', ($, params) => {
    toolDefinitions.set(params.tool_id_string, {
      diameter: params.tool_diameter,
      cornerRadius: params.corner_radius,
      lengthTolerance: params.tolerance_len,
      radiusTolerance: params.tolerance_rad,
    });

    if ((!measureTools || mainToolListComments) && !state.emittedToolList) {
      $.Comment('Tools Used In This Program :');
      state.emittedToolList = true;
    }

    if (!measureTools || mainToolListComments) {
      // The tool-list comment uses SolidCAM's short display name
      // (tool_message), not the full tool_id_string used for T="..."
      // selection elsewhere; the two diverge whenever the tool name
      // carries a length/variant suffix (e.g. id 'END12Z4L' vs
      // message 'END12Z4').
      $.Comment(
        `T${params.tool_number}-${params.tool_message ?? params.tool_id_string}`,
      );
    }

    if (measureTools && deferToolMeasurementProgram) {
      measurementTools.push(params.tool_id_string);
      return;
    }

    if (measureTools) {
      $.OpenFile('Tools_Length_Measurement', 'MPF', 'append');

      if (state.toolIndex === 0) {
        $.SelectTool(params.tool_id_string, { skipNewLine: true }).ChangeTool();
      } else {
        $.SelectTool(params.tool_id_string);
        controller($).ToolProbeCycle();
        $.OptionalStop();
        $.ChangeTool();
      }

      state.toolIndex++;
      $.CloseFile();
    }
  });

  post.on('StartProgram', ($, params, metadata) => {
    if (mainToolListComments && state.emittedToolList) {
      $.BlankLine();
    }

    if (measureTools && !deferToolMeasurementProgram) {
      $.OpenFile('Tools_Length_Measurement', 'MPF', 'append');
      controller($).ToolProbeCycle();
      $.ProgramEnd();
      $.BlankLine();
      $.CloseFile();
    }

    controller($)
      .DeclareReal('_camtolerance')
      .DeclareReal('_X_HOME', '_Y_HOME', '_Z_HOME')
      .DeclareReal('ToolWearBuffer')
      .DeclareBool('WearChanged')
      .Separator()
      .SetVariables({
        _X_HOME: home.x,
        _Y_HOME: home.y,
        _Z_HOME: home.z,
      })
      .SetVariable('WearChanged', false, { spaced: true })
      .Separator();

    const startOfFile = metadata.findLastEvent('StartOfFile')?.data;
    if (startOfFile?.inch_system) {
      $.UseInches({ skipNewLine: true });
    } else {
      $.UseMillimeters({ skipNewLine: true });
    }
    $.SetFeedRateMode(FeedRateModeEnum.UNITS_PER_MINUTE, {
      skipNewLine: true,
    });
    $.SetAbsoluteMode({ skipNewLine: true });
    $.SetMachinePlane(
      metadata.findLastEvent('MachinePlane')?.data.machine_plane ??
        PlaneEnum.XY,
    );

    void params;
  });

  post.on('MFeedSpin', ($, params) => {
    $.SetSpindleSpeed(Math.round(params.spin), { forcePrint: true });
    state.lastSpindleSpeed = Math.round(params.spin);
    $.SetSpindleDirection(params.spin_direction, { forcePrint: true });
  });

  post.on('Message', ($, params) => {
    $.Comment(params.message);
  });

  post.on('Line', ($, params) => {
    const forceFeedMode =
      inlineFeedRateMode &&
      state.pendingPathMode &&
      !state.jobFeedModeEstablished;
    const forceFeed =
      (state.pendingPathMode && !state.emittedCpmForJob) ||
      state.forceFeedOutput ||
      // The two legacy GPPs disagree here. The PoyaKar post prints F from
      // GPP's raw change(feed) bit (the trace's feed__changed flag), which
      // can be true with a numerically unchanged value — e.g. after
      // m_feed_spin touches the shared feed variable. The Siemens 4A post
      // instead overrides that bit with its own `feed ne prevFeed`
      // comparison, so only the numeric fallback applies there.
      (lineFeedFromChangeFlag && traceChanged(params, 'feed') === true) ||
      !sameNumber(params.feed, state.previousLineFeed);
    emitPathMode($);

    const coords = lineCoordinates(runtime, params);
    if (forceFeedMode) {
      $.LineWithFeedRateMode(coords, FeedRateModeEnum.UNITS_PER_MINUTE, {
        skipNewLine: true,
      });
      state.jobFeedModeEstablished = true;
    } else if (state.pendingCompensation) {
      $.LineWithModalWords(coords, [state.pendingCompensation], {
        skipNewLine: true,
      });
      state.pendingCompensation = null;
    } else {
      $.LineResolved(coords, { skipNewLine: true });
    }
    if (forceFeed) {
      $.SetFeedRate(params.feed, { forcePrint: true });
    } else {
      $.flush();
    }
    state.previousLineFeed = params.feed;
    state.deferredJobStartZ = false;
    state.forceFeedOutput = false;
    updateLastPosition(params);
  });

  post.on('Line5x', ($, params) => {
    const forceFeed =
      (state.pendingPathMode && !state.emittedCpmForJob) ||
      state.forceFeedOutput ||
      !sameNumber(params.feed, state.previousLineFeed);
    emitPathMode($);

    const coords = lineCoordinates(runtime, params);
    $.LineResolved(coords, { skipNewLine: true });
    if (forceFeed) {
      $.SetFeedRate(params.feed, { forcePrint: true });
    } else {
      $.flush();
    }
    state.previousLineFeed = params.feed;
    state.deferredJobStartZ = false;
    state.forceFeedOutput = false;
    updateLastPosition(params);
  });

  post.on('Arc', ($, params) => {
    const forceFeed = state.pendingPathMode || state.forceFeedOutput;
    emitPathMode($);

    const direction = params.arc_direction.toLowerCase().startsWith('ccw')
      ? 3
      : 2;
    const coords: CommandsType['Line'] = {
      x: compactCoordinate(params.xpos),
      y: compactCoordinate(params.ypos),
    };
    if (changedOrDifferent(params, 'zpos', params.zpos, state.lastPosition.z)) {
      coords.z = compactCoordinate(params.zpos);
    }

    $.CircularResolved(direction, coords, { skipNewLine: true });
    $.Block(
      [
        {
          letter: 'I',
          value: params.xcenter_rel
            .toFixed(4)
            .replace(/0+$/, '')
            .replace(/\.$/, ''),
        },
        {
          letter: 'J',
          value: params.ycenter_rel
            .toFixed(4)
            .replace(/0+$/, '')
            .replace(/\.$/, ''),
        },
      ],
      { skipNewLine: true },
    );
    if (forceFeed || traceChanged(params, 'feed') === true) {
      $.SetFeedRate(params.feed, { forcePrint: true });
    } else {
      $.flush();
    }
    if (options.machineProfile?.features?.trackArcFeedRate === true) {
      state.previousLineFeed = params.feed;
    }
    state.deferredJobStartZ = false;
    state.forceFeedOutput = false;
    updateLastPosition(params);
  });

  post.on('ToolPathInfo', ($, params) => {
    if (params.tool_path_type === 'start_cut') {
      emitCoolantOn($);
      controller($).PathMode(state.currentPathMode, state.currentSoftMode);
    }
    if (params.tool_path_type === 'start_approach') {
      state.pendingPathMode = true;
    }
  });

  post.on('EndProgram', ($) => {
    controller($).CoolantOff();
    if (dwellAfterCoolantOff) {
      controller($).Dwell(2);
    }
    $.NumberedBlankLine();
    controller($)
      .SpindleStop()
      .SupaRapid({ z: returnHome.z })
      .SupaRapid({ x: returnHome.x, y: returnHome.y });
    $.ProgramEnd();
    $.BlankLine();
    if (measureTools && deferToolMeasurementProgram) {
      emitToolMeasurementProgram($);
    }
  });
}

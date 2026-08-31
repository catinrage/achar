import { FeedRateModeEnum, PlaneEnum } from '../../common/enums';
import type { Builder } from '../../lib/builder';
import type { MachineProfile } from '../../lib/machine-profile';
import { definePost } from '../../lib/post-definition';
import type { Program } from '../../lib/program';
import type { CommandsType } from '../../types';
import { createSiemensPostContext } from './context';
import { resolveSiemens828dDialect } from './dialect';
import { registerDrillingHandlers } from './drilling';
import { registerJobLifecycleHandlers } from './job-lifecycle';
import { registerIgnoredLifecycleEvents } from './lifecycle';
import { resolveSiemens828dMachine } from './machine';
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
  /**
   * Overrides the dialect the machine profile names. Mainly for parity runs
   * that need to post one trace both ways; production callers name the
   * dialect on the profile so it travels with the machine.
   */
  dialect?: string;
}

export function registerSiemens828dPost(
  program: Program,
  options: Siemens828dPostOptions = {},
): void {
  const dialect = resolveSiemens828dDialect(
    options.dialect ?? options.machineProfile?.dialect,
  );
  const machine = resolveSiemens828dMachine(options.machineProfile, {
    home: options.home,
    returnHome: options.returnHome,
    measureTools: options.measureTools,
  });
  const postContext = createSiemensPostContext(
    options.machineProfile,
    dialect,
    machine,
  );
  const post = definePost(program, postContext);
  registerIgnoredLifecycleEvents(post);
  const state = post.context.state;
  const toolDefinitions = post.context.state.tools;
  const callMode = options.callMode ?? 'extcall';
  // Both `machine` and `dialect` arrive fully resolved: what this machine is,
  // and how its G-code is written. Nothing below re-decides a default.
  const { home, measureTools, returnHome, toolChangePark } = machine;

  const measurementTools: string[] = [];

  const { formatNumber, sameNumber, traceChanged } = siemens828dPolicy;
  const runtime = createSiemensPostRuntime(state, {
    callMode,
    compactCoordinates: dialect.compactCoordinates,
    dwellAfterCoolantOn: machine.dwellAfterCoolantOn,
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
    toolChangePark,
    cancelAirCoolantSchedule: dialect.cancelAirCoolantSchedule,
    startPositionRequiresToolChange: dialect.startPositionRequiresToolChange,
  });
  registerRapidMotionHandlers(post, runtime, {
    forceInitialApproachPosition: dialect.forceInitialApproachPosition,
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
    state.lastToolChange = params;
    state.pendingToolChange = params;
    const nextJob = metadata.findNearestEvent('StartOfJob')?.data;
    // Latch where this change will rapid to. Legacy reads the upcoming job's
    // start position here, and every tool-change block emitted afterwards
    // uses it — including a rotary pattern's later instances, which announce
    // no change of their own.
    if (nextJob) {
      state.toolChangePosition = {
        x: nextJob.xnext,
        y: nextJob.ynext,
        a: nextJob.anext,
      };
    }
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

    if (
      (!measureTools || dialect.mainToolListComments) &&
      !state.emittedToolList
    ) {
      $.Comment('Tools Used In This Program :');
      state.emittedToolList = true;
    }

    if (!measureTools || dialect.mainToolListComments) {
      // The tool-list comment uses SolidCAM's short display name
      // (tool_message), not the full tool_id_string used for T="..."
      // selection elsewhere; the two diverge whenever the tool name
      // carries a length/variant suffix (e.g. id 'END12Z4L' vs
      // message 'END12Z4').
      $.Comment(
        `T${params.tool_number}-${params.tool_message ?? params.tool_id_string}`,
      );
    }

    if (measureTools && dialect.toolMeasurementProgramDeferred) {
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
    if (dialect.mainToolListComments && state.emittedToolList) {
      $.BlankLine();
    }

    if (measureTools && !dialect.toolMeasurementProgramDeferred) {
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
      dialect.inlineFeedRateMode &&
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
      (dialect.lineFeedFromChangeFlag &&
        traceChanged(params, 'feed') === true) ||
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
    if (dialect.trackArcFeedRate) {
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
    if (machine.dwellAfterCoolantOff) {
      controller($).Dwell(2);
    }
    $.NumberedBlankLine();
    controller($)
      .SpindleStop()
      .SupaRapid({ z: returnHome.z })
      .SupaRapid({ x: returnHome.x, y: returnHome.y });
    $.ProgramEnd();
    $.BlankLine();
    if (measureTools && dialect.toolMeasurementProgramDeferred) {
      emitToolMeasurementProgram($);
    }
  });
}

import { FeedRateModeEnum, PlaneEnum } from '../../common/enums';
import type { Builder, GCodeWord } from '../../lib/builder';
import type { MachineProfile } from '../../lib/machine-profile';
import { definePost } from '../../lib/post-definition';
import type { Program } from '../../lib/program';
import type { CommandsType, EventsType } from '../../types';
import { createSiemensPostContext } from './context';
import { registerDrillingHandlers } from './drilling';
import { siemens828dDriver } from './driver';
import { registerIgnoredLifecycleEvents } from './lifecycle';
import { siemens828dPolicy } from './policy';

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

  const controller = ($: Builder) => $.driver(siemens828dDriver);
  const measurementTools: string[] = [];

  const {
    cycle832Mode,
    formatNumber,
    formatRotary,
    isDrillJob,
    jobFileName,
    sameNumber,
    sameRapidNumber,
    traceChanged,
  } = siemens828dPolicy;

  const changedOrDifferent = (
    params: object,
    key: string,
    current: number | undefined,
    previous: number | undefined,
  ): boolean => traceChanged(params, key) ?? !sameNumber(current, previous);

  const updateCycleTolerance = (params: EventsType['StartOfJob']): number => {
    state.cutTolerance = siemens828dPolicy.cycleTolerance(
      params,
      state.cutTolerance,
    );
    return state.cutTolerance;
  };

  const compactCoordinate = (value: number | undefined): number | undefined => {
    if (value === undefined || !compactCoordinates) return value;
    return Number(formatNumber(value));
  };

  const formatCoordinate = (value: number): string => {
    return formatNumber(compactCoordinate(value) ?? value);
  };

  const callSubprogram = ($: Builder, file: string): void => {
    if (callMode === 'extcall') {
      $.ExtCall(file);
    } else {
      $.Call(file);
    }
  };

  const emitPathMode = ($: Builder): void => {
    if (!state.pendingPathMode) return;

    if (!state.emittedCpmForJob) {
      if (state.currentJobFloodCoolant === 'on' && !state.coolantActive) {
        emitCoolantOn($);
        state.coolantActive = true;
      }
      controller($).PathMode(state.currentPathMode, state.currentSoftMode);
      state.emittedCpmForJob = true;
    }
    state.pendingPathMode = false;
  };

  const emitCoolantOn = ($: Builder): void => {
    controller($).CoolantOn();
    if (dwellAfterCoolantOn) {
      controller($).Dwell(2);
    }
  };

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

  const lineCoords = (
    params: EventsType['Line'] | EventsType['Line5x'],
  ): CommandsType['Line'] => {
    const coords: CommandsType['Line'] = {};
    if (changedOrDifferent(params, 'xpos', params.xpos, state.lastPosition.x)) {
      coords.x = compactCoordinate(params.xpos);
    }
    if (changedOrDifferent(params, 'ypos', params.ypos, state.lastPosition.y)) {
      coords.y = compactCoordinate(params.ypos);
    }
    if (changedOrDifferent(params, 'zpos', params.zpos, state.lastPosition.z)) {
      coords.z = compactCoordinate(params.zpos);
    }
    if (
      'apos' in params &&
      params.apos !== undefined &&
      changedOrDifferent(params, 'apos', params.apos, state.lastPosition.a)
    ) {
      coords.a = compactCoordinate(params.apos);
    }
    return coords;
  };

  const updateLastPosition = (params: {
    xpos?: number;
    ypos?: number;
    zpos?: number;
    apos?: number;
  }): void => {
    if (params.xpos !== undefined) state.lastPosition.x = params.xpos;
    if (params.ypos !== undefined) state.lastPosition.y = params.ypos;
    if (params.zpos !== undefined) state.lastPosition.z = params.zpos;
    if (params.apos !== undefined) state.lastPosition.a = params.apos;
  };

  registerDrillingHandlers({
    post,
    state,
    controller,
    coolantOn: emitCoolantOn,
    formatCoordinate,
    formatRotary,
    sameNumber,
    traceChanged,
    updateLastPosition,
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

  post.on('StartOfJob', ($, params, metadata) => {
    const jobFile = jobFileName(params);
    const fileMode = state.jobFiles.has(jobFile) ? 'append' : 'replace';
    state.jobFiles.add(jobFile);
    $.OpenFile(jobFile, 'SPF', fileMode);
    if (fileMode === 'append') {
      $.RemoveTrailingBlankLine();
    }

    const explicitToolChange = state.pendingToolChange;
    const toolChange =
      explicitToolChange ??
      (params.used_in_transform_translate ? state.lastToolChange : null);
    state.currentJobHadToolChange = toolChange !== null;
    state.pendingToolChange = null;
    state.emittedCpmForJob = false;
    state.currentJobFloodCoolant = (
      params as EventsType['StartOfJob'] & { flood_coolant?: string }
    ).flood_coolant;
    state.currentJobCycle81Dtb = params.C81_DTB ?? 0;
    state.currentJobCycle85Dtb = params.C85_DTB ?? 0;
    state.currentJobCycle85RetractFactor = params.C85_RFF;
    state.currentJob = params;
    state.currentJobClearance = params.job_clearance_plane;
    state.currentJobUpper = params.job_upper_plane;
    state.currentJobSafety = params.safety ?? 0;
    state.currentJobStartZ = params.znext;
    state.currentJobAirCoolant = params.bAirCoolant === 1;
    state.currentPathMode = params.iCPM ?? 645;
    state.currentSoftMode = params.bSoft !== 0;
    const jobTolerance = updateCycleTolerance(params);
    state.deferredJobStartZ = !isDrillJob(params);

    controller($).DeclareReal('_camtolerance');
    if (state.currentJobAirCoolant) {
      controller($).DeclareInt('DELAY', 'DURATION');
    }
    $.BlankLine();
    controller($).Message(
      `${params.job_name} , Tool : ${toolChange?.tool_id_string ?? metadata.findLastEvent('ChangeTool')?.data.tool_id_string ?? 'UNKNOWN'}`,
    );
    $.BlankLine();
    controller($).SetVariable('_camtolerance', jobTolerance);

    if (toolChange && state.startedJob) {
      $.BlankLine();
      controller($).InitialMillModes();
      state.jobFeedModeEstablished = true;
    }

    if (toolChange) {
      const toolChangePositionMode = params.iTC_SUPA_MODE ?? 0;
      if (toolChangePositionMode !== 0) {
        controller($).ToolChangePosition(toolChangePositionMode, {
          x: params.nTC_XSUPA ?? home.x,
          y: params.nTC_YSUPA ?? home.y,
          z: returnHome.z,
        });
      }
      $.SelectTool(toolChange.tool_id_string, {
        forcePrint: true,
        skipNewLine: true,
      })
        .ChangeTool()
        .Word('D', 1);
      if (params.iM1 === 1 || params.iM1 === 2) {
        controller($).ToolChangePrompt(params.iM1, params.sM1_MSG ?? '', {
          x: params.nTC_XSUPA === 0 ? home.x : params.nTC_XSUPA,
          y: params.nTC_YSUPA === 0 ? home.y : params.nTC_YSUPA,
          z: returnHome.z,
        });
      }
      if (
        explicitToolChange &&
        !toolChange.last_tool &&
        params.next_job_tool_number !== state.previousJobToolNumber &&
        toolChange.next_tool_id_string !== state.lastPreselectedToolId
      ) {
        $.SelectTool(toolChange.next_tool_id_string);
        state.lastPreselectedToolId = toolChange.next_tool_id_string;
      }
    }

    const toolDefinition = toolChange
      ? toolDefinitions.get(toolChange.tool_id_string)
      : undefined;
    state.currentToolDiameter =
      toolDefinition?.diameter ??
      toolChange?.tool_diameter ??
      state.currentToolDiameter;
    if (toolDefinition && params.ts_mtype === 1) {
      controller($).ToolSettingLength(
        params.ts_type ?? 0,
        toolDefinition.lengthTolerance,
        toolDefinition.diameter / 2 - toolDefinition.cornerRadius,
      );
    } else if (toolDefinition && params.ts_mtype === 2) {
      controller($).ToolSettingRadius(
        params.ts_type ?? 0,
        toolDefinition.lengthTolerance,
        toolDefinition.radiusTolerance,
        toolDefinition.cornerRadius,
        toolDefinition.diameter / 2 - toolDefinition.cornerRadius,
      );
    }

    const emitStartPosition =
      toolChange !== null || options.machineProfile === undefined;
    if (emitStartPosition) {
      $.Block([
        toolChange ? `G0 G${state.currentHomeNumber} G90` : undefined,
        { letter: 'X', value: formatCoordinate(params.xnext) },
        { letter: 'Y', value: formatCoordinate(params.ynext) },
        state.numberOfAxes !== 3 &&
        !params.used_in_transform_4x &&
        params.anext !== undefined
          ? { letter: 'A', value: formatRotary(params.anext) }
          : undefined,
      ]);
      state.lastPosition = {
        x: params.xnext,
        y: params.ynext,
        a: params.used_in_transform_4x ? state.lastPosition.a : params.anext,
      };
    }
    if (toolChange) {
      state.forceNextApproachXY = true;
      $.SetSpindleSpeed(Math.round(params.spin_rate), { forcePrint: true });
      $.SetSpindleDirection(params.spin_direction, { forcePrint: true });
      $.SetSpindleDirection(params.spin_direction, { forcePrint: true });
    } else {
      state.forceNextApproachXY = true;
    }
    state.previousJobToolNumber =
      toolChange?.tool_number ?? state.lastToolChange?.tool_number;

    if (state.currentJobAirCoolant) {
      controller($).AirCoolantSchedule(
        params.nAirCoolantDelay ?? 0,
        params.nAirCoolantDuration ?? 0,
      );
    }

    if (params.b832type === 0) {
      controller($).Cycle832({ tolerance: 0, mode: '_OFF' });
      $.Rapid({}, { forcePrint: true });
    } else if (!isDrillJob(params)) {
      controller($).Cycle832({
        tolerance: '_camtolerance',
        mode: cycle832Mode(jobTolerance),
      });
      $.Rapid({}, { forcePrint: true });
    }
    $.Comment(params.job_name);
    state.pendingPathMode = true;
    state.startedJob = true;
  });

  post.on('EndOfJob', ($, _params, metadata) => {
    const startOfJob = metadata.findLastEventOrThrow('StartOfJob').data;

    if (state.currentJobAirCoolant) {
      if (cancelAirCoolantSchedule) {
        controller($).Cancel(1).Cancel(2).Cancel(3).CoolantOff();
      } else {
        controller($).CoolantOff();
      }
      state.coolantActive = false;
    }
    controller($).Return();
    $.BlankLine();
    $.BlankLine();
    $.CloseFile();

    if (
      startOfJob.used_in_transform_4x &&
      startOfJob.anext !== undefined &&
      !sameNumber(startOfJob.anext, state.lastPosition.a)
    ) {
      $.Word('A', formatNumber(startOfJob.anext));
      state.lastPosition.a = startOfJob.anext;
    }
    callSubprogram($, `${jobFileName(startOfJob)}.SPF`);

    if (
      state.lastToolChange &&
      state.lastToolChange.tool_number !== startOfJob.next_job_tool_number &&
      state.pendingWearMode > 0
    ) {
      if (state.pendingWearMode === 2 || state.pendingWearMode === 3) {
        controller($).ToolBreakageCheck(
          state.pendingWearTool,
          state.pendingWearMessage,
        );
      }
      if (state.pendingWearMode === 1 || state.pendingWearMode === 3) {
        controller($).ToolWearCheck(
          state.pendingWearTool,
          state.pendingWearMessage,
          {
            x: startOfJob.nTC_XSUPA,
            y: startOfJob.nTC_YSUPA,
            z: returnHome.z,
          },
        );
      }
      state.pendingWearMode = 0;
    }
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
      $.Comment(`T${params.tool_number}-${params.tool_id_string}`);
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
    $.SetSpindleDirection(params.spin_direction, { forcePrint: true });
  });

  post.on('Message', ($, params) => {
    $.Comment(params.message);
  });

  post.on('RapidMove', ($, params) => {
    if (
      (state.deferredJobStartZ || state.lastPosition.z === undefined) &&
      params.xpos === undefined &&
      params.ypos === undefined &&
      params.zpos === undefined
    ) {
      $.Word('Z', formatNumber(state.currentJobStartZ));
      state.lastPosition.z = state.currentJobStartZ;
      if (forceInitialApproachPosition && state.currentJob) {
        $.Block([
          { letter: 'X', value: formatCoordinate(state.currentJob.xnext) },
          { letter: 'Y', value: formatCoordinate(state.currentJob.ynext) },
        ]);
        state.lastPosition.x = state.currentJob.xnext;
        state.lastPosition.y = state.currentJob.ynext;
        state.forceNextApproachXY = state.currentJobHadToolChange;
      }
      state.deferredJobStartZ = false;
      state.forceFeedOutput = true;
      return;
    }

    if (
      state.pendingPathMode &&
      state.forceNextApproachXY &&
      state.currentJobHadToolChange &&
      (params.xpos !== undefined ||
        params.ypos !== undefined ||
        params.zpos !== undefined)
    ) {
      if (params.zpos !== undefined) {
        $.RapidResolved({ z: compactCoordinate(params.zpos) });
      }
      updateLastPosition(params);
      state.forceNextApproachXY = false;
      state.deferredJobStartZ = false;
      state.forceFeedOutput = true;
      return;
    }

    if (
      state.pendingPathMode &&
      state.forceNextApproachXY &&
      !state.currentJobHadToolChange
    ) {
      const words = [
        params.xpos !== undefined
          ? {
              letter: 'X' as const,
              value: formatCoordinate(params.xpos),
            }
          : undefined,
        params.ypos !== undefined
          ? {
              letter: 'Y' as const,
              value: formatCoordinate(params.ypos),
            }
          : undefined,
      ].filter((word) => word !== undefined) as GCodeWord[];

      if (words.length > 0) {
        $.Block(words);
      }
      if (params.zpos !== undefined) {
        $.Word('Z', formatCoordinate(params.zpos));
      }
      if (
        words.length === 0 &&
        forceInitialApproachPosition &&
        params.zpos !== undefined &&
        state.currentJob
      ) {
        $.Block([
          { letter: 'X', value: formatCoordinate(state.currentJob.xnext) },
          { letter: 'Y', value: formatCoordinate(state.currentJob.ynext) },
        ]);
      }

      updateLastPosition(params);
      if (words.length > 0 || forceInitialApproachPosition) {
        state.forceNextApproachXY = false;
      }
      state.deferredJobStartZ = false;
      state.forceFeedOutput = true;
      return;
    }

    const coords: CommandsType['Rapid'] = {};
    const xChanged = traceChanged(params, 'xpos');
    if (xChanged !== false && !sameNumber(params.xpos, state.lastPosition.x)) {
      coords.x = compactCoordinate(params.xpos);
    }
    const yChanged = traceChanged(params, 'ypos');
    if (yChanged !== false && !sameNumber(params.ypos, state.lastPosition.y)) {
      coords.y = compactCoordinate(params.ypos);
    }
    const zChanged = traceChanged(params, 'zpos');
    if (
      zChanged === true ||
      (zChanged !== false && !sameNumber(params.zpos, state.lastPosition.z))
    ) {
      coords.z = compactCoordinate(params.zpos);
    }

    if (
      state.pendingPathMode &&
      coords.x === undefined &&
      coords.y === undefined &&
      (coords.z === undefined || state.deferredJobStartZ) &&
      params.zpos !== undefined
    ) {
      $.Word('Z', formatNumber(params.zpos));
      updateLastPosition(params);
      state.deferredJobStartZ = false;
      state.forceFeedOutput = true;
      return;
    }

    $.RapidResolved(coords);
    updateLastPosition(params);
    state.deferredJobStartZ = false;
    state.forceFeedOutput = true;
  });

  post.on('Line', ($, params) => {
    const forceFeedMode =
      inlineFeedRateMode &&
      state.pendingPathMode &&
      !state.jobFeedModeEstablished;
    const forceFeed =
      (state.pendingPathMode && !state.emittedCpmForJob) ||
      state.forceFeedOutput ||
      !sameNumber(params.feed, state.previousLineFeed);
    emitPathMode($);

    const coords = lineCoords(params);
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

  post.on('Move5x', ($, params) => {
    if (
      state.pendingPathMode &&
      state.forceNextApproachXY &&
      !state.currentJobHadToolChange
    ) {
      const words = [
        params.xpos !== undefined &&
        !sameNumber(params.xpos, state.lastPosition.x)
          ? {
              letter: 'X' as const,
              value: formatCoordinate(params.xpos),
            }
          : undefined,
        params.ypos !== undefined &&
        !sameNumber(params.ypos, state.lastPosition.y)
          ? {
              letter: 'Y' as const,
              value: formatCoordinate(params.ypos),
            }
          : undefined,
        params.apos !== undefined &&
        !sameNumber(params.apos, state.lastPosition.a)
          ? {
              letter: 'A' as const,
              value: formatRotary(
                compactCoordinate(params.apos) ?? params.apos,
              ),
            }
          : undefined,
      ].filter((word) => word !== undefined) as GCodeWord[];

      const hasPlanarPosition =
        params.xpos !== undefined || params.ypos !== undefined;
      if (
        params.zpos !== undefined &&
        params.apos !== undefined &&
        !hasPlanarPosition
      ) {
        words.push({
          letter: 'Z',
          value: formatCoordinate(params.zpos),
        });
      }

      if (words.length > 0) {
        $.Block(words);
      }
      if (
        params.zpos !== undefined &&
        (hasPlanarPosition || params.apos === undefined)
      ) {
        $.Word('Z', formatCoordinate(params.zpos));
      }

      updateLastPosition(params);
      state.forceNextApproachXY = false;
      state.forceFeedOutput = true;
      return;
    }

    const coords: CommandsType['Rapid'] = {};
    const xChanged = traceChanged(params, 'xpos');
    if (
      xChanged === true ||
      (xChanged !== false &&
        !sameRapidNumber(params.xpos, state.lastPosition.x))
    ) {
      coords.x = compactCoordinate(params.xpos);
    }
    const yChanged = traceChanged(params, 'ypos');
    if (
      yChanged === true ||
      (yChanged !== false &&
        !sameRapidNumber(params.ypos, state.lastPosition.y))
    ) {
      coords.y = compactCoordinate(params.ypos);
    }
    const zChanged = traceChanged(params, 'zpos');
    if (
      zChanged === true ||
      (zChanged !== false && !sameNumber(params.zpos, state.lastPosition.z))
    ) {
      coords.z = compactCoordinate(params.zpos);
    }
    if (!sameNumber(params.apos, state.lastPosition.a)) {
      coords.a = compactCoordinate(params.apos);
    }

    if (state.deferredJobStartZ && coords.z !== undefined) {
      $.Word('Z', formatNumber(coords.z));
      state.deferredJobStartZ = false;
    } else if (
      coords.z !== undefined &&
      coords.a !== undefined &&
      coords.x === undefined &&
      coords.y === undefined
    ) {
      $.Rapid({}, { skipNewLine: true });
      $.Word('A', formatRotary(coords.a), { skipNewLine: true });
      $.Word('Z', formatCoordinate(coords.z));
    } else if (
      coords.z !== undefined &&
      (coords.x !== undefined ||
        coords.y !== undefined ||
        coords.a !== undefined)
    ) {
      $.RapidResolved({ ...coords, z: undefined });
      $.Word('Z', formatCoordinate(coords.z));
    } else {
      $.RapidResolved(coords);
    }
    updateLastPosition(params);
    state.forceFeedOutput = true;
  });

  post.on('Line5x', ($, params) => {
    const forceFeed =
      (state.pendingPathMode && !state.emittedCpmForJob) ||
      state.forceFeedOutput ||
      !sameNumber(params.feed, state.previousLineFeed);
    emitPathMode($);

    const coords = lineCoords(params);
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

import type { Builder } from '../../lib/builder';
import type { EventListenerMetadata } from '../../lib/event';
import type { PostDefinitionApi } from '../../lib/post-definition';
import type { EventsType } from '../../types';
import type { SiemensPostContextState, SiemensToolDefinition } from './context';
import { siemens828dPolicy } from './policy';
import type { SiemensPostRuntime } from './runtime';

interface Position {
  x: number;
  y: number;
  z: number;
}

export interface SiemensJobLifecycleSettings {
  home: Position;
  returnHome: Position;
  cancelAirCoolantSchedule: boolean;
  startPositionRequiresToolChange: boolean;
}

interface JobToolChange {
  explicit: EventsType['ChangeTool'] | null;
  resolved: EventsType['ChangeTool'] | null;
}

function openJobFile(
  builder: Builder,
  state: SiemensPostContextState,
  params: EventsType['StartOfJob'],
): void {
  const jobFile = siemens828dPolicy.jobFileName(params);
  // Rotary-pattern (4x transform) repeats accumulate in one subprogram;
  // any other re-post of the same job replaces the earlier content while
  // its burned line numbers stay consumed, matching legacy GPP output.
  const fileMode =
    state.jobFiles.has(jobFile) && params.used_in_transform_4x
      ? 'append'
      : 'replace';
  state.jobFiles.add(jobFile);
  builder.OpenFile(jobFile, 'SPF', fileMode);
  if (fileMode === 'append') {
    builder.RemoveTrailingBlankLine();
  }
}

function resolveJobToolChange(
  state: SiemensPostContextState,
  params: EventsType['StartOfJob'],
): JobToolChange {
  const explicit = state.pendingToolChange;
  const resolved =
    explicit ??
    (params.used_in_transform_translate ? state.lastToolChange : null);
  return { explicit, resolved };
}

function initializeJobState(
  state: SiemensPostContextState,
  params: EventsType['StartOfJob'],
  toolChange: EventsType['ChangeTool'] | null,
): number {
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
  state.cutTolerance = siemens828dPolicy.cycleTolerance(
    params,
    state.cutTolerance,
  );
  state.deferredJobStartZ = !siemens828dPolicy.isDrillJob(params);
  return state.cutTolerance;
}

function emitJobHeader(
  builder: Builder,
  runtime: SiemensPostRuntime,
  params: EventsType['StartOfJob'],
  metadata: EventListenerMetadata,
  toolChange: EventsType['ChangeTool'] | null,
  jobTolerance: number,
): void {
  runtime.controller(builder).DeclareReal('_camtolerance');
  if (runtime.state.currentJobAirCoolant) {
    runtime.controller(builder).DeclareInt('DELAY', 'DURATION');
  }
  builder.BlankLine();
  runtime
    .controller(builder)
    .Message(
      `${params.job_name} , Tool : ${toolChange?.tool_id_string ?? metadata.findLastEvent('ChangeTool')?.data.tool_id_string ?? 'UNKNOWN'}`,
    );
  builder.BlankLine();
  runtime.controller(builder).SetVariable('_camtolerance', jobTolerance);

  if (toolChange && runtime.state.startedJob) {
    builder.BlankLine();
    runtime.controller(builder).InitialMillModes();
    runtime.state.jobFeedModeEstablished = true;
  }
}

function emitToolChangePosition(
  builder: Builder,
  runtime: SiemensPostRuntime,
  settings: SiemensJobLifecycleSettings,
  params: EventsType['StartOfJob'],
): void {
  const positionMode = params.iTC_SUPA_MODE ?? 0;
  if (positionMode === 0) return;
  runtime.controller(builder).ToolChangePosition(positionMode, {
    x: params.nTC_XSUPA ?? settings.home.x,
    y: params.nTC_YSUPA ?? settings.home.y,
    z: settings.returnHome.z,
  });
}

function emitToolChangePrompt(
  builder: Builder,
  runtime: SiemensPostRuntime,
  settings: SiemensJobLifecycleSettings,
  params: EventsType['StartOfJob'],
): void {
  if (params.iM1 !== 1 && params.iM1 !== 2) return;
  runtime
    .controller(builder)
    .ToolChangePrompt(params.iM1, params.sM1_MSG ?? '', {
      x: params.nTC_XSUPA === 0 ? settings.home.x : params.nTC_XSUPA,
      y: params.nTC_YSUPA === 0 ? settings.home.y : params.nTC_YSUPA,
      z: settings.returnHome.z,
    });
}

function preselectNextTool(
  builder: Builder,
  state: SiemensPostContextState,
  params: EventsType['StartOfJob'],
  toolChange: JobToolChange,
): void {
  if (
    !toolChange.explicit ||
    !toolChange.resolved ||
    toolChange.resolved.last_tool ||
    params.next_job_tool_number === state.previousJobToolNumber ||
    toolChange.resolved.next_tool_id_string === state.lastPreselectedToolId
  ) {
    return;
  }
  builder.SelectTool(toolChange.resolved.next_tool_id_string);
  state.lastPreselectedToolId = toolChange.resolved.next_tool_id_string;
}

function emitToolChange(
  builder: Builder,
  runtime: SiemensPostRuntime,
  settings: SiemensJobLifecycleSettings,
  params: EventsType['StartOfJob'],
  toolChange: JobToolChange,
): void {
  if (!toolChange.resolved) return;

  emitToolChangePosition(builder, runtime, settings, params);
  builder
    .SelectTool(toolChange.resolved.tool_id_string, {
      forcePrint: true,
      skipNewLine: true,
    })
    .ChangeTool()
    .Word('D', 1);
  emitToolChangePrompt(builder, runtime, settings, params);
  preselectNextTool(builder, runtime.state, params, toolChange);
}

function currentToolDefinition(
  state: SiemensPostContextState,
  toolChange: EventsType['ChangeTool'] | null,
): SiemensToolDefinition | undefined {
  return toolChange ? state.tools.get(toolChange.tool_id_string) : undefined;
}

function updateCurrentTool(
  state: SiemensPostContextState,
  toolChange: EventsType['ChangeTool'] | null,
  definition: SiemensToolDefinition | undefined,
): void {
  state.currentToolDiameter =
    definition?.diameter ??
    toolChange?.tool_diameter ??
    state.currentToolDiameter;
}

function emitToolSetting(
  builder: Builder,
  runtime: SiemensPostRuntime,
  params: EventsType['StartOfJob'],
  definition: SiemensToolDefinition | undefined,
): void {
  if (definition && params.ts_mtype === 1) {
    runtime
      .controller(builder)
      .ToolSettingLength(
        params.ts_type ?? 0,
        definition.lengthTolerance,
        definition.diameter / 2 - definition.cornerRadius,
      );
  } else if (definition && params.ts_mtype === 2) {
    runtime
      .controller(builder)
      .ToolSettingRadius(
        params.ts_type ?? 0,
        definition.lengthTolerance,
        definition.radiusTolerance,
        definition.cornerRadius,
        definition.diameter / 2 - definition.cornerRadius,
      );
  }
}

function emitStartPosition(
  builder: Builder,
  runtime: SiemensPostRuntime,
  settings: SiemensJobLifecycleSettings,
  params: EventsType['StartOfJob'],
  toolChange: EventsType['ChangeTool'] | null,
): void {
  if (toolChange === null && settings.startPositionRequiresToolChange) return;

  builder.Block([
    toolChange ? `G0 G${runtime.state.currentHomeNumber} G90` : undefined,
    { letter: 'X', value: runtime.formatCoordinate(params.xnext) },
    { letter: 'Y', value: runtime.formatCoordinate(params.ynext) },
    runtime.state.numberOfAxes !== 3 &&
    !params.used_in_transform_4x &&
    params.anext !== undefined
      ? {
          letter: 'A',
          value: siemens828dPolicy.formatRotary(params.anext),
        }
      : undefined,
  ]);
  runtime.state.lastPosition = {
    x: params.xnext,
    y: params.ynext,
    a: params.used_in_transform_4x
      ? runtime.state.lastPosition.a
      : params.anext,
  };
}

function emitJobSpindle(
  builder: Builder,
  state: SiemensPostContextState,
  params: EventsType['StartOfJob'],
  toolChange: EventsType['ChangeTool'] | null,
): void {
  state.forceNextApproachXY = true;
  if (!toolChange) return;

  // When the "tool change" re-loads the tool that is already active,
  // legacy repeats the modal spindle speed; the job's own speed
  // arrives with the following MFeedSpin event. A real tool swap
  // emits the new job's spin rate.
  const sameToolReloaded =
    toolChange.tool_number === state.previousJobToolNumber &&
    state.lastSpindleSpeed !== undefined;
  const startSpindleSpeed = sameToolReloaded
    ? (state.lastSpindleSpeed as number)
    : Math.round(params.spin_rate);
  builder.SetSpindleSpeed(startSpindleSpeed, { forcePrint: true });
  state.lastSpindleSpeed = startSpindleSpeed;
  builder.SetSpindleDirection(params.spin_direction, { forcePrint: true });
  builder.SetSpindleDirection(params.spin_direction, { forcePrint: true });
}

function emitAirCoolantSchedule(
  builder: Builder,
  runtime: SiemensPostRuntime,
  params: EventsType['StartOfJob'],
): void {
  if (!runtime.state.currentJobAirCoolant) return;
  runtime
    .controller(builder)
    .AirCoolantSchedule(
      params.nAirCoolantDelay ?? 0,
      params.nAirCoolantDuration ?? 0,
    );
}

function emitCycleMode(
  builder: Builder,
  runtime: SiemensPostRuntime,
  params: EventsType['StartOfJob'],
  jobTolerance: number,
): void {
  if (params.b832type === 0) {
    runtime.controller(builder).Cycle832({ tolerance: 0, mode: '_OFF' });
    builder.Rapid({}, { forcePrint: true });
  } else if (!siemens828dPolicy.isDrillJob(params)) {
    runtime.controller(builder).Cycle832({
      tolerance: '_camtolerance',
      mode: siemens828dPolicy.cycle832Mode(jobTolerance),
    });
    builder.Rapid({}, { forcePrint: true });
  }
}

function startJob(
  builder: Builder,
  params: EventsType['StartOfJob'],
  metadata: EventListenerMetadata,
  runtime: SiemensPostRuntime,
  settings: SiemensJobLifecycleSettings,
): void {
  const { state } = runtime;
  openJobFile(builder, state, params);
  const toolChange = resolveJobToolChange(state, params);
  const jobTolerance = initializeJobState(state, params, toolChange.resolved);
  emitJobHeader(
    builder,
    runtime,
    params,
    metadata,
    toolChange.resolved,
    jobTolerance,
  );
  emitToolChange(builder, runtime, settings, params, toolChange);

  const toolDefinition = currentToolDefinition(state, toolChange.resolved);
  updateCurrentTool(state, toolChange.resolved, toolDefinition);
  emitToolSetting(builder, runtime, params, toolDefinition);
  emitStartPosition(builder, runtime, settings, params, toolChange.resolved);
  emitJobSpindle(builder, state, params, toolChange.resolved);
  state.previousJobToolNumber =
    toolChange.resolved?.tool_number ?? state.lastToolChange?.tool_number;

  emitAirCoolantSchedule(builder, runtime, params);
  emitCycleMode(builder, runtime, params, jobTolerance);
  builder.Comment(params.job_name);
  state.pendingPathMode = true;
  state.startedJob = true;
}

function stopJobCoolant(
  builder: Builder,
  runtime: SiemensPostRuntime,
  settings: SiemensJobLifecycleSettings,
): void {
  const { state } = runtime;
  if (!state.currentJobAirCoolant) return;
  if (settings.cancelAirCoolantSchedule) {
    runtime.controller(builder).Cancel(1).Cancel(2).Cancel(3).CoolantOff();
  } else {
    runtime.controller(builder).CoolantOff();
  }
  state.coolantActive = false;
}

function restoreJobRotaryPosition(
  builder: Builder,
  runtime: SiemensPostRuntime,
  startOfJob: EventsType['StartOfJob'],
): void {
  const { state } = runtime;
  if (
    !startOfJob.used_in_transform_4x ||
    startOfJob.anext === undefined ||
    siemens828dPolicy.sameNumber(startOfJob.anext, state.lastPosition.a)
  ) {
    return;
  }
  builder.Word('A', siemens828dPolicy.formatNumber(startOfJob.anext));
  state.lastPosition.a = startOfJob.anext;
}

function emitWearChecks(
  builder: Builder,
  runtime: SiemensPostRuntime,
  settings: SiemensJobLifecycleSettings,
  startOfJob: EventsType['StartOfJob'],
): void {
  const { state } = runtime;
  if (
    !state.lastToolChange ||
    state.lastToolChange.tool_number === startOfJob.next_job_tool_number ||
    state.pendingWearMode <= 0
  ) {
    return;
  }
  if (state.pendingWearMode === 2 || state.pendingWearMode === 3) {
    runtime
      .controller(builder)
      .ToolBreakageCheck(state.pendingWearTool, state.pendingWearMessage);
  }
  if (state.pendingWearMode === 1 || state.pendingWearMode === 3) {
    runtime
      .controller(builder)
      .ToolWearCheck(state.pendingWearTool, state.pendingWearMessage, {
        x: startOfJob.nTC_XSUPA,
        y: startOfJob.nTC_YSUPA,
        z: settings.returnHome.z,
      });
  }
  state.pendingWearMode = 0;
}

function endJob(
  builder: Builder,
  metadata: EventListenerMetadata,
  runtime: SiemensPostRuntime,
  settings: SiemensJobLifecycleSettings,
): void {
  const startOfJob = metadata.findLastEventOrThrow('StartOfJob').data;

  stopJobCoolant(builder, runtime, settings);
  runtime.controller(builder).Return();
  builder.BlankLine();
  builder.BlankLine();
  builder.CloseFile();

  restoreJobRotaryPosition(builder, runtime, startOfJob);
  runtime.callSubprogram(
    builder,
    `${siemens828dPolicy.jobFileName(startOfJob)}.SPF`,
  );
  emitWearChecks(builder, runtime, settings, startOfJob);
}

export function registerJobLifecycleHandlers(
  post: PostDefinitionApi<SiemensPostContextState>,
  runtime: SiemensPostRuntime,
  settings: SiemensJobLifecycleSettings,
): void {
  post.on('StartOfJob', (builder, params, metadata) => {
    startJob(builder, params, metadata, runtime, settings);
  });
  post.on('EndOfJob', (builder, _params, metadata) => {
    endJob(builder, metadata, runtime, settings);
  });
}

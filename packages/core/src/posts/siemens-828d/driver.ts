import type { Builder, CommandOptions } from '../../lib/builder';
import { type BuilderDriver, defineDriver } from '../../lib/driver';
import type { EventsType } from '../../types';

export const SIEMENS_828D_CAPABILITIES = [
  'cycle.81',
  'cycle.83',
  'cycle.84',
  'cycle.85',
  'cycle.830',
  'cycle.832',
  'tool.measurement',
  'tool.wear-check',
  'motion.supa',
] as const;

export type Siemens828dCapability = (typeof SIEMENS_828D_CAPABILITIES)[number];

export type Cycle832Mode =
  | '_OFF'
  | '_ROUGH'
  | '_SEMIFIN'
  | '_FINISH'
  | (string & {});

export interface Cycle832Params {
  tolerance: number | string;
  mode: Cycle832Mode;
  smoothing?: number;
}

export interface TransParams {
  x?: number;
  y?: number;
  z?: number;
}

export interface SupaRapidParams {
  x?: number;
  y?: number;
  z?: number;
}

export interface AssignmentOptions {
  spaced?: boolean;
}

export interface DrillCycleContext {
  clearance: number;
  upper: number;
  safety: number;
  job: EventsType['StartOfJob'];
  toolDiameter: number;
  cycle81Dtb?: number;
  cycle85Dtb?: number;
  cycle85RetractFactor?: number;
}

interface DrillCycleDepths {
  clearance: string;
  upper: string;
  lower: string;
  safety: string;
}

interface DrillCycleEmission {
  params: EventsType['Drill'];
  context: DrillCycleContext;
  depths: DrillCycleDepths;
  job: EventsType['StartOfJob'];
  value: (key: keyof EventsType['StartOfJob'], fallback: number) => number;
}

export interface Cycle830Params {
  clearance: number;
  upper: number;
  safety: number;
  lower: number;
  firstDepth: number;
  degression: number;
  dwellBottom: number;
  dwellStart: number;
  feedFactor: number;
  variant: number;
  minimumDepth: number;
  retract: number;
  finalDepth: number;
  distance: number;
  startSpeed: number;
  speedMode: number;
  speedFactor: number;
  feed: number;
  spindleDirection: number;
  spin: number;
  spindlePosition: number;
  approach: number;
  approachFeed: number;
  approachPosition: number;
  approachFactor: number;
  step1: number;
  step2: number;
  stepCount: number;
  stepDistance: number;
  finalFeed: number;
  retractFeed: number;
  finalDirection: number;
  finalSpeed: number;
  coolantOn: string;
  coolantOff: string;
  geometryMode: number;
  depthMode: number;
  approachMode: number;
  speedApproachMode: number;
  speedApproachMode3: number;
  finalPosition: number;
}

export class Siemens828dDriver {
  constructor(private readonly builder: Builder) {}

  public formatNumber(value: number): string {
    return Number.isInteger(value)
      ? value.toString()
      : value.toFixed(5).replace(/0+$/, '').replace(/\.$/, '');
  }

  public formatRotary(value: number): string {
    return Number.isInteger(value) ? `${value}.` : this.formatNumber(value);
  }

  public supports(capability: Siemens828dCapability): boolean {
    return this.builder.driverSupports('siemens-828d', capability);
  }

  public require(capability: Siemens828dCapability): this {
    this.builder.requireDriverCapability('siemens-828d', capability);
    return this;
  }

  public DeclareReal(...names: string[]): this {
    return this.emit(`DEF REAL ${names.join(', ')}`);
  }

  public DeclareBool(...names: string[]): this {
    return this.emit(`DEF BOOL ${names.join(', ')}`);
  }

  public DeclareInt(...names: string[]): this {
    return this.emit(`DEF INT ${names.join(', ')}`);
  }

  public Separator(): this {
    return this.emit(';');
  }

  public SetVariable(
    name: string,
    value: string | number | boolean,
    options: AssignmentOptions = {},
  ): this {
    const operator = options.spaced ? ' = ' : '=';
    return this.emit(`${name}${operator}${this.formatValue(value)}`);
  }

  public SetVariables(values: Record<string, string | number | boolean>): this {
    return this.emit(
      Object.entries(values)
        .map(([name, value]) => `${name}=${this.formatValue(value)}`)
        .join(' '),
    );
  }

  public Message(message: string): this {
    return this.emit(`MSG("${message.replaceAll('"', '""')}")`);
  }

  public Return(): this {
    return this.emit('RET');
  }

  public ToolLengthOffset(offset: number, options?: CommandOptions): this {
    return this.emit(`D${offset}`, options);
  }

  public ToolChangePrompt(
    mode: number,
    message: string,
    home: SupaRapidParams,
  ): this {
    if (mode === 2) {
      this.SupaRapid({ z: home.z });
      this.SupaRapid({ x: home.x, y: home.y });
    }
    this.Message(message);
    this.emit('M9');
    this.emit('M5');
    return this.emit('M1');
  }

  public ToolChangePosition(mode: number, home: SupaRapidParams): this {
    this.SupaRapid({ z: home.z });
    if (mode === 1) {
      this.SupaRapid({ y: home.y });
      return this.SupaRapid({ x: home.x });
    }
    if (mode === 2) {
      this.SupaRapid({ x: home.x });
      return this.SupaRapid({ y: home.y });
    }
    return this.SupaRapid({ x: home.x, y: home.y });
  }

  public CoolantOn(): this {
    this.builder.CoolantOn();
    return this;
  }

  public CoolantOff(): this {
    this.builder.CoolantOff();
    return this;
  }

  public SpindleStop(): this {
    this.builder.SpindleStop();
    return this;
  }

  public Soft(): this {
    return this.emit('SOFT');
  }

  public ContinuousPath(code = 645): this {
    return this.emit(`G${code}`);
  }

  public PathMode(code = 645, soft = true): this {
    if (soft) this.Soft();
    return this.ContinuousPath(code);
  }

  public InitialMillModes(): this {
    return this.emit('G710 G94 G90 G17');
  }

  public ToolProbeCycle(): this {
    return this.emit('BZ9912(0,,)');
  }

  public Dwell(seconds: number): this {
    return this.emit(`G04F${this.formatNumber(seconds)}`);
  }

  public ToolSettingLength(
    type: number,
    tolerance: number,
    radiusOffset: number,
  ): this {
    this.Cycle832({ tolerance: 0, mode: '_OFF' });
    this.builder.Rapid({}, { forcePrint: true });
    this.emit(
      `BZ9912(${type}, ${this.formatNumber(tolerance)}, ${this.formatNumber(radiusOffset)})`,
    );
    if (type === 2) {
      this.emit('BZ9912(2,0.4,)');
      this.builder.Rapid({ x: 0, y: 0 }, { forcePrint: true });
    }
    return this;
  }

  public ToolSettingRadius(
    type: number,
    lengthTolerance: number,
    radiusTolerance: number,
    lengthOffset: number,
    radiusOffset: number,
  ): this {
    this.Cycle832({ tolerance: 0, mode: '_OFF' });
    this.emit(
      `BZ9913(${type}, ${this.formatNumber(lengthTolerance)}, ${this.formatNumber(radiusTolerance)}, ${this.formatNumber(lengthOffset)}, ${this.formatNumber(radiusOffset)})`,
    );
    this.emit('BZ9913(0,0.1,0.1,,)');
    this.builder.Rapid({}, { forcePrint: true });
    return this;
  }

  public Trans(params?: TransParams): this {
    const words = [
      'TRANS',
      params?.x !== undefined ? `X${this.formatNumber(params.x)}` : '',
      params?.y !== undefined ? `Y${this.formatNumber(params.y)}` : '',
      params?.z !== undefined ? `Z${this.formatNumber(params.z)}` : '',
    ].filter(Boolean);

    return this.emit(words.join(' '));
  }

  public SupaRapid(params: SupaRapidParams): this {
    const words = [
      'G0 SUPA',
      params.x !== undefined ? `X${this.formatNumber(params.x)}` : '',
      params.y !== undefined ? `Y${this.formatNumber(params.y)}` : '',
      params.z !== undefined ? `Z${this.formatNumber(params.z)}` : '',
    ].filter(Boolean);

    return this.emit(words.join(' '));
  }

  public Cycle832(params: Cycle832Params): this {
    return this.emit(
      `CYCLE832(${this.formatValue(params.tolerance)},${params.mode},${params.smoothing ?? 1})`,
    );
  }

  public AirCoolantSchedule(delay: number, duration: number): this {
    this.builder.NumberedBlankLine();
    this.SetVariable('R10', 0);
    this.SetVariable('DELAY', delay, { spaced: true });
    this.SetVariable('DURATION', duration, { spaced: true });
    this.builder.NumberedBlankLine();
    this.emit('IDS=3 FROM TRUE DO $R10 = $R10 + 1');
    this.emit('IDS=1 EVERY ($R10 == 400 * DURATION) DO M9');
    this.emit('IDS=2 EVERY ($R10 == 400 * (DELAY + DURATION)) DO M7 R10=0');
    this.builder.NumberedBlankLine();
    return this;
  }

  public Cancel(identifier: number): this {
    return this.emit(`CANCEL(${identifier})`);
  }

  public Label(name: string): this {
    return this.emit(`${name}:`);
  }

  public RestoreWearReduction(): this {
    this.emit('IF (WearChanged == TRUE)');
    this.emit('  $TC_DP15[R103,1] = $TC_DP15[R103,1] * 0.8', {
      preserveWhitespace: true,
    });
    return this.emit('ENDIF');
  }

  public ToolBreakageCheck(toolName: string, message: string): this {
    this.emit(`R101=GETT("${toolName.replaceAll('"', '""')}")`);
    this.emit('R100=$TC_DP3[R101,1]');
    this.Message(message);
    this.emit('M9');
    this.emit('M5');
    this.emit('M1');
    this.emit('IF (R100<>$TC_DP3[R101,1])');
    this.emit('  GOTOB LTC', { preserveWhitespace: true });
    return this.emit('ENDIF');
  }

  public ToolWearCheck(
    toolName: string,
    message: string,
    home: SupaRapidParams,
  ): this {
    this.emit('STOPRE');
    this.emit('IF (WearChanged == TRUE)');
    this.emit('  $TC_DP15[R103,1] = ToolWearBuffer', {
      preserveWhitespace: true,
    });
    this.emit('ENDIF');
    this.emit(`R103=GETT("${toolName.replaceAll('"', '""')}")`);
    this.emit('R102=$TC_DP15[R103,1]');
    this.Message(message);
    this.emit('M9');
    this.emit('M5');
    this.SupaRapid({ z: home.z });
    this.SupaRapid({ x: home.x, y: home.y });
    this.emit('M1');
    this.emit('IF (R102<>$TC_DP15[R103,1])');
    this.emit('  WearChanged = TRUE', { preserveWhitespace: true });
    this.emit('  ToolWearBuffer = $TC_DP15[R103,1]', {
      preserveWhitespace: true,
    });
    this.emit('  GOTOB LTC', { preserveWhitespace: true });
    this.emit('ENDIF');
    return this.emit('WearChanged = FALSE');
  }

  public DrillCycle(
    params: EventsType['Drill'],
    context: DrillCycleContext,
  ): this {
    const depths: DrillCycleDepths = {
      clearance: this.formatNumber(
        params.cycle_clearance_z_precise ?? context.clearance,
      ),
      upper: this.formatNumber(
        params.cycle_upper_z_precise ?? params.drill_upper_z - context.safety,
      ),
      lower: this.formatNumber(
        params.cycle_lower_z_precise ?? params.drill_lower_z,
      ),
      safety: this.formatNumber(context.safety),
    };
    const emission: DrillCycleEmission = {
      params,
      context,
      depths,
      job: context.job,
      value: (key, fallback) => this.jobNumber(context.job, key, fallback),
    };

    switch (params.drill_cycle_name) {
      case 'CYCLE83':
        return this.emitCycle83(emission);
      case 'CYCLE830':
        return this.emitCycle830(emission);
      case 'CYCLE84':
        return this.emitCycle84(emission);
      case 'CYCLE85':
        return this.emitCycle85(emission);
      default:
        return this.emit(
          `CYCLE81(${depths.clearance},${depths.upper},${depths.safety},${depths.lower},,${this.formatNumber(context.cycle81Dtb ?? 0)},0,1,12)`,
        );
    }
  }

  private emitCycle83(input: DrillCycleEmission): this {
    const { context, depths, params, value } = input;
    const firstDepth =
      params.drill_upper_z -
      context.safety -
      value('C83_FDEP', 0) * context.toolDiameter;
    const minimumDepth = value('C83_MDEP', 0) * context.toolDiameter;

    return this.emit(
      `CYCLE83(${depths.clearance},${depths.upper},${depths.safety},${depths.lower},,${this.formatNumber(firstDepth)},,${this.formatNumber(value('C83_DAM', 30))},${this.formatNumber(value('C83_DTB', 0))},${this.formatNumber(value('C83_DTS', 0))},${this.formatNumber(value('C83_FRF', 100))},${value('C83_VARI', 1)},0,${this.formatNumber(minimumDepth)},${this.formatNumber(value('C83_VRT', 0))},${this.formatNumber(value('C83_DTD', 0))},${this.formatNumber(value('C83_DIS1', 1))},${value('C83_GMODE', 0)},1,12221112)`,
    );
  }

  private emitCycle830(input: DrillCycleEmission): this {
    const { context, depths, params, value } = input;
    const toolDiameter = context.toolDiameter;
    const qVari =
      value('C830_U_MM', 0) +
      10 * value('C830_U_RDSR', 0) +
      100 * value('C830_U_SFC', 0) +
      1000 * value('C830_U_TT', 0) +
      10000 * value('C830_U_PP', 0) +
      100000 * value('C830_U_RT', 0);
    const qGmode = 10 * value('C830_U_DD_TS', 0);
    const qAmode =
      1 +
      10 * value('C830_U_DTB', 0) +
      100 * value('C830_U_DTS', 0) +
      1000 * value('C830_U_DT', 0) +
      100000 * value('C830_U_DF', 0) +
      1000000 * value('C830_U_V3', 0);
    const sAmode2 =
      value('C830_U_F', 0) +
      10 * value('C830_U_FA', 0) +
      100 * value('C830_U_FP', 0) +
      1000 * value('C830_U_FS', 0) +
      10000 * value('C830_U_FD', 0) +
      100000 * value('C830_U_FR', 0) +
      1000000 * value('C830_U_S_V5', 0) +
      10000000 * value('C830_U_SP_V4', 0) +
      100000000 * value('C830_U_SR_V6', 0);
    const sAmode3 =
      value('C830_U_ZA', 0) +
      10 * value('C830_U_ZP', 0) +
      100 * value('C830_U_ZD', 0);

    return this.Cycle830({
      clearance: Number(depths.clearance),
      upper: Number(depths.upper),
      safety: Number(depths.safety),
      lower: Number(depths.lower),
      firstDepth: toolDiameter * value('C830_FDEP', 1),
      degression: value('C830_DAM', 30),
      dwellBottom: value('C830_DTB', 0.2),
      dwellStart: value('C830_DTS', 0),
      feedFactor: value('C830_FRF', 100),
      variant: qVari,
      minimumDepth: toolDiameter * value('C830_MDEP', 1),
      retract: value('C830_VRT', 0),
      finalDepth: value('C830_DTD', 0),
      distance: value('C830_DIS1', 1),
      startSpeed: value('C830_S_FP', 3000),
      speedMode: 3,
      speedFactor: value('C830_S_SV2', 100),
      feed: params.feed,
      spindleDirection: value('C830_SDAC', 3),
      spin: params.spin,
      spindlePosition: value('C830_S_SPOS', 0),
      approach: toolDiameter * value('C830_S_ZA', 1),
      approachFeed: value('C830_S_FA', 50),
      approachPosition: value('C830_S_ZP', 24),
      approachFactor: value('C830_S_FS', 50),
      step1: toolDiameter * value('C830_S_ZS1', 0.1),
      step2: toolDiameter * value('C830_S_ZS2', 0.1),
      stepCount: value('C830_S_N', 0),
      stepDistance: value('C830_S_ZD', 0),
      finalFeed: value('C830_S_FD', 30),
      retractFeed: value('C830_S_FR', 3000),
      finalDirection: value('C830_S_SDAC3', 3),
      finalSpeed: value('C830_S_SV3', 20),
      coolantOn: 'M8',
      coolantOff: 'M8',
      geometryMode: qGmode,
      depthMode: 1,
      approachMode: qAmode,
      speedApproachMode: sAmode2,
      speedApproachMode3: sAmode3,
      finalPosition: value('C830_S_ZPV', 2),
    });
  }

  private emitCycle84(input: DrillCycleEmission): this {
    const { depths, job, params, value } = input;
    const qTechno =
      value('C84_U_ESR', 0) +
      10 * value('C84_U_FC', 0) +
      100 * value('C84_U_A', 0) +
      1000 * value('C84_U_MSM', 0);
    const qVari = value('C84_U_MT', 0) + 10 * value('C84_U_ISM', 0);
    const qDmode =
      value('C84_U_MP', 0) +
      1000 * value('C84_U_CM', 0) +
      10000 * value('C84_U_RS', 0);
    const qAmode =
      value('C84_U_DD', 0) +
      1000 * value('C84_U_TD', 0) +
      1000000 * value('C84_U_RD', 0);
    const lead = value('tool_drill_lead', 0);

    return this.emit(
      `CYCLE84(${depths.clearance},${depths.upper},${depths.safety},${depths.lower},,${this.formatNumber(value('C84_DTB', 0))},3,,${this.formatNumber(lead)},${this.formatNumber(value('C84_POSS', 0))},${this.formatNumber(params.spin)},${this.formatNumber(params.spin * value('C84_SST1', 1))},${value('C84_AXN', 0)},${value('C84_PITA', 1)},${qTechno},${qVari},${this.formatNumber(lead * value('C84_DAM', 0))},${this.formatNumber(lead * value('C84_VRT', 0))},${job.C84_PITM ?? ''},${job.C84_PTAB ?? ''},${job.C84_PTABA ?? ''},,${qDmode},${qAmode})`,
    );
  }

  private emitCycle85(input: DrillCycleEmission): this {
    const { context, depths, params } = input;
    const retractFeed =
      context.cycle85RetractFactor === undefined
        ? 6000
        : Math.trunc(params.feed * context.cycle85RetractFactor);
    return this.emit(
      `CYCLE85(${depths.clearance},${depths.upper},${depths.safety},${depths.lower},,${this.formatNumber(context.cycle85Dtb ?? 0)},${this.formatNumber(params.feed)},${retractFeed},,1,12)`,
    );
  }

  public Cycle830(params: Cycle830Params): this {
    const n = (value: number) => this.formatNumber(value);
    return this.emit(
      `CYCLE830(${n(params.clearance)},${n(params.upper)},${n(params.safety)},${n(params.lower)},${n(params.firstDepth)},${n(params.degression)},${n(params.dwellBottom)},${n(params.dwellStart)},${n(params.feedFactor)},${params.variant},${n(params.minimumDepth)},${n(params.retract)},${n(params.finalDepth)},${n(params.distance)}, ${n(params.startSpeed)}, ${params.speedMode}, ${n(params.speedFactor)}, ${n(params.feed)}, ${params.spindleDirection}, ${n(params.spin)}, ${n(params.spindlePosition)}, ${n(params.approach)}, ${n(params.approachFeed)}, ${n(params.approachPosition)}, ${n(params.approachFactor)}, ${n(params.step1)},${n(params.step2)},${n(params.stepCount)},${n(params.stepDistance)},${n(params.finalFeed)},${n(params.retractFeed)},${n(params.finalDirection)},${n(params.finalSpeed)},"${params.coolantOn}","${params.coolantOff}",${params.geometryMode},${params.depthMode},${params.approachMode},${params.speedApproachMode},${params.speedApproachMode3},${n(params.finalPosition)})`,
    );
  }

  private jobNumber(
    job: EventsType['StartOfJob'],
    key: keyof EventsType['StartOfJob'],
    fallback: number,
  ): number {
    const value = job[key];
    return typeof value === 'number' ? value : fallback;
  }

  private emit(line: string, options?: CommandOptions): this {
    this.builder.put(line, options);
    return this;
  }

  private formatValue(value: string | number | boolean): string {
    if (typeof value === 'number') return this.formatNumber(value);
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
    return value;
  }
}

export const siemens828dDriver: BuilderDriver<Siemens828dDriver> = defineDriver(
  {
    id: 'siemens-828d',
    capabilities: SIEMENS_828D_CAPABILITIES,
    create: (builder) => new Siemens828dDriver(builder),
  },
);

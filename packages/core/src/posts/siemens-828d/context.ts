import type { MachineProfile } from '../../lib/machine-profile';
import { createPostContext } from '../../lib/post-context';
import type { EventsType } from '../../types';
import { SIEMENS_828D_STOCK_DIALECT, type Siemens828dDialect } from './dialect';
import {
  SIEMENS_828D_MACHINE_DEFAULTS,
  type Siemens828dMachineSettings,
} from './machine';

export interface SiemensToolDefinition {
  diameter: number;
  cornerRadius: number;
  lengthTolerance: number;
  radiusTolerance: number;
}

export interface SiemensPostContextState {
  machineProfile?: MachineProfile;
  /** Resolved output convention. Always present, always complete. */
  dialect: Siemens828dDialect;
  /** Resolved machine settings. Always present, always complete. */
  machine: Siemens828dMachineSettings;
  tools: Map<string, SiemensToolDefinition>;
  jobFiles: Set<string>;
  toolIndex: number;
  currentDrill: EventsType['Drill'] | null;
  emittedToolList: boolean;
  lastToolChange: EventsType['ChangeTool'] | null;
  previousJobToolNumber?: number;
  lastPreselectedToolId?: string;
  pendingToolChange: EventsType['ChangeTool'] | null;
  lastPosition: { x?: number; y?: number; z?: number; a?: number };
  pendingPathMode: boolean;
  emittedCpmForJob: boolean;
  startedJob: boolean;
  jobFeedModeEstablished: boolean;
  coolantActive: boolean;
  currentJobFloodCoolant?: string;
  currentJobCycle81Dtb: number;
  currentJobCycle85Dtb: number;
  currentJobCycle85RetractFactor?: number;
  currentJob: EventsType['StartOfJob'] | null;
  currentJobHadToolChange: boolean;
  currentToolDiameter: number;
  currentJobClearance: number;
  currentJobUpper: number;
  currentJobSafety: number;
  currentJobStartZ: number;
  currentJobAirCoolant: boolean;
  forceNextApproachXY: boolean;
  forceFeedOutput: boolean;
  previousLineFeed?: number;
  /**
   * Modal spindle speed as legacy GPP tracks it: the job-start block after
   * a tool change repeats the speed that is already active, and the job's
   * real speed is set later by MFeedSpin.
   */
  lastSpindleSpeed?: number;
  deferredJobStartZ: boolean;
  pendingCompensation: 'G40' | 'G41' | 'G42' | null;
  cutTolerance: number;
  numberOfAxes: number;
  currentHomeNumber: number;
  currentPathMode: number;
  currentSoftMode: boolean;
  pendingWearMode: number;
  pendingWearMessage: string;
  pendingWearTool: string;
}

export function createSiemensPostContext(
  machineProfile?: MachineProfile,
  dialect: Siemens828dDialect = SIEMENS_828D_STOCK_DIALECT,
  machine: Siemens828dMachineSettings = SIEMENS_828D_MACHINE_DEFAULTS,
) {
  return createPostContext<SiemensPostContextState>(() => ({
    machineProfile,
    dialect,
    machine,
    tools: new Map(),
    jobFiles: new Set(),
    toolIndex: 0,
    currentDrill: null,
    emittedToolList: false,
    lastToolChange: null,
    pendingToolChange: null,
    lastPosition: {},
    pendingPathMode: false,
    emittedCpmForJob: false,
    startedJob: false,
    jobFeedModeEstablished: false,
    coolantActive: false,
    currentJobCycle81Dtb: 0,
    currentJobCycle85Dtb: 0,
    currentJob: null,
    currentJobHadToolChange: false,
    currentToolDiameter: 0,
    currentJobClearance: 0,
    currentJobUpper: 0,
    currentJobSafety: 0,
    currentJobStartZ: 0,
    currentJobAirCoolant: false,
    forceNextApproachXY: false,
    forceFeedOutput: false,
    deferredJobStartZ: false,
    pendingCompensation: null,
    cutTolerance: 0.1,
    numberOfAxes: 4,
    currentHomeNumber: 54,
    currentPathMode: 645,
    currentSoftMode: true,
    pendingWearMode: 0,
    pendingWearMessage: '',
    pendingWearTool: '',
  }));
}

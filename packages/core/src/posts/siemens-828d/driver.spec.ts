import { describe, expect, it } from 'bun:test';
import { Builder } from '../../lib/builder';
import { siemens828dDriver } from './driver';

describe('Siemens 828D driver', () => {
  it('emits typed controller-specific commands', () => {
    const builder = new Builder();
    const siemens = builder.driver(siemens828dDriver);

    expect(siemens.supports('cycle.830')).toBe(true);

    siemens
      .DeclareReal('_camtolerance')
      .SetVariable('_camtolerance', 0.003)
      .SetVariable('WearChanged', false, { spaced: true })
      .Cycle832({ tolerance: '_camtolerance', mode: '_FINISH' })
      .Trans({ x: 1, y: 2, z: 3 })
      .ToolChangePosition(3, { x: -350, y: 50, z: 0 })
      .SupaRapid({ z: 0 })
      .ToolProbeCycle()
      .Return();

    expect(builder.build()[0].code).toContain(
      [
        'N10 DEF REAL _camtolerance',
        'N20 _camtolerance=0.003',
        'N30 WearChanged = FALSE',
        'N40 CYCLE832(_camtolerance,_FINISH,1)',
        'N50 TRANS X1 Y2 Z3',
        'N60 G0 SUPA Z0',
        'N70 G0 SUPA X-350 Y50',
        'N80 G0 SUPA Z0',
        'N90 BZ9912(0,,)',
        'N100 RET',
      ].join('\n'),
    );
  });

  it('derives CYCLE83 depths from job parameters and tool diameter', () => {
    const builder = new Builder();
    const siemens = builder.driver(siemens828dDriver);

    siemens.DrillCycle(
      {
        drill_cycle_name: 'CYCLE83',
        drill_upper_z: 2,
        drill_lower_z: -29.6379,
      } as never,
      {
        clearance: 38,
        upper: 2,
        safety: 2,
        toolDiameter: 9,
        job: {
          C83_FDEP: 2,
          C83_DAM: 30,
          C83_DTB: 0,
          C83_DTS: 0,
          C83_FRF: 100,
          C83_VARI: 1,
          C83_MDEP: 0.7,
          C83_VRT: 0,
          C83_DTD: 0,
          C83_DIS1: 1,
          C83_GMODE: 0,
        } as never,
      },
    );

    expect(builder.build()[0].code).toContain(
      'CYCLE83(38,0,2,-29.6379,,-18,,30,0,0,100,1,0,6.3,0,0,1,0,1,12221112)',
    );
  });
});

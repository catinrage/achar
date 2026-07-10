import { describe, expect, it } from 'vitest';
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
        'N70 BZ9912(0,,)',
        'N80 RET',
      ].join('\n'),
    );
  });
});

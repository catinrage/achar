import { describe, expect, it } from 'bun:test';
import { generateAcharFiles } from './achar-service';

describe('Achar service output containment', () => {
  it('rejects program names that could escape the generated directory', async () => {
    for (const programName of ['../outside', '..', '.', 'nested/name']) {
      await expect(
        generateAcharFiles({
          tracePath: 'does-not-need-to-exist.MPF',
          programName,
          postId: 'siemens-828d',
        }),
      ).rejects.toThrow('must be a plain file name');
    }
  });
});

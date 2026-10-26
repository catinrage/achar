import type { PostDefinitionApi } from '../../lib/post-definition';
import type { SiemensPostContextState } from './context';

export function registerLifecycleEvents(
  post: PostDefinitionApi<SiemensPostContextState>,
): void {
  post.on('AbsoluteMode', () => {});
  post.on('MachinePlane', () => {});
  post.on('Setup', ($, params, metadata) => {
    // A lone setup needs no separator. Look ahead on the first event so the
    // decision also works when the post was registered before events loaded.
    if (
      metadata.eventCallCounter === 0 &&
      !metadata.findNearestEvent('Setup')
    ) {
      return;
    }
    $.BlankLine();
    $.Comment(`Setup ${params._setupIndex ?? metadata.eventCallCounter + 1}`);
  });
  post.on('VmidInfo', () => {});
  post.on('HomeData', () => {});
  post.on('Tmatrix', () => {});
  post.on('JobPlane', () => {});
  post.on('LoopMatrixInfo', () => {});
  post.on('PlaneData', () => {});
  post.on('RotaryInfo', () => {});
  post.on('RotateToPlane', () => {});
  post.on('OffsetChange', () => {});
  post.on('ToolBreakage', () => {});
  post.on('EndOfFile', () => {});
}

import type { PostDefinitionApi } from '../../lib/post-definition';
import type { SiemensPostContextState } from './context';

export function registerIgnoredLifecycleEvents(
  post: PostDefinitionApi<SiemensPostContextState>,
): void {
  post.on('AbsoluteMode', () => {});
  post.on('MachinePlane', () => {});
  post.on('Setup', () => {});
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

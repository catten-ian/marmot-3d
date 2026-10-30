import type { CdpSession } from './cdp.ts';
export interface Point { id: number; x: number; y: number; radiusX?: number; radiusY?: number; force?: number; }
export interface RectCenter { x: number; y: number; left: number; top: number; width: number; height: number; }
export function touchPoint(id: number, x: number, y: number): Point { return { id, x, y, radiusX:1, radiusY:1, force:1 }; }
export function multiTouchMoveFrames(joystick: RectCenter, jump: RectCenter, offset = 50, joystickId = 1, jumpId = 2) {
  const start = touchPoint(joystickId, joystick.x, joystick.y);
  const forward = touchPoint(joystickId, joystick.x, joystick.y - offset);
  const jumpPoint = touchPoint(jumpId, jump.x, jump.y);
  return [
    { type:'touchStart', points:[start] },
    { type:'touchMove', points:[forward] },
    { type:'touchStart', points:[forward, jumpPoint] },
    // CDP touchEnd lists the point that is being lifted; keep joystick id=1 active
    // by lifting only jump id=2, then finish the joystick with the final empty frame.
    { type:'touchEnd', points:[jumpPoint] },
  ];
}
export async function elementCenter(page: CdpSession, selector: string): Promise<RectCenter> {
  const encoded = JSON.stringify(selector);
  const rect = await page.evaluate<RectCenter | null>(`(()=>{const e=document.querySelector(${encoded});if(!e)return null;const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,left:r.left,top:r.top,width:r.width,height:r.height}})()`);
  if (!rect) throw new Error(`Required element missing: ${selector}`);
  return rect;
}
export async function mouseClick(page: CdpSession, x: number, y: number) {
  await page.send('Input.dispatchMouseEvent', { type:'mousePressed', x, y, button:'left', clickCount:1 });
  await page.send('Input.dispatchMouseEvent', { type:'mouseReleased', x, y, button:'left', clickCount:1 });
}
export async function touchFrame(page: CdpSession, frame: {type:string;points:Point[]}, coordinateScale=1) {
  const touchPoints=frame.points.map((point)=>({...point,x:point.x*coordinateScale,y:point.y*coordinateScale}));
  await page.send('Input.dispatchTouchEvent', { type:frame.type, touchPoints });
}

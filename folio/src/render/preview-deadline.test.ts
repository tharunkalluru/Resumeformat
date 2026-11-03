import {afterEach,expect,it,vi} from 'vitest';
import {renderPdfPage,cancelPdfPageRender} from './preview';
const control=vi.hoisted(()=>({release:undefined as undefined|(()=>void)}));
vi.mock('../import/pdf-image-preflight',()=>({preflightPdfImages:()=>new Promise<void>(resolve=>{control.release=resolve;})}));
afterEach(()=>{control.release?.();control.release=undefined;vi.useRealTimers();});
function untouched(){return{width:1,height:1} as HTMLCanvasElement;}
it('rejects unresponsive preparation at its deadline and keeps the visible canvas untouched',async()=>{
 vi.useFakeTimers();const canvas=untouched(),pending=renderPdfPage(new Uint8Array([1]),1,canvas).catch(e=>e);
 await vi.advanceTimersByTimeAsync(15001);expect(await pending).toMatchObject({code:'preview-timeout'});
 control.release?.();await Promise.resolve();expect([canvas.width,canvas.height]).toEqual([1,1]);
});
it('cancels a stalled preview promptly instead of waiting for its parsing promise',async()=>{
 vi.useFakeTimers();const canvas=untouched(),pending=renderPdfPage(new Uint8Array([1]),1,canvas).catch(e=>e);
 cancelPdfPageRender(canvas);expect(await pending).toMatchObject({code:'preview-cancelled'});expect([canvas.width,canvas.height]).toEqual([1,1]);
});

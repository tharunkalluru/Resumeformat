import {canonicalJson,sha256Sync,type ImageAsset,type ImageRegion,type Rect} from './model';
import {FolioError} from './errors';

export function intersectImageRect(a:Rect,b:Rect):Rect|undefined {
 const x=Math.max(a.x,b.x),y=Math.max(a.y,b.y),width=Math.min(a.x+a.width,b.x+b.width)-x,height=Math.min(a.y+a.height,b.y+b.height)-y;
 return width>0&&height>0?{x,y,width,height}:undefined;
}
export function sourceImageBinding(region:ImageRegion,asset?:ImageAsset):boolean {
 const p=region.sourcePaint;
 return !!p&&canonicalJson(region.bounds)===canonicalJson(p.bounds)&&region.order===p.operatorIndex&&(!asset||asset.mime==='image/png'&&sha256Sync(asset.bytes)===p.assetSha256);
}
export function sourceImageVisibleBounds(region:ImageRegion):Rect|undefined {
 if(!region.sourcePaint||!sourceImageBinding(region))return region.bounds;
 return region.sourcePaint.pageClip?intersectImageRect(region.bounds,region.sourcePaint.pageClip):region.bounds;
}
/** Exact local inset; clipping remains locked to the retained page-space rectangle. */
export function sourceImageCssClip(region:ImageRegion):string|undefined {
 if(!region.sourcePaint?.pageClip)return;
 if(!sourceImageBinding(region))throw new FolioError('SOURCE_IMAGE_PAINT','The original image placement or clip changed.');
 const b=region.bounds,c=sourceImageVisibleBounds(region);if(!c)throw new FolioError('SOURCE_IMAGE_PAINT','An empty image clip is outside the supported paint slice.');
 return `inset(${c.y-b.y}pt ${b.x+b.width-c.x-c.width}pt ${b.y+b.height-c.y-c.height}pt ${c.x-b.x}pt)`;
}

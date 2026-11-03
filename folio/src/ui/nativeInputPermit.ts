import type {Node as PMNode} from '@tiptap/pm/model';
import type {Project,RenderedDocument} from '../core/model';

export interface NativeInputOwner {
 document:PMNode;project:Project;render:RenderedDocument|null;
 fontIdentity:string;registrationIdentity:string;geometry:string;
}
/** One native event may mutate the DOM before ProseMirror builds its transaction.
 * Retain only the pre-input proof for that event's unchanged document owner.
 * A permit never covers another region, render, geometry or later transaction. */
export class NativeInputPermit {
 private pending?:NativeInputOwner&{regionId:string;expires:number};
 capture(owner:NativeInputOwner,regionId:string,now:number):void {
  this.pending=Number.isFinite(now)&&regionId?{...owner,regionId,expires:now+1000}:undefined;
 }
 consume(owner:NativeInputOwner,now:number):string|undefined {
  const p=this.pending;this.pending=undefined;
  return p&&Number.isFinite(now)&&now<=p.expires&&now>=p.expires-1000&&p.document===owner.document&&p.project===owner.project&&p.render===owner.render&&p.fontIdentity===owner.fontIdentity&&p.registrationIdentity===owner.registrationIdentity&&p.geometry===owner.geometry?p.regionId:undefined;
 }
 clear():void{this.pending=undefined;}
}

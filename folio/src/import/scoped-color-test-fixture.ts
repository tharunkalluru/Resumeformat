// Wholly authored RGB matrix/TRC profile. No imported user/profile program.
import {PDFDocument,PDFName} from 'pdf-lib';
import {authoredMacRomanSource} from './document-scoped-test-fixture';
export function authoredRgbProfile():Uint8Array{
 const text=(s:string)=>new TextEncoder().encode(s),xyz=(x:number,y:number,z:number)=>{const b=new Uint8Array(20),v=new DataView(b.buffer);b.set(text('XYZ '));[x,y,z].forEach((n,i)=>v.setInt32(8+i*4,Math.round(n*65536)));return b;},curve=()=>{const b=new Uint8Array(14),v=new DataView(b.buffer);b.set(text('curv'));v.setUint32(8,1);v.setUint16(12,Math.round(1.8*256));return b;};
 const description=new Uint8Array(96),dv=new DataView(description.buffer);description.set(text('desc'));dv.setUint32(8,18);description.set(text('Authored RGB test\0'),12);
 const copyright=new Uint8Array(28);copyright.set(text('text'));copyright.set(text('CC0 authored test\0'),8);
 const tags:[string,Uint8Array][]=[['wtpt',xyz(.9642,1,.8249)],['rXYZ',xyz(.4361,.2225,.0139)],['gXYZ',xyz(.3851,.7169,.0971)],['bXYZ',xyz(.1431,.0606,.7141)],['rTRC',curve()],['gTRC',curve()],['bTRC',curve()],['desc',description],['cprt',copyright]];
 const out=new Uint8Array(132+tags.length*12+tags.reduce((n,[,b])=>n+Math.ceil(b.length/4)*4,0)),v=new DataView(out.buffer);v.setUint32(0,out.length);v.setUint32(8,0x02100000);out.set(text('mntr'),12);out.set(text('RGB '),16);out.set(text('XYZ '),20);[2000,1,1,0,0,0].forEach((n,i)=>v.setUint16(24+i*2,n));out.set(text('acsp'),36);v.setUint32(64,1);[.9642,1,.8249].forEach((n,i)=>v.setInt32(68+i*4,Math.round(n*65536)));v.setUint32(128,tags.length);let offset=132+tags.length*12;
 tags.forEach(([tag,b],i)=>{const p=132+i*12;out.set(text(tag),p);v.setUint32(p+4,offset);v.setUint32(p+8,b.length);out.set(b,offset);offset+=Math.ceil(b.length/4)*4;});return out;
}
export async function authoredScopedColorSource(options:{icc?:boolean;content?:string;profile?:Uint8Array;alternate?:boolean}={}){
 const original=await authoredMacRomanSource({codes:[65,32,66]}),pdf=await PDFDocument.load(original.bytes),c=pdf.context,page=pdf.getPages()[0],resources=page.node.Resources()!,profile=options.profile??authoredRgbProfile(),ref=c.register(c.flateStream(profile,{N:3,...(options.alternate===false?{}:{Alternate:'DeviceRGB'})}));resources.set(PDFName.of('ColorSpace'),c.obj({OwnedRGB:[PDFName.of('ICCBased'),ref]}));
 const content=options.content??`q 30 540 190 130 re W n ${options.icc===false?'0.3 0.5 0.7 rg':'/OwnedRGB cs 0.3 0.5 0.7 sc'} BT /F1 12 Tf 1 0 0 1 40 648 Tm <412042> Tj ET 40 590 m 180 590 l 180 588 l 40 588 l h f Q`;
 page.node.set(PDFName.of('Contents'),c.register(c.flateStream(content)));return{...original,bytes:new Uint8Array(await pdf.save()),profile,profileRef:ref.toString()};
}

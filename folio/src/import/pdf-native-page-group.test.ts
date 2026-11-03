import {it,expect} from 'vitest';
import {PDFDocument,PDFName} from 'pdf-lib';
import {captureNativePageGroup} from './pdf-native-page-group';
async function group(fields:Record<string,string|number|boolean|undefined>){const d=await PDFDocument.create(),p=d.addPage();p.node.set(PDFName.of('Group'),d.context.obj(fields));return p.node;}
it('preserves omitted isolation and knockout fields',async()=>expect(captureNativePageGroup(await group({Type:'Group',S:'Transparency',CS:'DeviceRGB'}))).toEqual({Type:'Group',S:'Transparency',CS:'DeviceRGB'}));
it('preserves explicit false flags distinctly from omission',async()=>expect(captureNativePageGroup(await group({S:'Transparency',CS:'DeviceRGB',I:false,K:false}))).toEqual({S:'Transparency',CS:'DeviceRGB',I:false,K:false}));
it.each([{K:true},{I:1},{CS:'DeviceCMYK'},{S:'Other'},{Type:'Other'},{SMask:'None'}])('rejects unsupported group %j',async extra=>{const p=await group({S:'Transparency',CS:'DeviceRGB',...extra});expect(()=>captureNativePageGroup(p)).toThrow();});

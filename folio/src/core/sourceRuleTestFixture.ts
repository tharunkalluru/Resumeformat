import {PDFDocument,rgb} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {importResume} from '../import';
import type {ImportResult} from './model';

/** Wholly fictional original with an embedded licensed face and an authored source stroke. */
export async function fictionalRuleImport(program:Uint8Array,ruleOffset=1):Promise<ImportResult>{
 const pdf=await PDFDocument.create();pdf.registerFontkit(fontkit);const font=await pdf.embedFont(program,{subset:false}),page=pdf.addPage([500,700]);
 page.drawText('gag',{font,size:12,x:40,y:648});
 page.drawLine({start:{x:40,y:648-ruleOffset},end:{x:65,y:648-ruleOffset},thickness:1,color:rgb(0,0,1)});
 page.drawText('abc',{font,size:12,x:40,y:598});
 const bytes=new Uint8Array(await pdf.save());return importResume(new File([new Uint8Array(bytes).buffer],'fictional-original-rule.pdf',{type:'application/pdf'}));
}

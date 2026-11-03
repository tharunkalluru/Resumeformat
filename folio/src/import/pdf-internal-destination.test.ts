import {describe,expect,it} from 'vitest';
import {PDFDocument,PDFName,PDFNull,PDFNumber,PDFRef,PDFString,type PDFObject} from 'pdf-lib';
import {resolveInternalDestination} from './pdf-internal-destination';

const name=PDFName.of;
const modes=[
  ['XYZ',[12.5,null,1.25]],['Fit',[]],['FitH',[null]],['FitV',[23.125]],
  ['FitR',[10,20,180,190]],['FitB',[]],['FitBH',[42]],['FitBV',[null]],
] as const;

async function fixture(){
  const document=await PDFDocument.create(),pages=[document.addPage([200,200]),document.addPage([200,200])];
  const destination=(pageNumber:number,mode:string,args:readonly (number|null)[]=[])=>
    document.context.obj([pages[pageNumber-1].ref,name(mode),...args.map(value=>value===null?PDFNull:PDFNumber.of(value))]);
  const names=(root:PDFObject)=>document.catalog.set(name('Names'),document.context.obj({Dests:root}));
  return {document,pages,destination,names};
}

describe('closed original internal destination ownership',()=>{
  it('preserves every supported direct mode, argument and null against the actual owned page',async()=>{
    const {document,destination}=await fixture();
    for(const [mode,args] of modes){
      const original=destination(2,mode,args),before=original.toString();
      expect(resolveInternalDestination(document,original)).toEqual({pageNumber:2,mode,args:[...args]});
      expect(original.toString()).toBe(before);
    }
  });

  it('resolves string and name aliases through the legacy catalog without folding names',async()=>{
    const {document,destination}=await fixture(),dests=document.context.obj({});
    dests.set(name('Chapter One'),destination(2,'XYZ',[17.25,151.5,null]));
    document.catalog.set(name('Dests'),dests);
    for(const value of [PDFString.of('Chapter One'),name('Chapter One')]){
      expect(resolveInternalDestination(document,value)).toEqual({pageNumber:2,mode:'XYZ',args:[17.25,151.5,null]});
    }
    expect(()=>resolveInternalDestination(document,PDFString.of('chapter one'))).toThrow();
  });

  it('resolves an indirect nested name tree and a standard closed D wrapper',async()=>{
    const {document,destination,names}=await fixture(),c=document.context;
    const first=c.register(c.obj({Limits:[PDFString.of('alpha'),PDFString.of('alpha')],Names:[PDFString.of('alpha'),destination(1,'Fit')]}));
    const wrapped=c.register(c.obj({D:destination(2,'FitH',[152.75])}));
    const second=c.register(c.obj({Limits:[PDFString.of('omega'),PDFString.of('omega')],Names:[PDFString.of('omega'),wrapped]}));
    names(c.register(c.obj({Limits:[PDFString.of('alpha'),PDFString.of('omega')],Kids:[first,second]})));
    expect(resolveInternalDestination(document,PDFString.of('omega'))).toEqual({pageNumber:2,mode:'FitH',args:[152.75]});
    expect(resolveInternalDestination(document,name('alpha'))).toEqual({pageNumber:1,mode:'Fit',args:[]});
  });

  it('rejects missing names, numeric guesses and Page dictionaries outside the owned page tree',async()=>{
    const {document}=await fixture(),c=document.context;
    const unowned=c.register(c.obj({Type:'Page',MediaBox:[0,0,200,200]}));
    for(const value of [PDFString.of('missing'),c.obj([0,name('Fit')]),c.obj([unowned,name('Fit')]),c.obj([PDFRef.of(999999),name('Fit')])]){
      expect(()=>resolveInternalDestination(document,value)).toThrow();
    }
  });

  it('rejects unknown modes, wrong mode arity and argument types',async()=>{
    const {document,pages,destination}=await fixture(),c=document.context;
    for(const value of [
      destination(1,'Unknown'),destination(1,'Fit',[0]),destination(1,'XYZ',[1,2]),
      destination(1,'FitH',[]),destination(1,'FitR',[1,2,3]),destination(1,'FitR',[1,2,null,4]),
      c.obj([pages[0].ref,PDFString.of('Fit')]),c.obj([pages[0].ref,name('FitV'),name('Current')]),
    ])expect(()=>resolveInternalDestination(document,value)).toThrow();
  });

  it('rejects nonfinite destination numbers rather than replacing them with defaults',async()=>{
    const {document,destination}=await fixture();
    for(const value of [NaN,Infinity,-Infinity]){
      const target=destination(1,'XYZ',[value,100,null]);
      expect(()=>resolveInternalDestination(document,target)).toThrow();
    }
  });

  it('rejects a cyclic name tree through its intended bounded traversal',async()=>{
    const {document,names}=await fixture(),c=document.context,root=c.obj({}),ref=c.register(root);
    root.set(name('Kids'),c.obj([ref]));
    names(ref);
    expect(()=>resolveInternalDestination(document,PDFString.of('loop'))).toThrow(/cyclic|cycle|bound|budget|depth|limit/i);
  });

  it('rejects duplicate definitions instead of trusting the first matching name',async()=>{
    const {document,destination,names}=await fixture(),c=document.context;
    const leaves=[1,2].map(page=>c.register(c.obj({Limits:[PDFString.of('same'),PDFString.of('same')],Names:[PDFString.of('same'),destination(page,'Fit')]})));
    names(c.register(c.obj({Kids:leaves})));
    expect(()=>resolveInternalDestination(document,PDFString.of('same'))).toThrow();
  });

  it('refuses active extra fields in a named destination wrapper or tree node',async()=>{
    for(const extra of ['Next','AA','S']){
      const {document,destination}=await fixture(),c=document.context;
      const wrapped=c.obj({D:destination(1,'Fit')});
      wrapped.set(name(extra),extra==='S'?name('JavaScript'):c.obj({S:'JavaScript',JS:PDFString.of('fictional()')}));
      document.catalog.set(name('Dests'),c.obj({unsafe:wrapped}));
      expect(()=>resolveInternalDestination(document,PDFString.of('unsafe'))).toThrow();
    }
    const {document,destination,names}=await fixture(),c=document.context;
    names(c.obj({Names:[PDFString.of('unsafe'),destination(1,'Fit')],AA:{S:'JavaScript',JS:PDFString.of('fictional()')}}));
    expect(()=>resolveInternalDestination(document,PDFString.of('unsafe'))).toThrow();
    expect(()=>resolveInternalDestination(document,c.obj({S:'GoTo',D:destination(1,'Fit'),Next:{S:'JavaScript'}}))).toThrow();
  });

  it('refuses excessive tree depth before resolving an otherwise valid target',async()=>{
    const {document,destination,names}=await fixture(),c=document.context,label=PDFString.of('deep');
    let node:PDFObject=c.register(c.obj({Names:[label,destination(1,'Fit')],Limits:[label,label]}));
    for(let i=0;i<32;i++)node=c.register(c.obj({Kids:[node],Limits:[label,label]}));
    names(node);
    expect(()=>resolveInternalDestination(document,label)).toThrow(/bound|budget|depth|limit/i);
  });

  it('checks the complete name-pair budget even when the queried name occurs first',async()=>{
    const {document,destination,names}=await fixture(),c=document.context;
    // Each leaf is individually within the 4096-pair limit; together they exceed it.
    const leaves=[Array.from({length:2048},(_,i)=>i),Array.from({length:2049},(_,i)=>i+2048)]
      .map(indices=>c.register(c.obj({Names:indices.flatMap(i=>[PDFString.of(String(i).padStart(5,'0')),destination(1,'Fit')])})));
    names(c.obj({Kids:leaves}));
    expect(()=>resolveInternalDestination(document,PDFString.of('00000'))).toThrow(/bound|budget|depth|limit/i);
  });
});

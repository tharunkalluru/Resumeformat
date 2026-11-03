export const num=n=>[29,(n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255];
export const tnum=n=>n>=-107&&n<=107?[n+139]:n>=108&&n<=1131?[247+((n-108)>>8),(n-108)&255]:n>=-1131&&n<=-108?[251+((-n-108)>>8),(-n-108)&255]:[28,(n>>8)&255,n&255];
export function idx(items){if(!items.length)return[0,0];const total=items.reduce((n,a)=>n+a.length,1),size=total<=255?1:2;let offset=1;const offsets=[1];for(const a of items){offset+=a.length;offsets.push(offset)}return[items.length>>8,items.length&255,size,...offsets.flatMap(o=>size===1?[o]:[o>>8,o&255]),...items.flat()];}
export function tiny({extraTop=[],charstrings,local,global=[],encoding,charset,extraStrings=[]}={}){
 const chars=charstrings??[[14],[...tnum(50),139,139,21,159,139,5,14],[32,10,14]],locals=local??[[...tnum(200),139,139,21,149,139,5,11]];
 const head=[1,0,4,4],name=idx([[70,105,99,116,105,111,110]]),strings=idx([[70,111,111],[66,97,114],...extraStrings]),glob=idx(global),cs=charset??[0,1,135,1,136],enc=encoding??[0,2,65,66],priv=[...num(500),20,...num(100),21,...num(18),19],loc=idx(locals),ci=idx(chars);
 let top=[];const dict=(base)=>[...num(base),15,...num(base+cs.length),16,...num(base+cs.length+enc.length),17,...num(priv.length),...num(base+cs.length+enc.length+ci.length),18,...extraTop];top=idx([dict(0)]);const base=head.length+name.length+top.length+strings.length+glob.length;top=idx([dict(base)]);
 return new Uint8Array([...head,...name,...top,...strings,...glob,...cs,...enc,...ci,...priv,...loc]);
}

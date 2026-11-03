export function type2Advance(code,local,global,defaults,budget,receipt){
 const fail=()=>{throw Error('CFF_TYPE2_UNPROVED')};let width,st=[],hints=0,path=false,ended=false;
 const tick=()=>{if(--budget.remaining<0)fail()};const arity=(n)=>{if(st.length!==n)fail()};
 const consume=(kind)=>{if(width!==undefined)return;const has=kind==='stem'?st.length%2===1:kind==='move1'?st.length===2:kind==='move2'?st.length===3:st.length===1;if(receipt)receipt.widthSource=has?'explicit-plus-nominal':'private-default';if(has)width=defaults.nominal+st.shift();else width=defaults.default;if(!Number.isFinite(width)||width<0)fail()};
 const bias=n=>n<1240?107:n<33900?1131:32768;
 function run(bytes,depth,chain){if(depth>10)fail();let i=0;const byte=()=>{if(i>=bytes.length)fail();return bytes[i++]};
 while(i<bytes.length){tick();let op=byte();if(op===28||op===255||op>=32){let n;if(op===28){n=(byte()<<8)|byte();if(n&32768)n-=65536}else if(op===255){n=((byte()<<24)|(byte()<<16)|(byte()<<8)|byte())/65536}else if(op<=246)n=op-139;else if(op<=250)n=(op-247)*256+byte()+108;else n=-(op-251)*256-byte()-108;st.push(n);if(st.length>48||!Number.isFinite(n))fail();continue;}
 if(op===10||op===29){if(!st.length)fail();const a=op===10?local:global,n=st.pop();if(!Number.isInteger(n))fail();const idx=n+bias(a.length);if(idx<0||idx>=a.length)fail();if(receipt)receipt.calls.push({kind:op===10?'local':'global',index:idx});const key=op+':'+idx;if(chain.has(key))fail();const next=new Set(chain);next.add(key);run(a[idx],depth+1,next);continue;}
 if(op===11){if(!depth||i!==bytes.length)fail();return;}
 if(op===1||op===3||op===18||op===23||op===19||op===20){consume('stem');if(st.length%2)fail();hints+=st.length/2;if(hints>96)fail();st=[];if(op===19||op===20){const count=Math.ceil(hints/8);if(i+count>bytes.length)fail();i+=count;}continue;}
 if(op===4||op===21||op===22){consume(op===21?'move2':'move1');arity(op===21?2:1);path=true;st=[];continue;}
 if(op===14){consume('end');arity(0);if(depth||i!==bytes.length)fail();ended=true;return;}
 if(!path||width===undefined)fail();
 if(op===5){if(st.length<2||st.length%2)fail();}
 else if(op===6||op===7){if(st.length<1)fail();}
 else if(op===8){if(st.length<6||st.length%6)fail();}
 else if(op===24){if(st.length<8||(st.length-2)%6)fail();}
 else if(op===25){if(st.length<8||(st.length-6)%2)fail();}
 else if(op===26||op===27||op===30||op===31){if(st.length<4||![0,1].includes(st.length%4))fail();}
 else if(op===12){const e=byte(),n={34:7,35:13,36:9,37:11}[e];if(!n)fail();arity(n);}
 else fail();st=[];
 }
 fail();}
 run(code,0,new Set());if(!ended||width===undefined)fail();return width;
}

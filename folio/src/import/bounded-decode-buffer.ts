/** Pinned pdf-lib1.17.1 DecodeStream growth boundary, installed before decoding.
 * Conservatively refuses power-of-two rounding beyond a non-power-of-two cap. */
export interface DecodeBufferAllocator {
 buffer:Uint8Array;
 minBufferLength:number;
 ensureBuffer(requested:number):Uint8Array;
}
export function boundDecodeBufferGrowth(decoder:DecodeBufferAllocator,limit:number):void {
 const fail=():never=>{throw Error('decode allocation budget');};
 if(!Number.isSafeInteger(limit)||limit<1||limit>4*1024*1024||typeof decoder.ensureBuffer!=='function')return fail();
 const allocate=decoder.ensureBuffer.bind(decoder);
 decoder.ensureBuffer=(requested:number)=>{
  const capacity=decoder.buffer.byteLength,min=decoder.minBufferLength;
  if(!(decoder.buffer instanceof Uint8Array)||!Number.isSafeInteger(requested)||requested<0||requested>limit||capacity>limit||!Number.isSafeInteger(min)||min<512||min>4*1024*1024||(min&(min-1))!==0)return fail();
  let target=capacity;
  if(requested>capacity){target=min;while(target<requested){if(target>Math.floor(limit/2))return fail();target*=2;}if(target>limit)return fail();}
  // No call to the SDK allocator occurs until its actual rounded size fits.
  const result=allocate(requested);if(result.byteLength!==target||result.byteLength>limit)return fail();return result;
 };
}

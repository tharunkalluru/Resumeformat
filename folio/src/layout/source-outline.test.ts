import {it,expect} from 'vitest';
import {exactTrueTypeFillOutline} from './source-outline';
const point=[{command:'moveTo',args:[110,0]},{command:'closePath',args:[]}];
const ink=[{command:'moveTo',args:[323,978]},{command:'lineTo',args:[323,0]},{command:'lineTo',args:[147,0]},{command:'lineTo',args:[147,978]},{command:'closePath',args:[]}];
it('proves a removed point-only contour without changing filled ink',()=>{expect(exactTrueTypeFillOutline({commands:[...point,...ink]},{commands:ink})).toBe(true);});
it('refuses even the smallest changed painted coordinate',()=>{const changed=structuredClone(ink);changed[0].args[0]+=Number.EPSILON*323;expect(exactTrueTypeFillOutline({commands:ink},{commands:changed})).toBe(false);});
it('does not discard zero-length drawing segments or reorder contours',()=>{expect(exactTrueTypeFillOutline({commands:[point[0],{command:'lineTo',args:[110,0]},point[1],...ink]},{commands:ink})).toBe(false);expect(exactTrueTypeFillOutline({commands:[...ink,...ink.slice().reverse()]},{commands:ink})).toBe(false);});
it('refuses open, malformed or nonfinite paths',()=>{for(const commands of [ink.slice(0,-1),[{command:'lineTo',args:[1,2]}],[{command:'moveTo',args:[Infinity,0]}],[{command:'unknown',args:[]}]] )expect(exactTrueTypeFillOutline({commands},{commands:[]})).toBe(false);});
it('retains every quadratic control point exactly',()=>{const curve=[{command:'moveTo',args:[0,0]},{command:'quadraticCurveTo',args:[1,2,3,4]},{command:'closePath',args:[]}];const changed=structuredClone(curve);changed[1].args[1]=3;expect(exactTrueTypeFillOutline({commands:curve},{commands:curve})).toBe(true);expect(exactTrueTypeFillOutline({commands:curve},{commands:changed})).toBe(false);});

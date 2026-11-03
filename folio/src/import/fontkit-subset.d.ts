declare module 'fontkit' {
 export function create(bytes:Uint8Array):Omit<import('@pdf-lib/fontkit').Font,'createSubset'> & {createSubset():{includeGlyph(id:number):number;encode():Uint8Array}};
}

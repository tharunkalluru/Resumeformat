import {FolioError} from '../core/errors';

const fail=():never=>{throw new FolioError('PDF_MACROMAN_SELECTOR','The original nonsymbolic MacRoman physical selector is not proved.');};
/** PDF MacRoman glyph names and their AGL scalars, not the OS Macintosh codec.
 * PDF1.6 §5.5.5/AppendixD; pinned PDF.js6.4.299 MacRomanEncoding/getGlyphsUnicode.
 * In particular PDF code0xDB is currency (U+00A4), never the OS Euro mapping.
 */
const PDF_MACROMAN:readonly (readonly [number,string,number])[]=[
  [32, 'space', 0x20],
  [33, 'exclam', 0x21],
  [34, 'quotedbl', 0x22],
  [35, 'numbersign', 0x23],
  [36, 'dollar', 0x24],
  [37, 'percent', 0x25],
  [38, 'ampersand', 0x26],
  [39, 'quotesingle', 0x27],
  [40, 'parenleft', 0x28],
  [41, 'parenright', 0x29],
  [42, 'asterisk', 0x2a],
  [43, 'plus', 0x2b],
  [44, 'comma', 0x2c],
  [45, 'hyphen', 0x2d],
  [46, 'period', 0x2e],
  [47, 'slash', 0x2f],
  [48, 'zero', 0x30],
  [49, 'one', 0x31],
  [50, 'two', 0x32],
  [51, 'three', 0x33],
  [52, 'four', 0x34],
  [53, 'five', 0x35],
  [54, 'six', 0x36],
  [55, 'seven', 0x37],
  [56, 'eight', 0x38],
  [57, 'nine', 0x39],
  [58, 'colon', 0x3a],
  [59, 'semicolon', 0x3b],
  [60, 'less', 0x3c],
  [61, 'equal', 0x3d],
  [62, 'greater', 0x3e],
  [63, 'question', 0x3f],
  [64, 'at', 0x40],
  [65, 'A', 0x41],
  [66, 'B', 0x42],
  [67, 'C', 0x43],
  [68, 'D', 0x44],
  [69, 'E', 0x45],
  [70, 'F', 0x46],
  [71, 'G', 0x47],
  [72, 'H', 0x48],
  [73, 'I', 0x49],
  [74, 'J', 0x4a],
  [75, 'K', 0x4b],
  [76, 'L', 0x4c],
  [77, 'M', 0x4d],
  [78, 'N', 0x4e],
  [79, 'O', 0x4f],
  [80, 'P', 0x50],
  [81, 'Q', 0x51],
  [82, 'R', 0x52],
  [83, 'S', 0x53],
  [84, 'T', 0x54],
  [85, 'U', 0x55],
  [86, 'V', 0x56],
  [87, 'W', 0x57],
  [88, 'X', 0x58],
  [89, 'Y', 0x59],
  [90, 'Z', 0x5a],
  [91, 'bracketleft', 0x5b],
  [92, 'backslash', 0x5c],
  [93, 'bracketright', 0x5d],
  [94, 'asciicircum', 0x5e],
  [95, 'underscore', 0x5f],
  [96, 'grave', 0x60],
  [97, 'a', 0x61],
  [98, 'b', 0x62],
  [99, 'c', 0x63],
  [100, 'd', 0x64],
  [101, 'e', 0x65],
  [102, 'f', 0x66],
  [103, 'g', 0x67],
  [104, 'h', 0x68],
  [105, 'i', 0x69],
  [106, 'j', 0x6a],
  [107, 'k', 0x6b],
  [108, 'l', 0x6c],
  [109, 'm', 0x6d],
  [110, 'n', 0x6e],
  [111, 'o', 0x6f],
  [112, 'p', 0x70],
  [113, 'q', 0x71],
  [114, 'r', 0x72],
  [115, 's', 0x73],
  [116, 't', 0x74],
  [117, 'u', 0x75],
  [118, 'v', 0x76],
  [119, 'w', 0x77],
  [120, 'x', 0x78],
  [121, 'y', 0x79],
  [122, 'z', 0x7a],
  [123, 'braceleft', 0x7b],
  [124, 'bar', 0x7c],
  [125, 'braceright', 0x7d],
  [126, 'asciitilde', 0x7e],
  [128, 'Adieresis', 0xc4],
  [129, 'Aring', 0xc5],
  [130, 'Ccedilla', 0xc7],
  [131, 'Eacute', 0xc9],
  [132, 'Ntilde', 0xd1],
  [133, 'Odieresis', 0xd6],
  [134, 'Udieresis', 0xdc],
  [135, 'aacute', 0xe1],
  [136, 'agrave', 0xe0],
  [137, 'acircumflex', 0xe2],
  [138, 'adieresis', 0xe4],
  [139, 'atilde', 0xe3],
  [140, 'aring', 0xe5],
  [141, 'ccedilla', 0xe7],
  [142, 'eacute', 0xe9],
  [143, 'egrave', 0xe8],
  [144, 'ecircumflex', 0xea],
  [145, 'edieresis', 0xeb],
  [146, 'iacute', 0xed],
  [147, 'igrave', 0xec],
  [148, 'icircumflex', 0xee],
  [149, 'idieresis', 0xef],
  [150, 'ntilde', 0xf1],
  [151, 'oacute', 0xf3],
  [152, 'ograve', 0xf2],
  [153, 'ocircumflex', 0xf4],
  [154, 'odieresis', 0xf6],
  [155, 'otilde', 0xf5],
  [156, 'uacute', 0xfa],
  [157, 'ugrave', 0xf9],
  [158, 'ucircumflex', 0xfb],
  [159, 'udieresis', 0xfc],
  [160, 'dagger', 0x2020],
  [161, 'degree', 0xb0],
  [162, 'cent', 0xa2],
  [163, 'sterling', 0xa3],
  [164, 'section', 0xa7],
  [165, 'bullet', 0x2022],
  [166, 'paragraph', 0xb6],
  [167, 'germandbls', 0xdf],
  [168, 'registered', 0xae],
  [169, 'copyright', 0xa9],
  [170, 'trademark', 0x2122],
  [171, 'acute', 0xb4],
  [172, 'dieresis', 0xa8],
  [173, 'notequal', 0x2260],
  [174, 'AE', 0xc6],
  [175, 'Oslash', 0xd8],
  [176, 'infinity', 0x221e],
  [177, 'plusminus', 0xb1],
  [178, 'lessequal', 0x2264],
  [179, 'greaterequal', 0x2265],
  [180, 'yen', 0xa5],
  [181, 'mu', 0xb5],
  [182, 'partialdiff', 0x2202],
  [183, 'summation', 0x2211],
  [184, 'product', 0x220f],
  [185, 'pi', 0x3c0],
  [186, 'integral', 0x222b],
  [187, 'ordfeminine', 0xaa],
  [188, 'ordmasculine', 0xba],
  [189, 'Omega', 0x2126],
  [190, 'ae', 0xe6],
  [191, 'oslash', 0xf8],
  [192, 'questiondown', 0xbf],
  [193, 'exclamdown', 0xa1],
  [194, 'logicalnot', 0xac],
  [195, 'radical', 0x221a],
  [196, 'florin', 0x192],
  [197, 'approxequal', 0x2248],
  [198, 'Delta', 0x2206],
  [199, 'guillemotleft', 0xab],
  [200, 'guillemotright', 0xbb],
  [201, 'ellipsis', 0x2026],
  [202, 'space', 0x20],
  [203, 'Agrave', 0xc0],
  [204, 'Atilde', 0xc3],
  [205, 'Otilde', 0xd5],
  [206, 'OE', 0x152],
  [207, 'oe', 0x153],
  [208, 'endash', 0x2013],
  [209, 'emdash', 0x2014],
  [210, 'quotedblleft', 0x201c],
  [211, 'quotedblright', 0x201d],
  [212, 'quoteleft', 0x2018],
  [213, 'quoteright', 0x2019],
  [214, 'divide', 0xf7],
  [215, 'lozenge', 0x25ca],
  [216, 'ydieresis', 0xff],
  [217, 'Ydieresis', 0x178],
  [218, 'fraction', 0x2044],
  [219, 'currency', 0xa4],
  [220, 'guilsinglleft', 0x2039],
  [221, 'guilsinglright', 0x203a],
  [222, 'fi', 0xfb01],
  [223, 'fl', 0xfb02],
  [224, 'daggerdbl', 0x2021],
  [225, 'periodcentered', 0xb7],
  [226, 'quotesinglbase', 0x201a],
  [227, 'quotedblbase', 0x201e],
  [228, 'perthousand', 0x2030],
  [229, 'Acircumflex', 0xc2],
  [230, 'Ecircumflex', 0xca],
  [231, 'Aacute', 0xc1],
  [232, 'Edieresis', 0xcb],
  [233, 'Egrave', 0xc8],
  [234, 'Iacute', 0xcd],
  [235, 'Icircumflex', 0xce],
  [236, 'Idieresis', 0xcf],
  [237, 'Igrave', 0xcc],
  [238, 'Oacute', 0xd3],
  [239, 'Ocircumflex', 0xd4],
  [240, 'apple', 0xf8ff],
  [241, 'Ograve', 0xd2],
  [242, 'Uacute', 0xda],
  [243, 'Ucircumflex', 0xdb],
  [244, 'Ugrave', 0xd9],
  [245, 'dotlessi', 0x131],
  [246, 'circumflex', 0x2c6],
  [247, 'tilde', 0x2dc],
  [248, 'macron', 0xaf],
  [249, 'breve', 0x2d8],
  [250, 'dotaccent', 0x2d9],
  [251, 'ring', 0x2da],
  [252, 'cedilla', 0xb8],
  [253, 'hungarumlaut', 0x2dd],
  [254, 'ogonek', 0x2db],
  [255, 'caron', 0x2c7],
];
export interface MacRomanEncodingEntry {
  originalCharCode:number;
  glyphName:string;
  /** First MacRoman encoding index bearing this glyph name; distinct from Unicode. */
  macRomanCode:number;
  encodingUnicode:number;
}
/** Deterministic encoding semantics only; this does not read PDF ToUnicode. */
export function macRomanEncodingEntry(code:number):MacRomanEncodingEntry|undefined {
  if(!Number.isInteger(code)||code<0||code>255)return;
  const entry=PDF_MACROMAN.find(row=>row[0]===code);if(!entry)return;
  return {originalCharCode:code,glyphName:entry[1],macRomanCode:PDF_MACROMAN.find(row=>row[1]===entry[1])![0],encodingUnicode:entry[2]};
}
export interface MacRomanPhysicalSelector extends MacRomanEncodingEntry {glyphId:number}
/** Physical evidence only. No rights, style, empty-outline, native or font admission.
 * A positive 'space' selector still requires independent original/converted blank proof.
 * Only a sole original Macintosh(1,0), language0, format6 cmap is supported.
 */
export function originalFormat6GlyphIds(bytes:Uint8Array,numGlyphs:number):ReadonlyMap<number,number> {
  if(!(bytes instanceof Uint8Array)||bytes.length<12||bytes.length>4*1024*1024||
      !Number.isInteger(numGlyphs)||numGlyphs<1||numGlyphs>65535)return fail();
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),count=v.getUint16(4),directoryEnd=12+count*16;
  if(![0x00010000,0x74727565].includes(v.getUint32(0))||count<1||count>128||directoryEnd>bytes.length)return fail();
  const tables=new Map<string,{offset:number;length:number}>(),ranges:{start:number;end:number}[]=[];
  for(let i=0;i<count;i++){
    const p=12+i*16,tag=String.fromCharCode(...bytes.subarray(p,p+4)),offset=v.getUint32(p+8),length=v.getUint32(p+12);
    if(tables.has(tag)||offset%4!==0||offset<directoryEnd||offset>bytes.length||length>bytes.length-offset||
        length>0&&ranges.some(r=>offset<r.end&&offset+length>r.start))return fail();
    tables.set(tag,{offset,length});if(length)ranges.push({start:offset,end:offset+length});
  }
  const cmap=tables.get('cmap'),maxp=tables.get('maxp');
  if(!maxp||maxp.length<32||v.getUint32(maxp.offset)!==0x00010000||v.getUint16(maxp.offset+4)!==numGlyphs||!cmap||cmap.length<22)return fail();
  const base=cmap.offset;
  // No competing or duplicate cmap selection, no overlapping/trailing subtable data.
  if(v.getUint16(base)!==0||v.getUint16(base+2)!==1||v.getUint16(base+4)!==1||v.getUint16(base+6)!==0||v.getUint32(base+8)!==12)return fail();
  const sub=base+12,length=v.getUint16(sub+2),first=v.getUint16(sub+6),entries=v.getUint16(sub+8);
  if(v.getUint16(sub)!==6||v.getUint16(sub+4)!==0||entries<1||entries>256||first>255||first+entries>256||
      length!==10+entries*2)return fail();
  // Bounded compatibility for observed legacy containers, not general alignment padding.
  const suffix=cmap.length-(12+length);
  if(suffix!==0&&(suffix!==2||v.getUint16(sub+length)!==0))return fail();
  for(let i=0;i<entries;i++)if(v.getUint16(sub+10+i*2)>=numGlyphs)return fail();
  const result=new Map<number,number>();
  for(let code=first;code<first+entries;code++){const glyphId=v.getUint16(sub+10+(code-first)*2);if(glyphId>0)result.set(code,glyphId);}
  return result;
}
/** PDF encoding names choose their first MacRoman index; this is not raw-byte selection. */
export function originalMacRomanSelectors(bytes:Uint8Array,flags:number,numGlyphs:number):ReadonlyMap<number,MacRomanPhysicalSelector> {
  if(!Number.isInteger(flags)||flags<0||flags>0x7fffffff||!(flags&32)||(flags&4))return fail();
  const physical=originalFormat6GlyphIds(bytes,numGlyphs),result=new Map<number,MacRomanPhysicalSelector>();
  for(const row of PDF_MACROMAN){const encoding=macRomanEncodingEntry(row[0])!,glyphId=physical.get(encoding.macRomanCode);if(glyphId)result.set(row[0],{...encoding,glyphId});}
  return result;
}

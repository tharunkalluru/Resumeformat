type Command={command:string;args:readonly number[]};
const arity:Record<string,number>={moveTo:2,lineTo:2,quadraticCurveTo:4,bezierCurveTo:6,closePath:0};
/** A point-only closed TrueType contour has no filled area. PDF.js sanitizes
 * these contours away. All other commands, order and coordinates stay exact;
 * no epsilon, curve simplification, registration or bounding-box shortcut. */
function filledCommands(path:unknown):Command[]|undefined {
 if(!path||typeof path!=='object'||!('commands'in path)||!Array.isArray(path.commands)||path.commands.length>100000)return;
 const result:Command[]=[];let contour:Command[]|undefined;
 for(const value of path.commands){
  if(!value||typeof value!=='object'||typeof value.command!=='string'||!(value.command in arity)||!Array.isArray(value.args)||value.args.length!==arity[value.command]||!value.args.every((x:unknown)=>typeof x==='number'&&Number.isFinite(x)))return;
  const cmd:Command={command:value.command,args:value.args};
  if(cmd.command==='moveTo'){if(contour)return;contour=[cmd];}
  else if(!contour)return;
  else {contour.push(cmd);if(cmd.command==='closePath'){if(contour.length!==2)result.push(...contour);contour=undefined;}}
 }
 if(contour)return;
 return result;
}
export function exactTrueTypeFillOutline(a:unknown,b:unknown):boolean {
 const left=filledCommands(a),right=filledCommands(b);if(!left||!right||left.length!==right.length)return false;
 return left.every((x,i)=>x.command===right[i].command&&x.args.length===right[i].args.length&&x.args.every((n,j)=>Object.is(n,right[i].args[j])));
}

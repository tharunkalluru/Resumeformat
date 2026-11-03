// Separate existing Playwright CLI session; never loads server credentials.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const name=process.argv[2];
if(process.argv.length!==3||!/^[a-z][a-z0-9-]*\.js$/.test(name))throw Error('Supply one purpose-scoped browser script filename.');
const code=readFileSync(join(root,'output/m3-live-ai-experience-native',name),'utf8');
const result=spawnSync(join(root,'node_modules/.bin/playwright-cli'),['-s=folio-m3-ai-native-experience','run-code',code],{cwd:root,stdio:'inherit'});
process.exitCode=result.status??1;

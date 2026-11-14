import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const scripts=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].filter(([,attrs])=>!attrs.includes('src='));
for(const [,attrs,source] of scripts){
  const args=['--check'];
  if(attrs.includes('module'))args.push('--input-type=module');
  const result=spawnSync(process.execPath,args,{input:source,encoding:'utf8'});
  if(result.status!==0){process.stderr.write(result.stderr);process.exit(1)}
}
console.log(`Syntax OK: ${scripts.length} inline script(s)`);

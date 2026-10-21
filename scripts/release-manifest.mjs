import process from 'node:process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const sha=process.env.GITHUB_SHA;
if(!/^[a-f0-9]{40}$/.test(sha || ''))throw new Error('A full source commit is required');
const images={};
for(const name of ['api','web','acceptance']){
  const tag=`elm-${name}:${sha}`;
  images[name]={tag,id:execFileSync('docker',['image','inspect',tag,'--format','{{.Id}}'],{encoding:'utf8'}).trim()};
}
const hashes={};
for(const name of ['images.tar.gz','acceptance.tar.gz','compose.app.yaml']){
  const hash=createHash('sha256');
  for await(const chunk of createReadStream(`evidence/ci/${name}`))hash.update(chunk);
  hashes[name]=hash.digest('hex');
}
await writeFile('evidence/ci/manifest.json',JSON.stringify({
  repository:'OvySwin/employee-lifecycle-management',source_commit:sha,
  ci_run:`${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`,
  images,sha256:hashes
},null,2)+'\n');

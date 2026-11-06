import {writeFile} from 'node:fs/promises';
import {runRound} from '../src/team.mjs';
import {initialState,digest} from '../src/core.mjs';
import {digitPacket,practiceCandidate} from '../src/demo.mjs';
import {blindChecklist,roundReview} from '../test/fixtures.mjs';
import {readFile} from 'node:fs/promises';
const packet=digitPacket();
const observation={checkedAt:new Date().toISOString(),executionKind:'test-double',target:'runRound non-Error adapter rejection',sourceDigest:digest(await readFile(new URL('../src/team.mjs',import.meta.url),'utf8')),inputFailure:'solver-b rejects null; solver-a and blind checklist complete'};
try{
  const result=await runRound(initialState(packet),{kind:'test-double',label:'Offline rejection reproduction only',prepareVerifier:async input=>blindChecklist(input.packet),solve:async input=>{if(input.role==='solver-b')throw null;return practiceCandidate(packet,[7,3],input.role,'discarded');},review:async input=>roundReview(input)});
  observation.result={status:result.report.status,candidates:result.state.candidates.length,reviews:result.state.reviews.length,errors:result.report.stages.filter(s=>s.status==='failed')};
}catch(error){observation.result={uncaught:true,name:error.name,message:error.message};}
await writeFile(process.argv[2],JSON.stringify(observation,null,2),{flag:'wx'});
console.log(JSON.stringify(observation,null,2));

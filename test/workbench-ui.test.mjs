import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRoute, groupQuestions, summarizeCandidates, chooseCandidate, filterSessions, esc, previewChoices, allowMotion } from '../web/app.js';

test('overview, deep links and skip anchors have separate routes; malformed links stay invalid', () => {
  assert.deepEqual(parseRoute(''), {kind:'home'});
  assert.deepEqual(parseRoute('#home'), {kind:'home'});
  assert.deepEqual(parseRoute('#main'), {kind:'anchor'});
  assert.deepEqual(parseRoute('#session-007'), {kind:'session',id:'session-007'});
  for (const hash of ['#%E0%A4%A', '#../secret', '#%3Cscript%3E', '#'+ 'x'.repeat(65)]) assert.deepEqual(parseRoute(hash),{kind:'invalid'});
});

test('open-question grouping preserves all distinct issues and affected candidate IDs', () => {
  const grouped=groupQuestions([
    {question:'Unique?',reason:'Four survive.',candidateId:'a'},
    {question:'Unique?',reason:'Four survive.',candidateId:'b'},
    {question:'Unique?',reason:'Four survive.',candidateId:'a'},
    {question:'Unique?',reason:'Source is unclear.',candidateId:'a'},
    {question:'Source?',reason:'Missing original.'}
  ]);
  assert.equal(grouped.length,3);
  assert.deepEqual([...grouped[0].candidates],['a','b']);
  assert.equal(grouped[1].reason,'Source is unclear.');
  assert.equal(grouped[2].candidates.size,0);
});

test('summary counts exact distinct answers separately from candidate records and preserves leading zeroes', () => {
  const summary=summarizeCandidates([{answer:'007'},{answer:'007'},{answer:'7'},{answer:'7,3'}],[{status:'review-ready'},{status:'review-ready'},{status:'rejected'},{status:'unresolved'}]);
  assert.deepEqual(summary,{records:4,distinct:3,ready:2});
  assert.deepEqual(summarizeCandidates([],[]),{records:0,distinct:0,ready:0});
});

test('candidate selection preserves an inspected rejected answer and recovers after changing sessions', () => {
  const loaded={state:{candidates:[{id:'bad'},{id:'open'},{id:'ready'}]},assessment:[{id:'bad',status:'rejected'},{id:'open',status:'unresolved'},{id:'ready',status:'review-ready'}]};
  assert.equal(chooseCandidate(loaded,'bad'),'bad');
  assert.equal(chooseCandidate(loaded,'stale'),'ready');
  loaded.assessment.pop(); loaded.state.candidates.pop();
  assert.equal(chooseCandidate(loaded,null),'open');
  assert.equal(chooseCandidate({state:{candidates:[]},assessment:[]},null),null);
});

test('session search distinguishes duplicate titles by ID and filters modes without altering records', () => {
  const sessions=[{id:'case-a',title:'A puzzle',mode:'practice'},{id:'case-b',title:'A puzzle',mode:'competition'}];
  assert.equal(filterSessions(sessions,' A PUZZLE ').length,2);
  assert.deepEqual(filterSessions(sessions,'case-b'),[sessions[1]]);
  assert.deepEqual(filterSessions(sessions,'practice'),[sessions[0]]);
  assert.deepEqual(filterSessions(sessions,'missing'),[]);
  assert.equal(sessions.length,2);
});

test('untrusted packet, evidence and session strings remain escaped text in UI templates', () => {
  assert.equal(esc('<img src=x onerror="bad()"> & \'quoted\''),'&lt;img src=x onerror=&quot;bad()&quot;&gt; &amp; &#39;quoted&#39;');
  assert.equal(esc(null),'');
  assert.equal(esc('007'),'007');
});


test('interactive preview uses actual matched practice records and never invents a missing alternative', () => {
 const loaded={state:{packet:{mode:'practice'},candidates:[{id:'a',answer:'007'},{id:'b',answer:'7'},{id:'c',answer:'007'}]},assessment:[{id:'b',status:'rejected'},{id:'a',status:'review-ready'},{id:'c',status:'review-ready'}]};
 assert.deepEqual(previewChoices(loaded).map(p=>[p.candidate.id,p.candidate.answer]),[['a','007'],['b','7']]);
 assert.equal(previewChoices(loaded)[0].assessment,loaded.assessment[1]);
 loaded.state.candidates=loaded.state.candidates.filter(c=>c.id!=='b');
 assert.equal(previewChoices(loaded).length,1);
 loaded.state.packet.mode='competition'; assert.deepEqual(previewChoices(loaded),[]);
 assert.deepEqual(previewChoices(null),[]);
});

test('motion respects system preference by default, with explicit per-visit opt-in or pause', () => {
 assert.equal(allowMotion(true),false); assert.equal(allowMotion(false),true);
 assert.equal(allowMotion(true,false),true); assert.equal(allowMotion(false,false),true);
 assert.equal(allowMotion(true,true),false); assert.equal(allowMotion(false,true),false);
});

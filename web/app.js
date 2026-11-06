export const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function parseRoute(hash) {
  let value; try { value = decodeURIComponent(hash.replace(/^#/, '')); } catch { return { kind:'invalid' }; }
  if (!value || value === 'home') return { kind:'home' };
  if (value === 'main') return { kind:'anchor' };
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(value) ? { kind:'session', id:value } : { kind:'invalid' };
}
export function groupQuestions(checks) {
  const groups = new Map();
  for (const check of checks) {
    const key = JSON.stringify([check.question, check.reason]);
    const group = groups.get(key) ?? { ...check, candidates:new Set() };
    if (check.candidateId) group.candidates.add(check.candidateId);
    groups.set(key,group);
  }
  return [...groups.values()];
}
export function summarizeCandidates(candidates, assessment) {
  return { records:candidates.length, distinct:new Set(candidates.map(c => c.answer)).size, ready:assessment.filter(a => a.status === 'review-ready').length };
}
export function chooseCandidate(loaded, selected) {
  return loaded.state.candidates.some(c => c.id === selected) ? selected : loaded.assessment.find(a => a.status === 'review-ready')?.id ?? loaded.assessment.find(a => a.status === 'unresolved')?.id ?? loaded.state.candidates[0]?.id ?? null;
}
export function filterSessions(sessions, query) {
  const needle = query.trim().toLocaleLowerCase();
  return sessions.filter(s => [s.title,s.mode,s.id].join(' ').toLocaleLowerCase().includes(needle));
}

const $ = id => document.getElementById(id);
const state = { token:'', models:null, sessions:[], loaded:null, candidateId:null, busy:false, loadVersion:0, view:'home', preview:null, previewCandidateId:null, motionPaused:null };
const statusNames = { 'review-ready':'Ready for review', unresolved:'Needs evidence', rejected:'Rejected', pass:'Passed', fail:'Failed', unknown:'Unknown', resolved:'Resolved' };
const badge = status => `<span class="badge ${status === 'review-ready' ? 'ready' : esc(status)}">${esc(statusNames[status] ?? status)}</span>`;
const roleName = role => role === 'solver-a' ? 'Approach A' : role === 'solver-b' ? 'Approach B' : String(role);
const dateLabel = value => new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(value));
async function api(path, options = {}) {
  let response;
  try { response = await fetch(path,{ ...options, headers:{ ...(options.body ? {'Content-Type':'application/json','X-ProofSprint-Token':state.token} : {}), ...options.headers } }); }
  catch { throw new Error('The local server is unavailable. Start the ProofSprint workbench, then reload this page to reconnect. Saved evidence remains on this computer.'); }
  let data;
  try { data = await response.json(); } catch { throw new Error('The local server returned an unreadable response. Reload the page to reconnect.'); }
  if (!response.ok) throw new Error(data.error ?? `Request failed (${response.status}).`);
  return data;
}
function notice(message, error = false) {
  $('notice').textContent = message; $('notice').classList.toggle('error',error); $('notice').hidden = !message;
}
async function perform(message, task) {
  if (state.busy) return;
  state.busy = true; document.body.classList.add('busy'); $('main').setAttribute('aria-busy','true'); notice(message);
  const buttons = [...document.querySelectorAll('[data-practice],#import-submit,#run-round,#refresh-sessions')].filter(b => !b.disabled);
  document.querySelectorAll('.operation-error').forEach(p=>p.remove());
  buttons.forEach(b => { b.disabled = true; });
  try { await task(); } catch (error) {
    notice(error.message,true);
    const dialog=document.querySelector('dialog[open]');
    if(dialog && dialog.id !== 'import-dialog') {
      const feedback=document.createElement('p'); feedback.className='notice error operation-error'; feedback.setAttribute('role','alert'); feedback.textContent=error.message;
      dialog.querySelector('h2')?.after(feedback);
    }
  }
  finally { state.busy=false; document.body.classList.remove('busy'); $('main').removeAttribute('aria-busy'); buttons.forEach(b => { if(b.isConnected) b.disabled=false; }); }
}
function openDialog(id) {
  if (state.busy && id !== 'models-dialog') return;
  const dialog=$(id);
  if (id === 'sessions-dialog') { $('session-search').value=''; renderSessions(); }
  if (!dialog.open) dialog.showModal();
  if (id === 'sessions-dialog') $('session-search').focus();
}
function showView(view) {
  state.view=view; document.body.dataset.view=view; $('welcome').hidden=view !== 'home'; $('workspace').hidden=view !== 'workspace';
  $('home-nav').setAttribute('aria-current',view === 'home' ? 'page' : 'false');
  $('resume-session').setAttribute('aria-current',view === 'workspace' ? 'page' : 'false');
}
function showHome() {
  ++state.loadVersion; showView('home'); document.title='ProofSprint — Keep the proof.'; $('main').removeAttribute('aria-busy'); renderRecent();
  window.scrollTo({top:0,behavior:'instant'});
}
function sessionRow(session) {
  return `<button class="session ${state.loaded?.id === session.id ? 'active' : ''}" data-session="${esc(session.id)}" ${state.loaded?.id === session.id ? 'aria-current="true"' : ''}><span><span class="session-title">${esc(session.title)}</span><span class="session-meta">${session.mode === 'competition' ? 'Competition packet' : session.mode === 'practice' ? 'Practice' : 'Needs attention'} · ${esc(dateLabel(session.modified))} · ${esc(session.id.slice(0,8))}</span></span><span class="session-count">${session.error ? 'Check saved data' : `<b>${session.candidates}</b> proposals`} <span aria-hidden="true">↗</span></span></button>`;
}
function renderSessions() {
  const filtered=filterSessions(state.sessions,$('session-search').value);
  $('session-results').textContent = `${filtered.length} of ${state.sessions.length} sessions`;
  $('session-list').innerHTML=filtered.length ? filtered.map(sessionRow).join('') : `<p class="empty-message">${state.sessions.length ? 'No matching sessions. Try a title, practice, competition or an ID.' : 'Your notebook is empty. Try a practice case or import a puzzle.'}</p>`;
}
function renderRecent() {
  $('recent-sessions').innerHTML=state.sessions.length ? state.sessions.slice(0,3).map(sessionRow).join('') : '<p class="empty-message">A fresh notebook. Start a practice case above to save your first evidence trail.</p>';
  const latest=state.sessions.find(s => !s.error);
  $('resume-session').hidden=!latest;
}
async function refreshSessions() { state.sessions=await api('/api/sessions'); renderSessions(); renderRecent(); }
async function loadSession(id, {push=true, focus=true}={}) {
  const version=++state.loadVersion;
  $('main').setAttribute('aria-busy','true');
  try {
    const loaded=await api(`/api/sessions/${encodeURIComponent(id)}`);
    if(version !== state.loadVersion) return;
    state.loaded=loaded; state.candidateId=chooseCandidate(loaded,state.candidateId);
    if(push && location.hash !== `#${id}`) history.pushState(null,'',`#${encodeURIComponent(id)}`);
    showView('workspace'); renderWorkspace(); renderSessions(); renderRecent();
    document.querySelector('.source-panel').open = !window.matchMedia('(max-width:600px)').matches;
    document.title=`${loaded.state.packet.title} — ProofSprint`;
    if(focus) { $('case-title').focus({preventScroll:true}); window.scrollTo({top:0,behavior:'instant'}); }
  } finally { if(version === state.loadVersion) $('main').removeAttribute('aria-busy'); }
}
async function followRoute() {
  if(state.busy) return;
  const route=parseRoute(location.hash);
  if(route.kind === 'home') { showHome(); notice(''); return; }
  if(route.kind === 'anchor') return;
  if(route.kind === 'invalid') { showHome(); notice('This session link is not valid. Open a saved session or start a practice case.',true); return; }
  if(route.id === state.loaded?.id) { showView('workspace'); document.title=`${state.loaded.state.packet.title} — ProofSprint`; return; }
  try { state.candidateId=null; await loadSession(route.id,{push:false,focus:false}); notice(''); }
  catch(error) { showHome(); notice(error.message,true); }
}
export function previewChoices(loaded) {
  if (!loaded || loaded.state.packet.mode !== 'practice') return [];
  return ['review-ready','rejected'].map(status => {
    const assessment = loaded.assessment.find(a => a.status === status);
    const candidate = loaded.state.candidates.find(c => c.id === assessment?.id);
    return assessment && candidate ? {assessment,candidate} : null;
  }).filter(Boolean);
}
async function renderPreview() {
  const sample=state.sessions.find(s => !s.error && s.mode === 'practice' && s.title === 'Published practice: Project Euler problem 1');
  if(!sample) return;
  try {
    const loaded=await api(`/api/sessions/${encodeURIComponent(sample.id)}`);
    if(!previewChoices(loaded).length) return;
    state.preview=loaded; state.previewCandidateId=previewChoices(loaded)[0].candidate.id;
    renderInteractivePreview();
  } catch { /* Keep the practice invitation if the saved example cannot be read. */ }
}
function renderInteractivePreview() {
  const choices=previewChoices(state.preview);
  if(!choices.length) return;
  const selected=choices.find(c=>c.candidate.id===state.previewCandidateId) ?? choices[0];
  const {assessment,candidate}=selected;
  const checks=assessment.review?.checks ?? candidate.checks;
  const ready=assessment.status==='review-ready';
  const shortConditions={boundary:'Strictly below 1000',union:'Count each value once',sum:'The exact integer sum'};
  $('home-preview').innerHTML=`<div class="lab-card-heading"><span class="lab-dot" aria-hidden="true"></span><h2 id="specimen-title">A tiny proof lab</h2><span class="lab-card-index">01</span></div><div class="lab-question"><span class="micro-label">THE QUESTION</span><p>${esc(state.preview.state.packet.text)}</p></div><div class="lab-answer-picker"><span class="micro-label" id="preview-picker-label">PICK AN ANSWER</span><div class="preview-choices" role="group" aria-labelledby="preview-picker-label">${choices.map(c=>`<button data-preview-candidate="${esc(c.candidate.id)}" aria-pressed="${c.candidate.id===candidate.id}" aria-controls="preview-result"><span>${esc(c.candidate.answer)}</span><span class="choice-arrow" aria-hidden="true">↗</span></button>`).join('')}</div></div><div id="preview-result" class="preview-result ${ready ? 'is-ready' : 'is-rejected'}" aria-live="polite"><div class="result-head"><span class="result-symbol" aria-hidden="true">${ready ? '✓' : '×'}</span><div><strong>${ready ? 'It holds up to these checks.' : 'This one falls short.'}</strong><span>${ready ? 'Recorded checks passed. Your review still matters.' : 'A recorded constraint failed. Inspect the evidence.'}</span></div></div><ul class="lab-checks">${checks.map(c=>`<li class="${esc(c.status)}"><span aria-hidden="true">${c.status==='pass' ? '✓' : c.status==='fail' ? '×' : '?'}</span><span>${esc(shortConditions[c.constraintId] ?? state.preview.state.packet.constraints.find(p=>p.id===c.constraintId)?.description ?? c.constraintId)}</span><b>${esc(statusNames[c.status] ?? c.status)}</b></li>`).join('')}</ul></div><div class="lab-card-footer"><span>Saved practice.<br>No live AI running.</span><button class="text-button" data-session="${esc(state.preview.id)}" data-preview-open="${esc(candidate.id)}">Open the full proof <span aria-hidden="true">↗</span></button></div>`;
}
export function allowMotion(prefersReducedMotion, paused = null) { return paused === null ? !prefersReducedMotion : !paused; }
let motionPreference;
function motionAllowed() { return allowMotion(motionPreference?.matches ?? true,state.motionPaused); }
function animateElement(element, keyframes, options={}) {
  if(!element || !motionAllowed()) return;
  element.animate(keyframes,{duration:350,easing:'cubic-bezier(.2,.7,.2,1)',...options});
}
function installMotion() {
  motionPreference=window.matchMedia('(prefers-reduced-motion: reduce)');
  const update=()=>{
    const enabled=motionAllowed();
    document.body.dataset.motion=enabled ? 'on' : 'off';
    $('motion-toggle').setAttribute('aria-pressed',String(enabled));
    $('motion-toggle').setAttribute('aria-label',enabled ? 'Pause animations' : 'Enable animations');
    $('motion-toggle').querySelector('.motion-label').textContent=enabled ? 'Motion on' : 'Motion off';
    $('motion-toggle').querySelector('.motion-icon').textContent=enabled ? 'Ⅱ' : '▷';
    $('motion-toggle').title=motionPreference.matches && state.motionPaused === null ? 'Reduced motion is on in your system. Enable effects here only if you want them.' : 'Motion preference applies to this visit only.';
    if(!enabled) { document.getAnimations().forEach(animation=>animation.cancel()); document.querySelector('.lab-stage').style.removeProperty('--tilt-x'); document.querySelector('.lab-stage').style.removeProperty('--tilt-y'); }
  };
  $('motion-toggle').addEventListener('click',()=>{state.motionPaused=motionAllowed(); update();});
  motionPreference.addEventListener('change',update); update();
  const stage=document.querySelector('.lab-stage');
  let pointerFrame;
  stage.addEventListener('pointermove',event=>{
    if(!motionAllowed() || event.pointerType==='touch' || !window.matchMedia('(hover:hover)').matches) return;
    cancelAnimationFrame(pointerFrame);
    const rect=stage.getBoundingClientRect(),x=(event.clientX-rect.left)/rect.width-.5,y=(event.clientY-rect.top)/rect.height-.5;
    pointerFrame=requestAnimationFrame(()=>{stage.style.setProperty('--tilt-x',(-y*4).toFixed(2)+'deg');stage.style.setProperty('--tilt-y',(x*4).toFixed(2)+'deg');});
  });
  stage.addEventListener('pointerleave',()=>{cancelAnimationFrame(pointerFrame);stage.style.setProperty('--tilt-x','0deg');stage.style.setProperty('--tilt-y','0deg');});
  const observer=new IntersectionObserver(entries=>entries.forEach(entry=>{
    if(!entry.isIntersecting) return;
    animateElement(entry.target,[{opacity:0,transform:'translateY(22px)'},{opacity:1,transform:'translateY(0)'}],{duration:550});
    observer.unobserve(entry.target);
  }),{threshold:.12});
  document.querySelectorAll('.practice-row,.section-heading,.method-strip').forEach(e=>observer.observe(e));
}

function renderModels() {
  const models=state.models;
  $('model-label').textContent=models?.ready ? 'Models ready' : 'Live models unavailable';
  $('model-status').classList.toggle('ready',Boolean(models?.ready));
  document.body.classList.toggle('models-ready',Boolean(models?.ready));
  $('run-round').innerHTML=models?.ready ? 'Run model round <span aria-hidden="true">↗</span>' : 'Model setup <span aria-hidden="true">↗</span>';
  $('models-content').innerHTML=`<div class="status-box"><strong>${models?.ready ? 'Model requests are enabled in this server.' : 'Practice is ready. Live analysis needs setup.'}</strong><p>${models?.ready ? 'Each round uses separate model requests and saves completed evidence.' : 'Model access must be configured and enabled in the local server environment. Do not enter credentials on this page.'}</p>${models?.reasons?.length ? `<ul>${models.reasons.map(reason=>`<li>${esc(reason)}</li>`).join('')}</ul>` : ''}</div><div class="detail-label">Configured roles</div><ul class="next-list">${[['solver-a','Approach A'],['solver-b','Approach B'],['verifier','Independent review']].map(([key,label])=>`<li><strong>${label}</strong><small>${esc(models?.models?.[key] ?? 'Not configured')}</small></li>`).join('')}</ul><p class="scope-note">Opening this notebook never starts a model request. Practice records are not measurements of live model performance.</p>`;
}
function checkRows(checks, descriptions) {
  return `<ul class="check-list">${checks.map(check=>`<li class="check-row"><span class="check-symbol ${esc(check.status)}" aria-hidden="true">${['pass','resolved'].includes(check.status) ? '✓' : check.status === 'fail' ? '×' : '?'}</span><div><strong>${esc(descriptions(check))}</strong><small>${esc(statusNames[check.status] ?? check.status)} · ${check.evidenceIds?.length ? `Evidence: ${check.evidenceIds.map(esc).join(', ')}` : 'No evidence linked'}</small><details><summary>Why this check ${check.status === 'pass' ? 'passed' : check.status === 'fail' ? 'failed' : 'has this status'}</summary><p class="prose">${esc(check.reason)}</p></details></div></li>`).join('')}</ul>`;
}
function renderCandidates() {
  const {candidates}=state.loaded.state;
  $('candidate-count').textContent=candidates.length;
  let picker=$('candidate-picker');
  if(!picker) {
    picker=document.createElement('select'); picker.id='candidate-picker'; picker.className='candidate-picker';
    picker.setAttribute('aria-labelledby','candidate-heading'); picker.setAttribute('aria-controls','candidate-detail');
    $('candidate-list').before(picker);
    picker.addEventListener('change',()=>{if(state.busy) return; state.candidateId=picker.value; renderCandidates(); renderCandidateDetail();});
  }
  picker.hidden=!candidates.length;
  picker.innerHTML=candidates.map((c,i)=>`<option value="${esc(c.id)}">${i+1} · ${esc(roleName(c.role))} · ${esc(c.answer)} · ${esc(statusNames[loadedStatus(c.id)])}</option>`).join('');
  picker.value=state.candidateId ?? '';
  $('candidate-list').innerHTML=candidates.length ? candidates.map((candidate,i)=>{
    const assessment=state.loaded.assessment.find(a=>a.id===candidate.id);
    return `<button class="candidate ${state.candidateId === candidate.id ? 'active' : ''}" data-candidate="${esc(candidate.id)}" aria-pressed="${state.candidateId === candidate.id}" aria-controls="candidate-detail"><span class="candidate-role">${String(i+1).padStart(2,'0')} / ${esc(roleName(candidate.role))}</span><span class="candidate-answer">${esc(candidate.answer)}</span>${badge(assessment.status)}</button>`;
  }).join('') : '<p class="empty-candidates">No proposed answers yet. Model setup explains how to enable a round. Existing CLI tools can also add evidence.</p>';
}
function loadedStatus(id) { return state.loaded.assessment.find(a=>a.id===id)?.status ?? 'unresolved'; }
function renderCandidateDetail() {
  const loaded=state.loaded;
  const {packet,candidates}=loaded.state;
  const candidate=candidates.find(c=>c.id===state.candidateId);
  if(!candidate) { $('candidate-detail').innerHTML='<div class="empty-detail"><span class="eyebrow">SOURCE CAPTURED</span><h2>Give the answer room<br>to earn trust.</h2><p class="quiet">Your original packet is saved. Proposals and evidence will appear here when a round is recorded. You can try a practice case while live analysis is unavailable.</p><button class="text-button" data-open="practice-dialog">Explore practice cases →</button></div>'; return; }
  const assessment=loaded.assessment.find(a=>a.id===candidate.id);
  const review=assessment.review;
  const checks=review?.checks ?? candidate.checks;
  const evidence=review?.evidence ?? candidate.evidence;
  const isReady=assessment.status==='review-ready';
  $('candidate-detail').innerHTML=`<div class="answer-top"><div><div class="answer-label">${esc(roleName(candidate.role).toUpperCase())} / EXACT PROPOSED ANSWER</div><div class="exact-answer">${esc(candidate.answer)}</div></div>${badge(assessment.status)}</div><div class="decision-note ${esc(assessment.status)}"><div><strong>${isReady ? 'Recorded structural checks passed.' : assessment.status === 'rejected' ? 'This answer does not pass the recorded checks.' : 'The answer is still open.'}</strong><p>${isReady ? 'Review the reasoning and source quality before relying on this draft.' : esc(assessment.reasons[0] ?? 'More evidence is needed before a draft can be prepared.')}</p></div><button class="button ${isReady ? 'primary' : 'secondary'}" id="review-draft" ${isReady ? '' : 'disabled'}>${isReady ? 'Review draft ↗' : 'Draft blocked'}</button></div><nav class="proof-nav" aria-label="Jump within this proof"><button data-proof-section="proof-reasoning">Reasoning</button><button data-proof-section="proof-checks">Checks</button><button data-proof-section="proof-evidence">Evidence</button></nav><div id="proof-reasoning" tabindex="-1" class="detail-label">The reasoning</div><p class="prose">${esc(candidate.reasoning)}</p>${candidate.assumptions.length ? `<div class="detail-label">Unresolved assumptions</div><p class="prose">${candidate.assumptions.map(esc).join('\n')}</p>` : ''}<details id="proof-checks" tabindex="-1" class="checks" open><summary>${review ? 'Recorded constraint checks' : 'Solver claims · awaiting independent review'}</summary>${checkRows(checks,c=>packet.constraints.find(p=>p.id===c.constraintId)?.description ?? c.constraintId)}</details>${review?.blindReview ? `<details class="checks"><summary>Blind checklist · ${review.blindReview.requirementChecks.length} requirements</summary><p class="scope-note">Stored checklist and review. This label does not attest to an independent human review.</p>${checkRows(review.blindReview.requirementChecks,c=>review.blindReview.checklist.requirements.find(r=>r.id===c.itemId)?.description ?? c.itemId)}${review.blindReview.ambiguityChecks.length ? `<div class="detail-label">Initial ambiguities</div>${checkRows(review.blindReview.ambiguityChecks,c=>review.blindReview.checklist.ambiguities.find(a=>a.id===c.itemId)?.description ?? c.itemId)}` : ''}</details>` : '<p class="scope-note">Supplied-constraint review. This record has no stored blind checklist.</p>'}${review ? `<details class="checks"><summary>Reproduction &amp; uniqueness</summary><p class="prose">${esc(review.reproduction)}</p><p class="scope-note"><strong>Uniqueness: ${esc(review.uniqueness.status)}.</strong> ${esc(review.uniqueness.reason)}</p>${review.openIssues.length ? `<p class="prose">Open issues: ${review.openIssues.map(esc).join('; ')}</p>` : ''}</details>` : ''}<div id="proof-evidence" tabindex="-1" class="detail-label">Follow the evidence</div><div class="evidence-grid">${evidence.map(e=>{const source=packet.sources.find(s=>s.id===e.sourceId);return `<article class="evidence"><span class="evidence-id">${esc(e.id)}</span><strong>${esc(source?.label ?? 'Original puzzle')}</strong><blockquote>${esc(e.quote)}</blockquote><p>${esc(e.claim)}</p><small>${esc(source?.origin ?? 'Supplied prompt')} · ${esc(source?.kind ?? 'puzzle text')}</small></article>`;}).join('') || '<p class="quiet">No traceable evidence has been recorded.</p>'}</div>`;
}
function renderWorkspace() {
  const loaded=state.loaded;
  if(!loaded) return;
  const {packet,candidates,reviews,revision}=loaded.state;
  const summary=summarizeCandidates(candidates,loaded.assessment);
  const questions=groupQuestions(loaded.nextChecks);
  $('case-meta').textContent=`${packet.mode === 'practice' ? 'PRACTICE RECORD' : 'SUPPLIED COMPETITION PACKET'} / ${packet.version} / ${loaded.id.slice(0,8)}`;
  $('case-title').textContent=packet.title;
  $('case-description').textContent=packet.mode === 'practice' ? 'Saved practice evidence. Inspect the source and method; these records do not measure live AI performance.' : 'Supplied source and recorded checks. This label does not verify event release or eligibility.';
  $('workflow').innerHTML=[['Source',`${packet.constraints.length} conditions saved`,true],['Proposals',`${candidates.length} records saved`,candidates.length>0],['Review',`${reviews.length} reviews recorded`,reviews.length>0],['Draft',summary.ready ? 'Human review needed' : 'Waiting on evidence',summary.ready>0]].map(([title,detail,done],i)=>`<div class="workflow-step ${done ? 'done' : ''}"><span class="step-number" aria-hidden="true">${done ? '✓' : String(i+1).padStart(2,'0')}</span><div><strong>${title}</strong><small>${esc(detail)}</small></div></div>`).join('');
  $('source-content').innerHTML=`<div class="source-layout"><div><div class="source-body" tabindex="0" aria-label="Original puzzle text">${esc(packet.text)}</div><div class="source-tags">${packet.sources.length} sources · ${loaded.sourceLineage.length} declared origins · revision ${revision}</div></div><ol class="source-conditions">${packet.constraints.map(c=>`<li>${esc(c.description)}</li>`).join('')}</ol></div>`;
  $('case-stats').innerHTML=`<strong>${summary.records}</strong> proposals · <strong>${summary.distinct}</strong> distinct answers<br><strong>${summary.ready}</strong> ready for review · <strong>${questions.length}</strong> open questions`;
  renderCandidates(); renderCandidateDetail();
  animateElement($('workspace'),[{opacity:.2,transform:'translateY(10px)'},{opacity:1,transform:'translateY(0)'}]);
  $('next-checks').innerHTML=questions.length ? `<ul class="next-list">${questions.map(c=>`<li><strong>${esc(c.question)}</strong><small>${esc(c.reason)}</small>${c.candidates.size>1 ? `<small>Applies to ${c.candidates.size} candidate records.</small>` : ''}</li>`).join('')}</ul>` : `<div class="clear-state"><span class="check-symbol" aria-hidden="true">${summary.ready ? '✓' : '→'}</span><div><strong>${summary.ready ? 'The recorded checks are complete. Your review comes next.' : 'Begin with independent proposals.'}</strong><p>${summary.ready ? 'Read the reasoning, check source quality, and inspect the draft. No human review is claimed here.' : 'Unresolved questions appear here once candidates are recorded.'}</p></div></div>`;
}
function initialize() {
  installMotion();
  window.addEventListener('hashchange',followRoute);
  window.addEventListener('popstate',()=>{ /* hashchange handles back/forward for these hash routes. */ });
  document.addEventListener('keydown',event=>{
    const modal=document.querySelector('dialog[open]');
    if(event.key==='Tab' && modal) {
      const stops=[...modal.querySelectorAll('a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])')].filter(e=>e.getClientRects().length && getComputedStyle(e).visibility!=='hidden');
      const first=stops[0],last=stops.at(-1);
      if(first && event.shiftKey && document.activeElement===first) { event.preventDefault(); last.focus(); }
      else if(last && !event.shiftKey && document.activeElement===last) { event.preventDefault(); first.focus(); }
    }
    if((event.ctrlKey || event.metaKey) && event.key.toLowerCase()==='k' && !event.altKey) {
      if(document.querySelector('dialog[open]')) return;
      event.preventDefault(); openDialog('sessions-dialog');
    }
  });
  document.addEventListener('click',async event=>{
    const close=event.target.closest('[data-close]'); if(close) return close.closest('dialog').close();
    if(state.busy) { if(event.target.closest('a[href^="#"]')) event.preventDefault(); return; }
    const previewChoice=event.target.closest('[data-preview-candidate]');
    if(previewChoice) {
      state.previewCandidateId=previewChoice.dataset.previewCandidate; renderInteractivePreview();
      document.querySelector(`[data-preview-candidate="${CSS.escape(state.previewCandidateId)}"]`)?.focus({preventScroll:true});
      animateElement($('preview-result'),[{opacity:.3,transform:'translateY(8px)'},{opacity:1,transform:'translateY(0)'}]);
      return;
    }
    const sectionJump=event.target.closest('[data-proof-section]');
    if(sectionJump) {
      const target=$(sectionJump.dataset.proofSection); if(target) { if(target.tagName==='DETAILS') target.open=true; target.scrollIntoView({behavior:motionAllowed()?'smooth':'instant',block:'start'}); target.focus({preventScroll:true}); }
      return;
    }
    const open=event.target.closest('[data-open]'); if(open) return openDialog(open.dataset.open);
    const session=event.target.closest('[data-session]');
    if(session) {
      await perform('Opening the saved evidence trail.',async()=>{state.candidateId=session.dataset.previewOpen ?? null; await loadSession(session.dataset.session); $('sessions-dialog').close(); $('case-title').focus({preventScroll:true}); notice('');}); return;
    }
    const candidate=event.target.closest('[data-candidate]');
    if(candidate) { state.candidateId=candidate.dataset.candidate; renderCandidates(); renderCandidateDetail(); animateElement($('candidate-detail'),[{opacity:.3,transform:'translateX(8px)'},{opacity:1,transform:'translateX(0)'}]); document.querySelector(`[data-candidate="${CSS.escape(state.candidateId)}"]`).focus({preventScroll:true}); return; }
    const practice=event.target.closest('[data-practice]');
    if(practice) return perform('Calculating locally and saving the practice evidence…',async()=>{
      $('practice-progress').textContent='Calculating locally. No AI model is called.';
      const result=await api('/api/practice',{method:'POST',body:JSON.stringify({kind:practice.dataset.practice})});
      $('practice-dialog').close(); state.candidateId=null; await refreshSessions(); await loadSession(result.sessionId);
      await renderPreview(); $('practice-progress').textContent=''; notice('Practice saved. Deterministic local calculations; no AI model was called.');
    });
    if(event.target.closest('#review-draft') && state.loaded && state.candidateId) return perform('Preparing an unsent draft.',async()=>{
      const path=`/api/sessions/${encodeURIComponent(state.loaded.id)}/draft/${encodeURIComponent(state.candidateId)}`;
      const result=await api(path); $('draft-content').textContent=result.draft; $('download-draft').href=`${path}?download=1`;
      $('draft-dialog').showModal(); notice('Draft prepared for your review. Nothing was submitted.');
    });
  });
  $('session-search').addEventListener('input',renderSessions);
  $('model-status').addEventListener('click',()=>openDialog('models-dialog'));
  $('resume-session').addEventListener('click',()=>perform('Opening your workbench.',async()=>{
    const id=state.loaded?.id ?? state.sessions.find(s=>!s.error)?.id;
    if(id) await loadSession(id); notice('');
  }));
  $('refresh-sessions').addEventListener('click',()=>perform('Refreshing saved sessions.',async()=>{await refreshSessions(); notice('Sessions refreshed.');}));
  $('load-example').addEventListener('click',()=>{
    $('packet-json').value=JSON.stringify({id:'practice-literal',version:'1',title:'Practice: preserve an exact answer',mode:'practice',answerMode:'unique',text:'Return exactly the three-character string 007.',constraints:[{id:'literal',description:'Return the exact characters 007, including both leading zeros.'}],sources:[]},null,2);
    $('packet-json').removeAttribute('aria-invalid'); $('import-error').hidden=true; $('packet-json').focus();
  });
  $('import-form').addEventListener('submit',async event=>{
    event.preventDefault(); if(state.busy) return;
    $('import-error').hidden=true; $('packet-json').removeAttribute('aria-invalid');
    let packet;
    try { packet=JSON.parse($('packet-json').value); }
    catch { $('import-error').textContent='This is not valid JSON. Check commas, quotes and braces, or use the practice example.'; $('import-error').hidden=false; $('packet-json').setAttribute('aria-invalid','true'); $('packet-json').focus(); return; }
    await perform('Validating and saving the original puzzle.',async()=>{
      try { const result=await api('/api/sessions',{method:'POST',body:JSON.stringify({packet})}); $('import-dialog').close(); state.candidateId=null; await refreshSessions(); await loadSession(result.sessionId); notice('Original packet saved. Its source version is recorded. No analysis has run.'); }
      catch(error) { $('import-error').textContent=error.message; $('import-error').hidden=false; $('packet-json').setAttribute('aria-invalid','true'); $('packet-json').focus(); throw error; }
    });
  });
  $('run-round').addEventListener('click',()=>{
    if(state.busy) return;
    if(!state.models?.ready) return openDialog('models-dialog');
    $('usage-confirm').checked=false;
    $('run-description').innerHTML=`<div class="status-box"><p>Up to <strong>${state.models.maxCallsPerRound} generation requests</strong>, each capped at <strong>${state.models.maxOutputTokensPerCall.toLocaleString()} output tokens</strong> and ${state.models.timeoutMs/1000} seconds. Automatic retries: ${state.models.automaticRetries}.</p><ul>${Object.entries(state.models.models).map(([role,model])=>`<li>${esc(role)}: ${esc(model)}</li>`).join('')}</ul></div>`;
    openDialog('run-dialog');
  });
  $('run-form').addEventListener('submit',async event=>{
    event.preventDefault(); if(!$('usage-confirm').checked || !state.loaded || state.busy) return;
    const {id,state:{revision}}=state.loaded; $('run-dialog').close();
    await perform('Running one bounded model round. Completed evidence is saved; this may take several minutes.',async()=>{
      const result=await api(`/api/sessions/${encodeURIComponent(id)}/run`,{method:'POST',body:JSON.stringify({expectedRevision:revision,confirmModelUsage:true})});
      state.candidateId=null; await refreshSessions(); await loadSession(id);
      notice(result.status==='completed' ? 'Round complete. Inspect the saved reasoning and checks.' : 'The round finished partially. '+result.stages.filter(s=>s.status==='failed').map(s=>s.role+': '+s.error).join(' / ')+' Inspect saved evidence before trying again.',result.status!=='completed');
    });
  });
  (async()=>{
    try {
      const bootstrap=await api('/api/bootstrap'); state.token=bootstrap.token; state.models=bootstrap.models; renderModels();
      await refreshSessions(); await followRoute(); await renderPreview();
    } catch(error) { showHome(); notice('The local notebook could not connect. Your saved evidence is retained. '+error.message,true); $('model-label').textContent='Server unavailable'; $('recent-sessions').innerHTML='<p class="empty-message">Saved sessions are unavailable until the local server reconnects. Reload to try again.</p>'; }
  })();
}
if(typeof document !== 'undefined') initialize();

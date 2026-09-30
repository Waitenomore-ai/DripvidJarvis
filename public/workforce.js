'use strict';

const icons={jarvis:'🧠',sosh:'📱',scout:'🔎',dev:'💻',ops:'🖥️'};
let lastState=null;

async function loadWorkforceState(){
  const response=await fetch('/api/workforce/state',{cache:'no-store'});
  if(!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function esc(value){return String(value??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]));}
function employeeCard(e){return `<button class="agent" data-employee="${esc(e.id)}"><div class="avatar">${icons[e.id]||'🤖'}</div><strong>${esc(e.name)}</strong><div class="state ${esc(e.state)}">${esc(e.state.replaceAll('_',' '))}</div></button>`;}
function renderWorkforceState(state){
  lastState=state;
  const employees=state.employees||[];
  document.getElementById('employeeCount').textContent=employees.length;
  for(const room of ['command-centre','social-studio','research-lab','dev-workshop','ops-room']){
    const el=document.getElementById(room); if(!el) continue;
    const members=employees.filter(e=>e.room===room);
    el.innerHTML=members.length?members.map(employeeCard).join(''):'<span class="state">No employee assigned</span>';
  }
  const tasks=state.tasks||[];
  document.getElementById('task-hub').innerHTML=tasks.length?`<div class="task-list">${tasks.slice(0,6).map(t=>`<div class="task" data-task="${esc(t.id)}"><b>${esc(t.title)}</b><small>${esc(t.status)} · ${esc(t.employeeId)}</small><div class="bar"><i style="width:${Math.max(0,Math.min(100,Number(t.progress)||0))}%"></i></div></div>`).join('')}</div>`:'<span class="state">No active tasks — workforce idle</span>';
  document.getElementById('activityList').innerHTML=(state.activity||[]).slice(0,8).map(a=>`<div class="event"><b>${esc(a.type)}</b><p>${esc(a.title||a.employeeId||a.error||'Workforce event')}</p></div>`).join('')||'<div class="event"><p>No activity yet.</p></div>';
  document.getElementById('connection').textContent='Live';
  document.getElementById('updated').textContent=`Updated ${new Date(state.updatedAt||Date.now()).toLocaleTimeString()}`;
  document.querySelectorAll('.agent').forEach(el=>el.addEventListener('click',()=>selectEmployee(el.dataset.employee)));
  document.querySelectorAll('.task').forEach(el=>el.addEventListener('click',()=>selectTask(el.dataset.task)));
}
function selectEmployee(id){const e=(lastState?.employees||[]).find(x=>x.id===id);if(!e)return;document.getElementById('detail').innerHTML=`<h3>${icons[id]||'🤖'} ${esc(e.name)}</h3><p><b>${esc(e.role)}</b><br>${esc(e.description)}<br><br>Status: <strong>${esc(e.state)}</strong></p>`;}
function selectTask(id){const t=(lastState?.tasks||[]).find(x=>x.id===id);if(!t)return;document.getElementById('detail').innerHTML=`<h3>📋 ${esc(t.title)}</h3><p>${esc(t.description)}<br><br>${esc(t.employeeId)} · ${esc(t.status)} · ${Number(t.progress)||0}%</p>`;}
function renderOffline(){document.getElementById('connection').textContent='Offline';}
async function startWorkforcePolling(){try{renderWorkforceState(await loadWorkforceState())}catch{renderOffline()}setInterval(async()=>{try{renderWorkforceState(await loadWorkforceState())}catch{renderOffline()}},3000)}
window.loadWorkforceState=loadWorkforceState;window.renderWorkforceState=renderWorkforceState;window.startWorkforcePolling=startWorkforcePolling;startWorkforcePolling();

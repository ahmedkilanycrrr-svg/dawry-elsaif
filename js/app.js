const STORAGE_KEY = "tournament-data";
let state = null;
let ui = { tab:"home", isAdmin:false, showLogin:false, showReset:false, toast:null };

function defaultData(){
  return {
    settings:{ name:"دوري الصيف", password:"admin2026", drawDone:false, groupStageComplete:false },
    teams:[],
    groups:[],
    matchesGroup:[],
    matchesKnockout:[]
  };
}

// docRef ييجي من js/firebase-config.js (لازم يتحمل قبل الملف ده)
let suppressNextSnapshot = false;

function listenForData(){
  if(typeof docRef === "undefined"){
    document.getElementById("view").innerHTML =
      '<p class="empty-note">لسه معملتش ربط Firebase. افتح ملف js/firebase-config.js واملأ بياناتك (الشرح في README.md).</p>';
    return;
  }
  docRef.onSnapshot((snap)=>{
    if(snap.exists){
      state = snap.data().payload ? JSON.parse(snap.data().payload) : defaultData();
    } else {
      state = defaultData();
    }
    render();
  }, (err)=>{
    console.error(err);
    document.getElementById("view").innerHTML =
      '<p class="empty-note">تعذر الاتصال بقاعدة البيانات. تأكد من بيانات js/firebase-config.js وقواعد الأمان في Firestore.</p>';
  });
}

async function saveData(){
  try{
    await docRef.set({ payload: JSON.stringify(state) });
    // onSnapshot هيستقبل النسخة الجديدة ويعمل render لوحده عند الكل (بمن فيهم أنت)
  }catch(e){
    console.error(e);
    showToast("تعذر الحفظ، تأكد من اتصال الإنترنت");
    render();
  }
}

function showToast(msg){
  ui.toast = msg;
  render();
  setTimeout(()=>{ ui.toast=null; render(); }, 2200);
}

function uid(){ return Date.now().toString(36)+Math.random().toString(36).slice(2,7); }
function esc(s){ return (s||"").replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }

/* ---------------- TEAMS ---------------- */
function addTeam(){
  const nameEl = document.getElementById("newTeamName");
  const lvlEl = document.getElementById("newTeamLevel");
  const name = nameEl.value.trim();
  if(!name){ showToast("اكتب اسم الفريق"); return; }
  if(state.teams.length>=32){ showToast("العدد وصل 32 فريق بالفعل"); return; }
  if(state.settings.drawDone){ showToast("القرعة اتعملت بالفعل، اعمل إعادة تعيين لو عايز تعدل الفرق"); return; }
  state.teams.push({ id:uid(), name, level:parseInt(lvlEl.value,10), groupId:null });
  nameEl.value="";
  saveData();
}
function deleteTeam(id){
  if(state.settings.drawDone){ showToast("مينفعش تمسح فرق بعد القرعة"); return; }
  state.teams = state.teams.filter(t=>t.id!==id);
  saveData();
}

/* ---------------- DRAW ---------------- */
function shuffle(arr){
  const a=[...arr];
  for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; }
  return a;
}
function runDraw(){
  if(state.teams.length!==32){ showToast("لازم يكون فيه 32 فريق بالظبط قبل القرعة"); return; }
  if(state.settings.drawDone){ showToast("القرعة اتعملت قبل كدا"); return; }
  const groupIds = ["A","B","C","D","E","F","G","H"];
  const groups = groupIds.map(id=>({ id, teamIds:[] }));
  for(let lvl=1; lvl<=4; lvl++){
    const pool = shuffle(state.teams.filter(t=>t.level===lvl));
    pool.forEach((team,i)=>{
      // find group with fewest teams among the 8, preferring round-robin order
      let gi = i % 8;
      // balance pass in case levels are uneven
      let tries=0;
      while(groups[gi].teamIds.length>=4 && tries<8){ gi=(gi+1)%8; tries++; }
      groups[gi].teamIds.push(team.id);
      team.groupId = groups[gi].id;
    });
  }
  // final balance safety: if any group over/under 4 due to uneven levels, redistribute leftovers
  let overflow = [];
  groups.forEach(g=>{ while(g.teamIds.length>4){ overflow.push(g.teamIds.pop()); } });
  groups.forEach(g=>{ while(g.teamIds.length<4 && overflow.length){ const tid=overflow.pop(); g.teamIds.push(tid); const t=state.teams.find(x=>x.id===tid); if(t) t.groupId=g.id; } });

  state.groups = groups;
  // generate round robin matches per group
  let matches = [];
  groups.forEach(g=>{
    const [t1,t2,t3,t4] = shuffle(g.teamIds);
    const rounds = [[[t1,t2],[t3,t4]], [[t1,t3],[t2,t4]], [[t1,t4],[t2,t3]]];
    rounds.forEach((pair, ri)=>{
      pair.forEach(([a,b])=>{
        matches.push({ id:uid(), groupId:g.id, matchday:ri+1, teamA:a, teamB:b, scoreA:null, scoreB:null, played:false });
      });
    });
  });
  state.matchesGroup = matches;
  state.settings.drawDone = true;
  saveData();
  showToast("تمت القرعة بنجاح!");
}

function teamName(id){ const t=state.teams.find(x=>x.id===id); return t? t.name : "—"; }
function teamLevel(id){ const t=state.teams.find(x=>x.id===id); return t? t.level : null; }

/* ---------------- GROUP STANDINGS ---------------- */
function computeStandings(groupId){
  const g = state.groups.find(x=>x.id===groupId);
  if(!g) return [];
  const stats = {};
  g.teamIds.forEach(id=>{ stats[id]={ id, p:0,w:0,d:0,l:0,gf:0,ga:0,gd:0,pts:0 }; });
  state.matchesGroup.filter(m=>m.groupId===groupId && m.played).forEach(m=>{
    const A=stats[m.teamA], B=stats[m.teamB];
    if(!A||!B) return;
    A.p++; B.p++; A.gf+=m.scoreA; A.ga+=m.scoreB; B.gf+=m.scoreB; B.ga+=m.scoreA;
    if(m.scoreA>m.scoreB){ A.w++; A.pts+=3; B.l++; }
    else if(m.scoreA<m.scoreB){ B.w++; B.pts+=3; A.l++; }
    else { A.d++; B.d++; A.pts+=1; B.pts+=1; }
  });
  Object.values(stats).forEach(s=> s.gd = s.gf-s.ga );
  return Object.values(stats).sort((a,b)=> b.pts-a.pts || b.gd-a.gd || b.gf-a.gf || teamName(a.id).localeCompare(teamName(b.id),'ar'));
}
function allGroupMatchesPlayed(){
  return state.matchesGroup.length===48 && state.matchesGroup.every(m=>m.played);
}

/* ---------------- SCORES (group) ---------------- */
function saveGroupScore(matchId){
  const aEl=document.getElementById("sa-"+matchId), bEl=document.getElementById("sb-"+matchId);
  const a=parseInt(aEl.value,10), b=parseInt(bEl.value,10);
  if(isNaN(a)||isNaN(b)||a<0||b<0){ showToast("ادخل نتيجة صحيحة"); return; }
  const m = state.matchesGroup.find(x=>x.id===matchId);
  m.scoreA=a; m.scoreB=b; m.played=true;
  saveData();
}
function editGroupScore(matchId){
  const m = state.matchesGroup.find(x=>x.id===matchId);
  m.played=false; render();
}

/* ---------------- KNOCKOUT ---------------- */
const R16_PAIRS = [
  ["A1","B2"],["C1","D2"],["E1","F2"],["G1","H2"],
  ["B1","A2"],["D1","C2"],["F1","E2"],["H1","G2"]
];
function codeToTeamId(code){
  const groupId = code[0], pos = parseInt(code[1],10);
  const standings = computeStandings(groupId);
  return standings[pos-1] ? standings[pos-1].id : null;
}
function generateKnockout(){
  if(!allGroupMatchesPlayed()){ showToast("لازم كل مباريات دور المجموعات تخلص الأول"); return; }
  let km = [];
  R16_PAIRS.forEach((pair,i)=>{
    km.push({ id:uid(), round:"ro16", index:i, teamA:codeToTeamId(pair[0]), teamB:codeToTeamId(pair[1]), scoreA:null, scoreB:null, played:false, winner:null, penaltyWinner:null });
  });
  for(let i=0;i<4;i++) km.push({ id:uid(), round:"qf", index:i, teamA:null, teamB:null, scoreA:null, scoreB:null, played:false, winner:null, penaltyWinner:null });
  for(let i=0;i<2;i++) km.push({ id:uid(), round:"sf", index:i, teamA:null, teamB:null, scoreA:null, scoreB:null, played:false, winner:null, penaltyWinner:null });
  km.push({ id:uid(), round:"final", index:0, teamA:null, teamB:null, scoreA:null, scoreB:null, played:false, winner:null, penaltyWinner:null });
  state.matchesKnockout = km;
  state.settings.groupStageComplete = true;
  saveData();
  showToast("بدأت الأدوار الإقصائية!");
}
const NEXT_ROUND = { ro16:"qf", qf:"sf", sf:"final" };
function saveKnockoutScore(matchId){
  const m = state.matchesKnockout.find(x=>x.id===matchId);
  const aEl=document.getElementById("sa-"+matchId), bEl=document.getElementById("sb-"+matchId);
  const a=parseInt(aEl.value,10), b=parseInt(bEl.value,10);
  if(isNaN(a)||isNaN(b)||a<0||b<0){ showToast("ادخل نتيجة صحيحة"); return; }
  m.scoreA=a; m.scoreB=b;
  if(a===b){
    const penEl = document.getElementById("pen-"+matchId);
    if(!penEl || !penEl.value){ m.played=false; render(); showToast("النتيجة تعادل، حدد الفائز بركلات الترجيح"); return; }
    m.penaltyWinner = penEl.value;
    m.winner = penEl.value;
  } else {
    m.winner = a>b ? m.teamA : m.teamB;
    m.penaltyWinner = null;
  }
  m.played = true;
  advanceWinner(m);
  saveData();
}
function editKnockoutScore(matchId){
  const m = state.matchesKnockout.find(x=>x.id===matchId);
  m.played=false; render();
}
function advanceWinner(m){
  const nextRound = NEXT_ROUND[m.round];
  if(!nextRound) return;
  const nextIndex = Math.floor(m.index/2);
  const slot = m.index%2===0 ? "teamA" : "teamB";
  const next = state.matchesKnockout.find(x=>x.round===nextRound && x.index===nextIndex);
  if(next){ next[slot] = m.winner; }
}
function roundLabel(r){
  return { ro16:"دور الـ16", qf:"ربع النهائي", sf:"نصف النهائي", final:"النهائي" }[r];
}

/* ---------------- ADMIN AUTH ---------------- */
function openLogin(){ ui.showLogin=true; render(); }
function closeModal(){ ui.showLogin=false; ui.showReset=false; render(); }
function submitLogin(){
  const pw = document.getElementById("pwInput").value;
  if(pw === state.settings.password){ ui.isAdmin=true; ui.showLogin=false; showToast("أهلاً يا كابتن 👋"); }
  else { showToast("كلمة السر غلط"); }
  render();
}
function logoutAdmin(){ ui.isAdmin=false; render(); }
function changePassword(){
  const el = document.getElementById("newPassword");
  if(el.value.trim().length<4){ showToast("كلمة السر لازم 4 حروف على الأقل"); return; }
  state.settings.password = el.value.trim();
  saveData();
  showToast("اتغيرت كلمة السر");
}
function changeTournamentName(){
  const el = document.getElementById("tourneyName");
  state.settings.name = el.value.trim() || "دوري الصيف";
  saveData();
}
function askReset(){ ui.showReset=true; render(); }
function confirmReset(){
  state = defaultData();
  ui.showReset=false;
  saveData();
  showToast("البطولة اتصفرت من جديد");
}

/* ---------------- RENDER ---------------- */
function setTab(t){ ui.tab=t; render(); }

function renderTabs(){
  const tabs = [
    ["home","الرئيسية"], ["teams","الفرق"], ["groups","المجموعات"],
    ["knockout","الأدوار الإقصائية"]
  ];
  if(ui.isAdmin) tabs.push(["admin","لوحة التحكم"]);
  document.getElementById("tabs").innerHTML = tabs.map(([k,l])=>
    `<button class="tab ${ui.tab===k?'active':''}" onclick="setTab('${k}')">${l}</button>`
  ).join("");
  document.getElementById("brandTitle").textContent = state.settings.name;
  document.getElementById("adminPill").innerHTML = ui.isAdmin
    ? `<span style="font-size:12px;color:var(--chalk-dim)">وضع المنظم</span><button class="btn btn-ghost btn-sm" onclick="logoutAdmin()">خروج</button>`
    : `<button class="btn btn-amber btn-sm" onclick="openLogin()">دخول المنظم</button>`;
}

function renderHome(){
  const teamsCount = state.teams.length;
  const groupsDone = state.settings.drawDone;
  const koStarted = state.settings.groupStageComplete;
  const champion = state.matchesKnockout.find(m=>m.round==="final" && m.played);
  const upcoming = groupsDone ? state.matchesGroup.filter(m=>!m.played).slice(0,4) : [];
  const recent = [...state.matchesGroup, ...state.matchesKnockout].filter(m=>m.played).slice(-4).reverse();
  return `
    <section class="hero">
      <h1>${esc(state.settings.name)}</h1>
      <p>32 فريق، 8 مجموعات، وطريق واحد للنهائي. تابع القرعة والمجموعات ونتائج الأدوار الإقصائية أول بأول.</p>
      <div class="hero-stats">
        <div class="stat"><div class="stat-num mono">${teamsCount}/32</div><div class="stat-label">فريق مسجّل</div></div>
        <div class="stat"><div class="stat-num mono">${groupsDone?'✔':'—'}</div><div class="stat-label">القرعة</div></div>
        <div class="stat"><div class="stat-num mono">${koStarted?'✔':'—'}</div><div class="stat-label">الأدوار الإقصائية</div></div>
        ${champion? `<div class="stat"><div class="stat-num mono" style="color:var(--amber-2)">${esc(teamName(champion.winner))}</div><div class="stat-label">🏆 البطل</div></div>`:''}
      </div>
    </section>
    ${!groupsDone ? `<div class="notice">لسه القرعة ما اتعملتش. ${teamsCount<32? `محتاجين ${32-teamsCount} فريق كمان عشان نوصل 32.`:'كل الفرق جاهزة، المنظم يقدر يعمل القرعة من لوحة التحكم.'}</div>` : ''}
    <div class="grid grid-2">
      <div class="card">
        <h3 style="margin-top:0">آخر النتائج</h3>
        ${recent.length? recent.map(m=>`
          <div class="match-row">
            <div class="match-teams">${esc(teamName(m.teamA))} <span class="score-display">${m.scoreA} - ${m.scoreB}</span> ${esc(teamName(m.teamB))}</div>
          </div>`).join("") : `<p class="empty-note">لسه مفيش نتائج</p>`}
      </div>
      <div class="card">
        <h3 style="margin-top:0">مباريات جاية</h3>
        ${upcoming.length? upcoming.map(m=>`
          <div class="match-row">
            <div class="match-teams">${esc(teamName(m.teamA))} <span class="vs">ضد</span> ${esc(teamName(m.teamB))}</div>
            <span style="font-size:11px;color:var(--chalk-dim)">مجموعة ${m.groupId} · جولة ${m.matchday}</span>
          </div>`).join("") : `<p class="empty-note">مفيش مباريات معلقة دلوقتي</p>`}
      </div>
    </div>
  `;
}

function renderTeams(){
  const byLevel = [1,2,3,4];
  return `
    <div class="section-title"><div><span class="eyebrow">${state.teams.length} / 32</span><h2>الفرق المشاركة</h2></div></div>
    ${ui.isAdmin && !state.settings.drawDone ? `
      <div class="card" style="margin-bottom:20px;">
        <div class="form-row" style="align-items:flex-end;">
          <div><label>اسم الفريق</label><input type="text" id="newTeamName" placeholder="مثلاً: نجوم المعادي" style="min-width:220px;"></div>
          <div><label>التصنيف</label><select id="newTeamLevel">
            <option value="1">المستوى 1 (الأقوى)</option>
            <option value="2">المستوى 2</option>
            <option value="3">المستوى 3</option>
            <option value="4">المستوى 4</option>
          </select></div>
          <button class="btn btn-pitch" onclick="addTeam()">إضافة الفريق</button>
        </div>
        <span style="font-size:12px;color:var(--chalk-dim)">التصنيف بيتحكم في توزيع الفرق بالقرعة (فريق من كل مستوى في كل مجموعة قد الإمكان)</span>
      </div>` : ''}
    ${state.teams.length===0 ? `<p class="empty-note">لسه مفيش فرق مضافة</p>` : `
    <div class="grid grid-teams">
      ${state.teams.map(t=>`
        <div class="team-card">
          <div>
            <div class="team-name">${esc(t.name)}</div>
            ${t.groupId? `<div style="font-size:11px;color:var(--chalk-dim);margin-top:2px;">مجموعة ${t.groupId}</div>`:''}
          </div>
          <div style="display:flex;align-items:center;gap:6px;">
            <span class="level-badge lv-${t.level}">مستوى ${t.level}</span>
            ${ui.isAdmin && !state.settings.drawDone? `<button class="btn btn-ghost btn-sm" onclick="deleteTeam('${t.id}')">حذف</button>`:''}
          </div>
        </div>
      `).join("")}
    </div>`}
  `;
}

function renderGroups(){
  if(!state.settings.drawDone){
    return `<div class="section-title"><h2>المجموعات</h2></div><p class="empty-note">القرعة لسه ما اتعملتش. هتظهر المجموعات هنا بعد ما المنظم يعمل القرعة.</p>`;
  }
  return `
    <div class="section-title"><div><span class="eyebrow">دور المجموعات</span><h2>8 مجموعات × 4 فرق</h2></div></div>
    ${state.groups.map(g=>{
      const standings = computeStandings(g.id);
      const matches = state.matchesGroup.filter(m=>m.groupId===g.id).sort((a,b)=>a.matchday-b.matchday);
      const byDay = {1:[],2:[],3:[]};
      matches.forEach(m=>byDay[m.matchday].push(m));
      return `
      <div class="group-card">
        <div class="group-head"><div class="group-badge">${g.id}</div><h3 style="margin:0;">المجموعة ${g.id}</h3></div>
        <table>
          <thead><tr><th class="team-col">الفريق</th><th>لعب</th><th>ف</th><th>ت</th><th>خ</th><th>له</th><th>عليه</th><th>±</th><th>نقاط</th></tr></thead>
          <tbody>
          ${standings.map((s,i)=>`
            <tr class="${i<2?'qualify':''}">
              <td class="team-col">${esc(teamName(s.id))}</td>
              <td class="mono">${s.p}</td><td class="mono">${s.w}</td><td class="mono">${s.d}</td><td class="mono">${s.l}</td>
              <td class="mono">${s.gf}</td><td class="mono">${s.ga}</td><td class="mono">${s.gd>0?'+':''}${s.gd}</td>
              <td class="pts">${s.pts}</td>
            </tr>`).join("")}
          </tbody>
        </table>
        <div class="fixtures">
          ${[1,2,3].map(day=>`
            <div class="matchday">الجولة ${day}</div>
            ${byDay[day].map(m=>renderMatchRow(m,'group')).join("")}
          `).join("")}
        </div>
      </div>`;
    }).join("")}
  `;
}

function renderMatchRow(m, kind){
  const canEdit = ui.isAdmin;
  const scoreFn = kind==='group' ? 'saveGroupScore' : 'saveKnockoutScore';
  const editFn = kind==='group' ? 'editGroupScore' : 'editKnockoutScore';
  const teamAName = teamName(m.teamA), teamBName = teamName(m.teamB);
  if(!m.teamA || !m.teamB){
    return `<div class="match-row"><div class="match-teams" style="color:var(--chalk-dim)">في انتظار المتأهلين</div></div>`;
  }
  if(m.played){
    let resultTxt = `<span class="score-display">${m.scoreA} - ${m.scoreB}</span>`;
    if(m.penaltyWinner) resultTxt += ` <span style="font-size:11px;color:var(--chalk-dim)">(ركلات ترجيح: ${esc(teamName(m.penaltyWinner))})</span>`;
    return `<div class="match-row">
      <div class="match-teams">${esc(teamAName)} ${resultTxt} ${esc(teamBName)}</div>
      ${canEdit? `<button class="btn btn-ghost btn-sm" onclick="${editFn}('${m.id}')">تعديل</button>`:''}
    </div>`;
  }
  if(canEdit){
    return `<div class="match-row">
      <div class="match-teams">${esc(teamAName)}</div>
      <div style="display:flex;align-items:center;gap:6px;">
        <input type="number" min="0" class="score-box" id="sa-${m.id}">
        <span class="vs">-</span>
        <input type="number" min="0" class="score-box" id="sb-${m.id}">
        ${kind==='knockout' ? `<select id="pen-${m.id}" style="font-size:12px;padding:6px;">
          <option value="">لو تعادل: فاز بالركلات؟</option>
          <option value="${m.teamA}">${esc(teamAName)}</option>
          <option value="${m.teamB}">${esc(teamBName)}</option>
        </select>` : ''}
        <button class="btn btn-pitch btn-sm" onclick="${scoreFn}('${m.id}')">حفظ</button>
      </div>
      <div class="match-teams" style="text-align:left;flex:0;">${esc(teamBName)}</div>
    </div>`;
  }
  return `<div class="match-row"><div class="match-teams">${esc(teamAName)} <span class="vs">لم تُلعب بعد</span> ${esc(teamBName)}</div></div>`;
}

function renderKnockout(){
  if(!state.settings.groupStageComplete){
    return `<div class="section-title"><h2>الأدوار الإقصائية</h2></div>
    <p class="empty-note">${state.settings.drawDone ? 'هتظهر الأدوار الإقصائية هنا بعد انتهاء كل مباريات دور المجموعات.' : 'القرعة ولسه ما اتعملتش.'}</p>`;
  }
  const rounds = ["ro16","qf","sf","final"];
  const champion = state.matchesKnockout.find(m=>m.round==="final" && m.played);
  return `
    <div class="section-title"><div><span class="eyebrow">إقصائي</span><h2>مسار البطولة</h2></div></div>
    <div class="bracket">
      ${rounds.map(r=>{
        const matches = state.matchesKnockout.filter(m=>m.round===r).sort((a,b)=>a.index-b.index);
        return `<div class="round-col">
          <div class="round-title">${roundLabel(r)}</div>
          ${matches.map(m=>renderBracketMatch(m)).join("")}
        </div>`;
      }).join("")}
    </div>
    ${champion? `
    <div class="champion-banner">
      <div class="cup">🏆</div>
      <h2>${esc(teamName(champion.winner))}</h2>
      <p style="color:var(--chalk-dim);margin:4px 0 0;">بطل ${esc(state.settings.name)}</p>
    </div>` : ''}
    ${ui.isAdmin ? `<div class="card" style="margin-top:22px;"><h3 style="margin-top:0">تسجيل نتائج الأدوار الإقصائية</h3>${rounds.map(r=>{
      const matches = state.matchesKnockout.filter(m=>m.round===r).sort((a,b)=>a.index-b.index);
      return matches.map(m=> !m.teamA||!m.teamB ? '' : `<div style="margin-bottom:6px;">${renderMatchRow(m,'knockout')}</div>`).join("");
    }).join("")}</div>` : ''}
  `;
}
function renderBracketMatch(m){
  const aName = m.teamA? teamName(m.teamA) : "—";
  const bName = m.teamB? teamName(m.teamB) : "—";
  return `<div class="bmatch">
    <div class="bteam ${!m.teamA?'tbd':''} ${m.played && m.winner===m.teamA?'win':''}">
      <span>${esc(aName)}</span>${m.played?`<span class="bscore">${m.scoreA}</span>`:''}
    </div>
    <div class="bteam ${!m.teamB?'tbd':''} ${m.played && m.winner===m.teamB?'win':''}">
      <span>${esc(bName)}</span>${m.played?`<span class="bscore">${m.scoreB}</span>`:''}
    </div>
  </div>`;
}

function renderAdmin(){
  if(!ui.isAdmin) return `<p class="empty-note">لازم تدخل بكلمة سر المنظم الأول</p>`;
  return `
    <div class="section-title"><h2>لوحة تحكم المنظم</h2></div>
    <div class="grid grid-2">
      <div class="card">
        <h3 style="margin-top:0">القرعة</h3>
        <p style="font-size:13px;color:var(--chalk-dim)">لازم يكون فيه 32 فريق بالظبط. عندك دلوقتي ${state.teams.length} فريق.</p>
        <button class="btn btn-amber" ${state.teams.length!==32||state.settings.drawDone?'disabled':''} onclick="runDraw()">إجراء القرعة</button>
        ${state.settings.drawDone? `<p style="font-size:12.5px;color:var(--pitch-2);margin-top:8px;">✔ القرعة اتعملت</p>`:''}
      </div>
      <div class="card">
        <h3 style="margin-top:0">الأدوار الإقصائية</h3>
        <p style="font-size:13px;color:var(--chalk-dim)">${allGroupMatchesPlayed()? 'كل مباريات دور المجموعات خلصت.' : 'لسه فيه مباريات في دور المجموعات لم تُلعب.'}</p>
        <button class="btn btn-amber" ${!allGroupMatchesPlayed()||state.settings.groupStageComplete?'disabled':''} onclick="generateKnockout()">بدء الأدوار الإقصائية</button>
        ${state.settings.groupStageComplete? `<p style="font-size:12.5px;color:var(--pitch-2);margin-top:8px;">✔ بدأت الأدوار الإقصائية</p>`:''}
      </div>
      <div class="card">
        <h3 style="margin-top:0">اسم البطولة</h3>
        <div class="form-row"><input type="text" id="tourneyName" value="${esc(state.settings.name)}"><button class="btn btn-pitch btn-sm" onclick="changeTournamentName()">حفظ</button></div>
      </div>
      <div class="card">
        <h3 style="margin-top:0">كلمة سر المنظم</h3>
        <div class="form-row"><input type="password" id="newPassword" placeholder="كلمة سر جديدة"><button class="btn btn-pitch btn-sm" onclick="changePassword()">تغيير</button></div>
      </div>
      <div class="card" style="border-color:rgba(225,89,76,0.4);">
        <h3 style="margin-top:0;color:var(--danger);">منطقة الخطر</h3>
        <p style="font-size:13px;color:var(--chalk-dim)">هيمسح كل الفرق والقرعة والنتائج ويبدأ البطولة من الأول.</p>
        <button class="btn btn-danger" onclick="askReset()">إعادة تعيين البطولة بالكامل</button>
      </div>
    </div>
  `;
}

function renderModals(){
  let html = "";
  if(ui.showLogin){
    html += `<div class="overlay" onclick="if(event.target===this)closeModal()">
      <div class="modal">
        <h3>دخول المنظم</h3>
        <label>كلمة السر</label>
        <input type="password" id="pwInput" style="width:100%;margin-bottom:14px;" onkeydown="if(event.key==='Enter')submitLogin()">
        <div style="display:flex;gap:8px;justify-content:flex-end;">
          <button class="btn btn-ghost" onclick="closeModal()">إلغاء</button>
          <button class="btn btn-amber" onclick="submitLogin()">دخول</button>
        </div>
      </div>
    </div>`;
  }
  if(ui.showReset){
    html += `<div class="overlay" onclick="if(event.target===this)closeModal()">
      <div class="modal">
        <h3>تأكيد إعادة التعيين</h3>
        <p style="color:var(--chalk-dim);font-size:14px;">هل أنت متأكد؟ الإجراء ده هيمسح كل الفرق والمجموعات والنتائج نهائياً.</p>
        <div style="display:flex;gap:8px;justify-content:flex-end;">
          <button class="btn btn-ghost" onclick="closeModal()">إلغاء</button>
          <button class="btn btn-danger" onclick="confirmReset()">تأكيد الحذف</button>
        </div>
      </div>
    </div>`;
  }
  if(ui.toast){ html += `<div class="toast">${esc(ui.toast)}</div>`; }
  document.getElementById("modalRoot").innerHTML = html;
}

function render(){
  if(!state) return;
  renderTabs();
  let html = "";
  if(ui.tab==="home") html = renderHome();
  else if(ui.tab==="teams") html = renderTeams();
  else if(ui.tab==="groups") html = renderGroups();
  else if(ui.tab==="knockout") html = renderKnockout();
  else if(ui.tab==="admin") html = renderAdmin();
  document.getElementById("view").innerHTML = html;
  renderModals();
}

listenForData();

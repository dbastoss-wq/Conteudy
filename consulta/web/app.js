const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const S = {session:null, records:[], enc:null, portal:null, step:0, tab:'note', dirty:false, epoch:0, saving:false, conflict:false, timer:null, demo:false};
let saveTimer, toastTimer;
const paths = {
  plus:'M12 5v14M5 12h14', search:'m21 21-4.3-4.3M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  grid:'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  arrow:'m9 5 7 7-7 7', back:'m15 5-7 7 7 7', check:'m5 12 4 4L19 6',
  file:'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h6',
  lock:'M5 10h14v11H5zM8 10V6a4 4 0 0 1 8 0v4', clock:'M12 8v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  settings:'M4 7h16M4 17h16M8 4v6M16 14v6', close:'m6 6 12 12M6 18 18 6',
  video:'M3 6h12v12H3zM15 10l6-3v10l-6-3', warn:'m12 3 10 18H2zM12 9v4M12 17h.01',
  download:'M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4', upload:'M12 16V4m-5 5 5-5 5 5M4 17v4h16v-4',
  trash:'M3 6h18M8 6V3h8v3M5 6l1 15h12l1-15M10 10v7M14 10v7', copy:'M8 8h13v13H8zM16 8V3H3v13h5',
  up:'m6 14 6-6 6 6', down:'m6 10 6 6 6-6', logout:'M10 3H4v18h6M9 12h12m-4-4 4 4-4 4',
  heart:'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8',
  link:'M10 13a5 5 0 0 0 7 .1l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7-.1l-3 3a5 5 0 0 0 7 7l2-2'
};
function icon(name){return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+(paths[name]||paths.file)+'"/></svg>';}
function brand(){return '<div class="brand"><span class="brand-mark" aria-hidden="true"></span><div>Consulta em Foco<small>CUIDADO COM PRESENÇA</small></div></div>';}
function button(text, action, css='', attrs=''){return '<button type="button" class="btn '+css+'" data-action="'+action+'" '+attrs+'>'+text+'</button>';}
function field(label, path, value='', options={}){
  const scope=options.scope||'draft', attr='data-'+scope+'="'+esc(path)+'"';
  const control=options.area?'<textarea '+attr+' rows="'+(options.rows||3)+'" class="'+(options.large?'large':'')+'" '+(options.required?'required':'')+'>'+esc(value)+'</textarea>':
    '<input '+attr+' type="'+(options.type||'text')+'" value="'+esc(value)+'" '+(options.required?'required':'')+' '+(options.list?'list="'+options.list+'"':'')+' '+(options.decimal?'inputmode="decimal"':'')+' autocomplete="off">';
  return '<label class="field '+(options.wide?'span2':'')+'"><span>'+esc(label)+'</span>'+control+(options.help?'<small>'+esc(options.help)+'</small>':'')+'</label>';
}
function select(label,path,value,choices,scope='draft'){
  return '<label class="field"><span>'+esc(label)+'</span><select data-'+scope+'="'+esc(path)+'">'+choices.map(c=>'<option value="'+esc(c[0])+'" '+(String(value)===String(c[0])?'selected':'')+'>'+esc(c[1])+'</option>').join('')+'</select></label>';
}
function check(label,path,value=false,scope='draft'){return '<label class="check"><input type="checkbox" data-'+scope+'="'+esc(path)+'" '+(value?'checked':'')+'><span>'+esc(label)+'</span></label>';}
function date(v, time=false){if(!v)return 'Não informado'; return new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',...(time?{timeStyle:'short'}:{})}).format(new Date(typeof v==='number'?v*1000:v));}
function birth(v){return v?v.split('-').reverse().join('/'):'Nascimento não informado';}
function statusLabel(v){return ({intake:'Pré-consulta',review:'Revisão',in_progress:'Em atendimento',finalized:'Finalizado',draft:'Rascunho',ready:'Pronto para assinatura',signed:'Assinado com verificação',delivered:'Disponibilizado'})[v]||v;}
function answer(v){return v?.status==='informed'?v.text:({'not_informed':'Não informado','does_not_know':'Não sabe','denies':'Nega','not_applicable':'Não se aplica'})[v?.status]||'Não informado';}
function toast(text){clearTimeout(toastTimer);$('#toast').textContent=text;$('#toast').classList.add('show');toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),6500);}
function errors(err){let d=err.data?.detail;return Array.isArray(d)?d.map(x=>typeof x==='string'?x:x.msg).join('\n'):(d||err.message||'Não foi possível concluir a operação.');}
async function api(path, options={}){
  const headers=new Headers(options.headers||{});
  if(S.session?.csrf && options.method && options.method!=='GET')headers.set('X-CSRF-Token',S.session.csrf);
  if(options.body && !(options.body instanceof Blob) && !(options.body instanceof ArrayBuffer) && typeof options.body!=='string'){
    headers.set('Content-Type','application/json');options.body=JSON.stringify(options.body);
  }
  let r;try{r=await fetch(path,{...options,headers,credentials:'same-origin',cache:'no-store'});}catch{const e=new Error('Sem conexão. Seu texto continua nesta tela e ainda não foi salvo no servidor.');e.status=0;throw e;}
  if(!r.ok){const e=new Error('Operação não concluída');e.status=r.status;try{e.data=await r.json();}catch{}throw e;}
  return options.binary?r.blob():r.json();
}
function modal(title, body, foot=''){
  $('#modal-content').innerHTML='<div class="modal-head"><h2 id="modal-title">'+esc(title)+'</h2><button class="icon-btn" data-action="closeModal" aria-label="Fechar janela">'+icon('close')+'</button></div>'+body+(foot?'<div class="modal-foot">'+foot+'</div>':'');
  if(!$('#modal').open)$('#modal').showModal();
}
function closeModal(){$('#modal').close();}
function errorModal(err){modal('Confira antes de continuar','<div class="notice error">'+esc(errors(err)).replace(/\n/g,'<br>')+'</div>',button('Voltar à edição','closeModal'));}
function saveStatus(text, kind=''){ $$('.save-status').forEach(el=>{el.textContent=text;el.className='save-status '+kind;}); }
function setPath(object,path,value){const parts=path.split('.');let target=object;parts.slice(0,-1).forEach(k=>target=target[k]);target[parts.at(-1)]=value;}
function getPath(object,path){return path.split('.').reduce((x,k)=>x?.[k],object);}
function markDirty(){S.dirty=true;S.epoch++;saveStatus('Não sincronizado','unsynced');clearTimeout(saveTimer);saveTimer=setTimeout(save,650);}
async function save(){
  clearTimeout(saveTimer);
  if(S.saving||S.conflict||!S.dirty)return !S.dirty;
  S.saving=true;
  try{
    while(S.dirty&&!S.conflict){
      const epoch=S.epoch, record=S.enc, portal=S.portal;
      saveStatus('Salvando…');
      let result;
      if(S.session.role==='doctor'){
        result=await api('/api/encounters/'+record.id+'/draft',{method:'PUT',body:{revision:record.revision,draft:structuredClone(record.draft)}});
        record.revision=result.revision;
      }else{
        result=await api('/api/patient/intake',{method:'PUT',body:{revision:portal.revision,patient:structuredClone(portal.patient),intake:structuredClone(portal.intake),submit:false}});
        portal.revision=result.revision;
      }
      if(S.epoch===epoch){S.dirty=false;saveStatus('Salvo no servidor','saved');$('#network-banner')?.setAttribute('hidden','');}
    }
  }catch(err){
    saveStatus(err.status===409?'Conflito de edição':'Não sincronizado · erro','error');
    const b=$('#network-banner');if(b){b.hidden=false;$('.banner-message',b).textContent=errors(err);}
    if(err.status===409){
      S.conflict=true;toast('Conflito detectado. Sua redação foi preservada nesta tela.');
    }else if(err.status!==0)toast(errors(err));
  }finally{S.saving=false;}
  return !S.dirty;
}
async function flush(){
  if(S.conflict){toast('Resolva o conflito antes de sair desta edição. Seu texto foi preservado.');return false;}
  while(S.saving)await new Promise(r=>setTimeout(r,40));
  if(S.dirty)await save();
  return !S.dirty;
}
function loginPage(message=''){
  $('#app').innerHTML='<div class="login"><section class="login-story">'+brand()+'<div class="login-message"><div class="eyebrow">DR. DANIEL CARDOSO DE BASTOS</div><h1>O cuidado começa<br>com uma boa escuta.</h1><p>Um espaço para conectar o relato do paciente à sua prática médica. Com presença, clareza e continuidade.</p><div class="login-steps"><div class="login-step"><i>1</i> Pré-consulta</div><div class="login-step"><i>2</i> Atendimento</div><div class="login-step"><i>3</i> Continuidade</div></div></div><div class="login-foot">Clínico geral · CRM-SP 239894<br>Espaço privado de atendimento · America/Sao_Paulo</div></section><main id="main" class="login-form-side"><div class="login-form"><div class="login-lock">'+icon('lock')+'</div><div class="eyebrow">ÁREA MÉDICA</div><h2>Bem-vindo ao consultório.</h2><p>Acesse sua conta para cuidar do que importa.</p><form data-form="login"><label class="field"><span>Usuário</span><input name="username" required autocomplete="username" autofocus></label><label class="field"><span>Senha</span><input name="password" type="password" required autocomplete="current-password"></label><div id="login-error" class="notice error '+(!message?'hidden':'')+'" role="alert">'+esc(message)+'</div><button class="btn primary wide" type="submit">Entrar com segurança '+icon('arrow')+'</button></form>'+(S.demo?'<div class="divider"></div>'+button('Abrir demonstração vazia','demo','wide')+'<p class="small" style="margin-top:10px">Somente dados fictícios. Os registros deste ambiente são temporários.</p>':'<p class="small" style="margin-top:20px">Contas médicas são provisionadas pelo administrador do servidor. Pacientes entram pelo convite recebido.</p>')+'<div class="physician"><div class="avatar">DB</div><div><strong>Dr. Daniel Cardoso de Bastos</strong><br><span class="muted">Clínico geral · CRM-SP 239894</span></div></div></div></main></div>';
}
function shell(content, active='dashboard', bread='Visão geral'){
  const profile=S.session.profile;
  $('#app').innerHTML=(S.demo?'<div class="demo-banner">DEMONSTRAÇÃO · Use apenas dados fictícios. Nenhum documento deste ambiente deve ser utilizado na assistência.</div>':'')+'<div class="shell"><aside class="sidebar">'+brand()+'<nav class="nav-group" aria-label="Navegação principal"><div class="nav-label">Consultório</div><button class="nav '+(active==='dashboard'?'active':'')+'" data-action="home">'+icon('grid')+'<span>Atendimentos</span></button><button class="nav '+(active==='settings'?'active':'')+'" data-action="settings">'+icon('settings')+'<span>Meu consultório</span></button></nav><div class="sidebar-foot"><div class="physician"><div class="avatar">DB</div><div><strong>Dr. Daniel Bastos</strong><br><span class="muted">CRM-SP 239894</span></div></div>'+button(icon('logout')+' Sair','logout','subtle wide')+'</div></aside><div class="workspace-area"><header class="topbar"><div class="breadcrumbs">Meu consultório<span>/</span>'+esc(bread)+'</div><div class="row"><span class="time-zone">America/Sao_Paulo</span><span class="tag">'+icon('lock')+' Área privada</span></div></header><main id="main">'+content+'</main></div></div>';
}
async function home(){
  if(!await flush())return;
  history.replaceState(null,'','/');
  S.enc=null;S.portal=null;S.tab='note';
  S.records=await api('/api/encounters');
  const counts={total:S.records.length,review:S.records.filter(r=>r.submitted&&r.status!=='finalized').length,done:S.records.filter(r=>r.status==='finalized').length};
  shell('<div class="page"><div class="page-header"><div><div class="eyebrow">'+esc(new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',weekday:'long',day:'numeric',month:'long'}).format(new Date()))+'</div><h1>Seu consultório, em foco.</h1><p>Uma boa consulta começa antes do primeiro encontro.</p></div>'+button(icon('plus')+' Novo atendimento','newEncounter','primary')+'</div><div class="overview-line"><div class="metric"><strong>'+counts.total+'</strong><span>ATENDIMENTOS</span></div><div class="metric"><strong>'+counts.review+'</strong><span>PARA REVISAR</span></div><div class="metric"><strong>'+counts.done+'</strong><span>FINALIZADOS</span></div></div><div class="list-head"><h2>Seus atendimentos</h2><label class="search-box">'+icon('search')+'<input class="search" id="search" aria-label="Buscar paciente" placeholder="Buscar pelo nome do paciente"></label></div><section class="patient-list" aria-label="Lista de atendimentos"><div id="records"></div></section><div class="flow-guide"><div class="guide"><span>01</span><div><h3>Escuta antes do encontro</h3><p>Envie o convite privado e conheça o relato original do paciente.</p></div></div><div class="guide"><span>02</span><div><h3>Presença durante a consulta</h3><p>Revise a história e registre apenas o que foi relatado ou observado.</p></div></div><div class="guide"><span>03</span><div><h3>Cuidado com continuidade</h3><p>Revise documentos, verifique a assinatura e organize o retorno.</p></div></div></div></div>');
  renderRecords();
}
function renderRecords(query=''){
  const records=S.records.filter(r=>r.patient.name.toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR')));
  if(!records.length){$('#records').innerHTML='<div class="empty"><div class="empty-symbol">'+icon('heart')+'</div><h2>'+(query?'Nenhum atendimento encontrado.':'Seu primeiro cuidado começa aqui.')+'</h2><p>'+(query?'Tente buscar outra parte do nome.':'Crie um atendimento, envie a pré-consulta e reúna as informações em um espaço só. Cada paciente tem um registro próprio e privado.')+'</p>'+(!query?button(icon('plus')+' Criar primeiro atendimento','newEncounter','primary'):'')+'</div>';return;}
  $('#records').innerHTML='<div class="patient-table-head"><span>Paciente</span><span>Motivo</span><span>Etapa</span><span class="date-col">Criado em</span><span></span></div>'+records.map(r=>'<div class="patient-row" role="button" tabindex="0" data-action="open" data-id="'+esc(r.id)+'" aria-label="Abrir atendimento de '+esc(r.patient.name)+'"><div class="patient-name"><span class="avatar">'+esc(r.patient.name.split(' ').slice(0,2).map(n=>n[0]).join(''))+'</span><div><strong>'+esc(r.patient.name)+'</strong><small>'+birth(r.patient.birth_date)+'</small></div></div><div class="muted chief-col">'+esc(r.chief_complaint||'Aguardando relato')+'</div><div><span class="tag '+(r.status==='finalized'?'good':r.submitted?'warning':'')+'">'+statusLabel(r.status)+'</span></div><span class="muted date-col">'+date(r.created_at)+'</span>'+icon('arrow')+'</div>').join('');
}
function newEncounter(){
  modal('Um novo atendimento','<p class="muted small" style="margin-bottom:22px">Comece com a identificação. O paciente poderá complementar os dados no convite privado.</p><form data-form="newEncounter" class="stack">'+field('Nome completo','name','',{scope:'new',required:true})+field('Data de nascimento','birth_date','',{scope:'new',type:'date'})+field('Contato para comunicação','contact','',{scope:'new'})+'<div id="form-error" role="alert"></div><div class="modal-foot">'+button('Cancelar','closeModal')+'<button type="submit" class="btn primary">Criar atendimento '+icon('arrow')+'</button></div></form>');
}
async function openEncounter(id){
  if(!await flush())return;
  S.readingPositions={};S.readingTab=null;
  S.enc=await api('/api/encounters/'+id);S.portal=null;S.dirty=false;S.conflict=false;S.tab='note';renderWorkspace();
  history.replaceState(null,'','/#atendimento='+encodeURIComponent(id));
}
function networkBanner(){return '<div id="network-banner" class="connection-banner" hidden><span class="banner-message">Alterações ainda não sincronizadas.</span><div class="row">'+button('Tentar salvar','retrySave','compact')+button('Comparar versões','compareConflict','compact')+'</div></div>';}
function renderWorkspace(){
  const r=S.enc,p=r.patient,i=r.intake;
  shell('<section class="consult-header"><div class="row between wrap"><div><div class="eyebrow" style="margin-bottom:6px">ATENDIMENTO INDIVIDUAL</div><h1>'+esc(p.name)+'</h1><p class="small" style="margin-top:5px">'+birth(p.birth_date)+' · '+esc(p.contact||'Contato não informado')+'</p></div><div class="stack" style="gap:8px;align-items:flex-end"><span class="tag '+(r.finalized_at?'good':'')+'">'+statusLabel(r.status)+'</span><span class="save-status saved">Salvo no servidor</span></div></div></section>'+networkBanner()+'<div class="workspace"><aside class="patient-rail"><div class="rail-section"><h3>Paciente</h3><p>'+esc(p.name)+'</p><p class="muted">'+birth(p.birth_date)+'</p><div class="row" style="margin-top:10px">'+button('Cadastro','patientEdit','compact subtle')+button('Convite','invite','compact')+'</div></div><div class="rail-section"><h3>Alergias · relato do paciente</h3><div class="allergy"><p>'+esc(answer(i.allergies))+'</p></div></div><div class="rail-section rail-long"><h3>Medicamentos em uso</h3><p>'+esc(answer(i.medications))+'</p></div><div class="rail-section rail-long"><h3>Queixa e expectativa</h3><p>'+esc(i.chief_complaint||'Não informado')+'</p><p class="muted" style="margin-top:9px">'+esc(i.expectation||'Expectativa não informada')+'</p></div><div class="call-box"><div><h3>Consulta atual</h3><div class="timer" id="timer">00:00:00</div></div><div class="row wrap">'+button(icon('video')+' Abrir chamada','call','compact wide')+'<p>A chamada abre na plataforma externa. O app não grava nem transcreve.</p></div></div><div class="rail-section rail-long" style="margin-top:20px"><h3>Registro original</h3><p class="muted">'+(r.intake_submitted_at?'Enviado em '+date(r.intake_submitted_at,true):'Pré-consulta ainda não enviada.')+'</p>'+button('Ver relato e anexos','tab','compact subtle','data-tab="files"')+'</div></aside><section class="editor-area"><nav class="workspace-toolbar" aria-label="Áreas do atendimento">'+[['note','Evolução'],['prescription','Prescrição'],['tele','Teleconsulta'],['files','Arquivos e relato'],['history','Histórico']].map(([k,l])=>'<button class="tab '+(S.tab===k?'active':'')+'" data-action="tab" data-tab="'+k+'">'+l+'</button>').join('')+'</nav>'+(r.finalized_at?'<div class="notice success" style="margin-top:20px">Atendimento finalizado. O registro original está preservado. Complementações são registradas como adendos.</div>':'')+'<div class="tab-section" data-section="clinical"><div class="pane-title"><div><h2>Uma evolução com contexto.</h2><p>Texto editável, sem presumir normalidade ou negativas.</p></div><div class="row wrap">'+button('Organizar relato','organize','compact')+button('IA de apoio','ai','compact')+'</div></div><div class="work-grid"><div class="note-pane"><div class="note-heading"><span>EVOLUÇÃO MÉDICA</span><select data-draft="note.format" aria-label="Formato da evolução"><option value="traditional" '+(r.draft.note.format==='traditional'?'selected':'')+'>Tradicional</option><option value="soap" '+(r.draft.note.format==='soap'?'selected':'')+'>SOAP</option></select></div><div class="note-fields">'+renderNote()+'</div><div class="row wrap" style="margin-top:20px">'+(r.finalized_at?button('Registrar adendo','addendum','primary'):button(icon('check')+' Finalizar registro','finalize','primary'))+button('Exportar evolução','newDocument','compact','data-kind="evolution"')+button('Exportação anonimizada','anonymized','compact')+'</div></div><div class="splitter" role="separator" aria-label="Ajustar largura dos painéis" aria-orientation="vertical" tabindex="0"></div><div class="rx-pane" id="rx-pane">'+renderPrescription()+'</div></div></div><div class="tab-section panel" data-section="tele" hidden>'+renderTele()+'</div><div class="tab-section panel" data-section="files" hidden>'+renderFiles()+'</div><div class="tab-section panel" data-section="history" hidden><div id="history-content"></div></div></section></div>','dashboard','Atendimento');
  $('.workspace').insertAdjacentHTML('beforebegin',clinicalStrip());
  const status=$('.consult-header .save-status');
  status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  $('.clinical-strip-save').append(status);
  lockFinalized();toggleNoteFormat();updateTimer();renderRxPreview();setupSplitter();
}
function clinicalStrip(){
  return '<aside class="clinical-strip" aria-label="Identificação e informações do atendimento atual"><div><small>PACIENTE</small><strong>'+esc(S.enc.patient.name)+'</strong><span>'+birth(S.enc.patient.birth_date)+'</span></div><div class="clinical-strip-allergy"><small>ALERGIAS · RELATO DO PACIENTE</small><p>'+esc(answer(S.enc.intake.allergies))+'</p></div><div><small data-consult-status>'+statusLabel(S.enc.status)+'</small><span class="consult-clock">00:00:00</span></div><div class="clinical-strip-save"></div></aside>';
}
function renderNote(){
  const n=S.enc.draft.note;
  return '<div class="traditional note-fields">'+field('QD — queixa e duração','note.qd',n.qd)+field('HPMA — história do problema atual','note.hpma',n.hpma,{area:true,large:true})+'</div><div class="soap note-fields" hidden>'+field('S — subjetivo, com relato e contexto','note.subjective',n.subjective,{area:true,large:true})+field('O — objetivo, apenas informações documentadas','note.objective',n.objective,{area:true})+'</div>'+field('Antecedentes e contexto','note.history',n.history,{area:true})+field('Medicamentos em uso','note.medications',n.medications,{area:true})+field('Alergias e reações','note.allergies',n.allergies,{area:true})+field('Exame / achados efetivamente observados','note.exam',n.exam,{area:true})+field('Avaliação médica','note.assessment',n.assessment,{area:true})+field('Plano e orientações','note.plan',n.plan,{area:true,large:true})+field('Retorno e continuidade','follow_up',S.enc.draft.follow_up,{area:true})+'<p class="small">Origem: redação médica. Trechos organizados do paciente ou sugeridos por IA são identificados e versionados ao serem aplicados.</p>';
}
function toggleNoteFormat(){const soap=S.enc?.draft.note.format==='soap';$$('.soap').forEach(el=>el.hidden=!soap);$$('.traditional').forEach(el=>el.hidden=soap);}
function lockFinalized(){
  if(!S.enc?.finalized_at)return;
  $$('[data-draft^="note."], [data-draft^="tele."], [data-draft="follow_up"]').forEach(el=>el.disabled=true);
  $$('[data-action="organize"],[data-action="ai"],[data-action="vitalAdd"],[data-action="vitalRemove"]').forEach(el=>el.disabled=true);
}
function medField(label,key,value,index,options={}){
  const input=options.area?'<textarea data-med="'+index+'" data-key="'+key+'" rows="2">'+esc(value)+'</textarea>':
    '<input data-med="'+index+'" data-key="'+key+'" value="'+esc(value)+'" '+(options.list?'list="'+options.list+'"':'')+' '+(options.decimal?'inputmode="decimal"':'')+' autocomplete="off">';
  return '<label class="field '+(options.wide?'span2':'')+'"><span>'+esc(label)+'</span>'+input+'</label>';
}
function renderMed(m,index){
  const f=(l,k,o={})=>medField(l,k,m[k],index,o);
  const ck=(l,k)=>'<label class="check"><input type="checkbox" data-med="'+index+'" data-key="'+k+'" '+(m[k]?'checked':'')+'><span>'+l+'</span></label>';
  return '<article class="rx-item"><div class="rx-item-head"><strong>Item '+(index+1)+' · '+esc(m.ingredient||'Novo medicamento')+'</strong><div class="row" style="gap:0">'+[['medUp','up','Mover para cima'],['medDown','down','Mover para baixo'],['medCopy','copy','Duplicar item'],['medFavorite','heart','Salvar favorito'],['medRemove','trash','Remover item']].map(([a,ic,label])=>'<button type="button" class="icon-btn rx-edit-action" data-action="'+a+'" data-index="'+index+'" aria-label="'+label+'" title="'+label+'">'+icon(ic)+'</button>').join('')+'</div></div><div class="form-grid">'+f('Princípio ativo','ingredient')+f('Nome comercial · opcional','brand')+f('Concentração','strength',{decimal:true})+f('Unidade da concentração','strength_unit',{list:'strength-units'})+f('Apresentação','presentation')+f('Dose por administração','dose',{decimal:true})+f('Unidade da dose','dose_unit',{list:'dose-units'})+f('Via','route',{list:'routes'})+f('Frequência ou intervalo','frequency')+f('Duração','duration')+f('Quantidade total','quantity',{decimal:true})+f('Unidade de dispensação','dispensing_unit')+'<div class="span2 row wrap">'+ck('Uso contínuo','continuous')+ck('Se necessário','as_needed')+'</div><div class="prn-fields span2 form-grid" '+(!m.as_needed?'hidden':'')+'>'+f('Condição de uso','condition')+f('Intervalo mínimo','minimum_interval')+f('Limite diário','daily_limit')+f('Justificativa de não aplicabilidade','prn_exception_reason')+'</div>'+f('Esquema variável definido pelo médico · opcional','variable_schedule',{area:true,wide:true})+f('Orientações específicas','instructions',{area:true,wide:true})+'<label class="field span2"><span>Categoria sanitária · confirmação médica</span><select data-med="'+index+'" data-key="category">'+[['unclassified','Não classificado — emissão bloqueada'],['common','Comum — categoria confirmada pelo médico'],['antimicrobial','Antimicrobiano / retenção — integração necessária'],['ret_glp1','Agonista GLP-1 / retenção — integração necessária'],['controlled','Controlado / RCE — integração necessária'],['special','Notificação ou categoria especial — integração necessária']].map(([v,l])=>'<option value="'+v+'" '+(m.category===v?'selected':'')+'>'+l+'</option>').join('')+'</select></label></div>'+(m.favorite_id?'<div class="notice" style="margin-top:12px">Favorito aplicado. Confirme a adequação ao paciente atual. '+button('Reconfirmar este item','confirmFavorite','compact rx-edit-action','data-index="'+index+'"')+'</div>':'')+'</article>';
}
function renderPrescription(){
  return '<div class="rx-box"><div class="pane-title"><div><div class="eyebrow" style="margin-bottom:5px">PRESCRIÇÃO</div><h2>Clareza em cada orientação.</h2></div>'+button(icon('plus'),'medAdd','compact rx-edit-action','aria-label="Adicionar medicamento"')+'</div><div class="interaction">'+icon('warn')+'<span>Verificação de interações e contraindicações não realizada. Base farmacológica não integrada.</span></div><div class="rx-content-grid"><div><div id="rx-items">'+(S.enc.draft.medications.length?S.enc.draft.medications.map(renderMed).join(''):'<p class="small" style="padding:15px 0">Nenhum medicamento adicionado. Doses, vias e frequências começam vazias.</p>')+'</div><div class="row wrap" style="margin:14px 0">'+button(icon('plus')+' Adicionar item','medAdd','compact rx-edit-action')+button('Favoritos','favoriteList','compact rx-edit-action')+'</div>'+field('Orientações em texto livre','prescription_text',S.enc.draft.prescription_text,{area:true})+'</div><div class="rx-preview-column"><div class="rx-preview" id="rx-preview"></div><p class="small" style="margin-bottom:14px">Prévia de conteúdo. A emissão final depende de revisão, requisitos da categoria e assinatura tecnicamente verificada.</p>'+button(icon('file')+' Preparar documento','newDocument','primary wide','data-kind="prescription"')+'</div></div><datalist id="strength-units">'+['mg','mcg','g','mg/mL','mcg/mL','UI/mL','%','mg/comprimido'].map(x=>'<option value="'+x+'">').join('')+'</datalist><datalist id="dose-units">'+['mg','mcg','mL','gota(s)','comprimido(s)','cápsula(s)','UI'].map(x=>'<option value="'+x+'">').join('')+'</datalist><datalist id="routes">'+['Oral','Sublingual','Tópica','Inalatória','Nasal','Ocular','Otológica','Intramuscular','Subcutânea','Intravenosa','Retal','Vaginal'].map(x=>'<option value="'+x+'">').join('')+'</datalist></div>';
}
function renderRxItems(){const scroll=window.scrollY;$('#rx-items').innerHTML=S.enc.draft.medications.length?S.enc.draft.medications.map(renderMed).join(''):'<p class="small">Nenhum medicamento adicionado.</p>';lockFinalized();renderRxPreview();window.scrollTo(0,scroll);}
function medLines(m,index){
  let lines=[(index+1)+'. '+(m.ingredient||'[Princípio ativo]')+(m.brand?' ('+m.brand+')':'')+' — '+(m.strength||'[concentração]')+' '+(m.strength_unit||'[unidade]')+'; '+(m.presentation||'[apresentação]')];
  lines.push(m.variable_schedule||'Administrar '+(m.dose||'[dose]')+' '+(m.dose_unit||'[unidade]')+' por administração.');
  lines.push('Via: '+(m.route||'[não definida]')+'. Frequência/intervalo: '+(m.frequency||'[não definido]')+'.');
  lines.push(m.continuous?'Uso contínuo.':'Duração: '+(m.duration||'[não definida]')+'.');
  lines.push('Quantidade total: '+(m.quantity||'[quantidade]')+' '+(m.dispensing_unit||'[unidade]')+'.');
  if(m.as_needed)lines.push('Se necessário: '+(m.condition||'[condição]')+'. Intervalo mínimo: '+(m.minimum_interval||'[conferir]')+'. Limite diário: '+(m.daily_limit||'[conferir]')+'.');
  if(m.instructions)lines.push(m.instructions);
  return lines.join('\n');
}
function renderRxPreview(){
  const el=$('#rx-preview');if(!el||!S.enc)return;
  el.innerHTML='<div class="eyebrow" style="margin-bottom:8px">RASCUNHO · NÃO ASSINADO</div><h3>Receita médica</h3><p><strong>'+esc(S.enc.patient.name)+'</strong></p>'+S.enc.draft.medications.map((m,i)=>'<p>'+esc(medLines(m,i)).replace(/\n/g,'<br>')+'</p>').join('')+(S.enc.draft.prescription_text?'<p>'+esc(S.enc.draft.prescription_text).replace(/\n/g,'<br>')+'</p>':'')+(!S.enc.draft.medications.length?'<p class="muted">A prévia aparecerá conforme você preencher os itens.</p>':'');
}
function answerForm(label,path,value,scope='draft'){
  return '<div class="answer-block"><div class="row"><strong>'+esc(label)+'</strong>'+select('Situação',path+'.status',value.status,[['not_informed','Não informado'],['informed','Informado'],['does_not_know','Não sabe'],['denies','Nega'],['not_applicable','Não se aplica']],scope)+'</div>'+field('Descreva quando informado',path+'.text',value.text,{scope,area:true})+'</div>';
}
function renderTele(){
  const t=S.enc.draft.tele;
  return '<div class="tele-fields"><div class="section-title"><div><h2>Presença, mesmo à distância.</h2><p>Registre a realidade do atendimento e suas limitações.</p></div><div class="row wrap">'+button('Iniciar','teleStart','compact','id="tele-start"')+button('Encerrar','teleEnd','compact','id="tele-end"')+'</div></div><div class="form-grid">'+check('Identidade conferida pelo médico','tele.identity_confirmed',t.identity_confirmed)+field('Como a identidade foi confirmada','tele.identity_method',t.identity_method)+field('Localização atual do paciente','tele.current_location',t.current_location)+field('Contato para reconexão','tele.reconnection_contact',t.reconnection_contact)+select('Modalidade','tele.modality',t.modality,[['','Selecionar'],['video','Vídeo'],['audio','Áudio'],['outro','Outra — descrever nas limitações']])+field('Plataforma utilizada','tele.platform',t.platform)+field('Link externo da chamada · HTTPS','tele.call_url',t.call_url,{wide:true,help:'Google Meet, Teams, Zoom, Whereby ou Doxy.me. O link será validado pelo servidor antes de abrir.'})+'</div><div style="margin-top:20px">'+answerForm('Acompanhante, vínculo e identificação','tele.companion',t.companion)+'</div><div class="stack" style="margin-top:20px">'+check('Consentimento para teleconsulta confirmado pelo médico','tele.consent_confirmed',t.consent_confirmed)+field('Como e quando o consentimento foi obtido','tele.consent_details',t.consent_details,{area:true})+'</div><div class="form-grid" style="margin-top:20px">'+select('Qualidade da conexão','tele.connection_quality',t.connection_quality,[['','Selecionar'],['boa','Boa'],['limitada','Limitada'],['ruim','Ruim']])+field('Limitações do atendimento remoto','tele.limitations',t.limitations,{area:true})+field('Achados efetivamente observados ao vídeo','tele.video_findings',t.video_findings,{area:true,wide:true})+'</div><div class="section-title" style="margin-top:28px"><div><h3>Sinais vitais, quando disponíveis</h3><p>Registre unidade, origem e horário real da aferição. Ausência de medida não significa normalidade.</p></div>'+button(icon('plus')+' Adicionar','vitalAdd','compact rx-edit-action')+'</div><div id="vitals">'+renderVitals()+'</div><div class="form-grid" style="margin-top:25px">'+select('Conduta de encaminhamento','tele.disposition',t.disposition,[['not_decided','Ainda não decidida'],['follow_up','Acompanhamento/retorno'],['in_person','Atendimento presencial indicado'],['urgent','Atendimento de urgência indicado']])+field('Motivo e orientação documentada','tele.disposition_reason',t.disposition_reason,{area:true})+'</div><div class="notice" style="margin-top:24px">Gravação e transcrição estão desligadas e não foram integradas. Autorizações abaixo registram a decisão específica do paciente; não iniciam captura.</div><div class="stack" style="margin-top:18px">'+check('Autorização específica para gravação foi obtida','tele.recording_authorized',t.recording_authorized)+check('Autorização específica para transcrição foi obtida','tele.transcription_authorized',t.transcription_authorized)+field('Escopo, finalidade, forma e momento das autorizações','tele.specific_authorization_details',t.specific_authorization_details,{area:true})+'</div></div>';
}
function zoneParts(dateValue){
  const p=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(dateValue);
  return Object.fromEntries(p.filter(v=>v.type!=='literal').map(v=>[v.type,v.value]));
}
function localDateInput(v){if(!v)return '';const p=zoneParts(new Date(v));return p.year+'-'+p.month+'-'+p.day+'T'+p.hour+':'+p.minute;}
function localToISO(v){
  if(!v)return null;
  const parts=v.split(/[-T:]/).map(Number), desired=Date.UTC(parts[0],parts[1]-1,parts[2],parts[3],parts[4]);
  let candidate=desired;
  for(let i=0;i<4;i++){const p=zoneParts(new Date(candidate));const shown=Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute);const delta=desired-shown;if(!delta)return new Date(candidate).toISOString();candidate+=delta;}
  throw new Error('Horário ambíguo. Confira a data e o fuso America/Sao_Paulo.');
}
function renderVitals(){
  return S.enc.draft.tele.vitals.map((v,i)=>'<div class="vital-row"><label class="field"><span>Medida</span><select data-vital="'+i+'" data-key="kind">'+[['','Selecionar'],['pressao','Pressão arterial'],['frequencia_cardiaca','Frequência cardíaca'],['temperatura','Temperatura'],['saturacao','Saturação'],['peso','Peso'],['altura','Altura'],['outro','Outra']].map(([k,l])=>'<option value="'+k+'" '+(v.kind===k?'selected':'')+'>'+l+'</option>').join('')+'</select></label><label class="field"><span>Valor informado</span><input data-vital="'+i+'" data-key="value" value="'+esc(v.value)+'"></label><label class="field"><span>Unidade</span><input data-vital="'+i+'" data-key="unit" value="'+esc(v.unit)+'"></label><label class="field"><span>Origem</span><select data-vital="'+i+'" data-key="source">'+[['','Selecionar'],['paciente','Relato do paciente'],['documento','Documento'],['observado_em_video','Observado ao vídeo'],['medico','Médico']].map(([k,l])=>'<option value="'+k+'" '+(v.source===k?'selected':'')+'>'+l+'</option>').join('')+'</select></label><label class="field"><span>Aferido em · São Paulo</span><input type="datetime-local" data-vital="'+i+'" data-key="measured_at" value="'+localDateInput(v.measured_at)+'"></label><button class="icon-btn rx-edit-action" data-action="vitalRemove" data-index="'+i+'" aria-label="Remover medida">'+icon('trash')+'</button></div>').join('')||'<p class="small">Nenhuma medida registrada.</p>';
}
function updateTimer(){
  if(!S.enc)return;
  const end=S.enc.ended_at||Date.now()/1000, seconds=S.enc.started_at?Math.max(0,Math.floor(end-S.enc.started_at)):0;
  const label=[Math.floor(seconds/3600),Math.floor(seconds/60)%60,seconds%60].map(v=>String(v).padStart(2,'0')).join(':');
  if($('#timer'))$('#timer').textContent=label;
  $$('.consult-clock').forEach(el=>el.textContent=label);
  $$('[data-consult-status]').forEach(el=>el.textContent=statusLabel(S.enc.status));
  if($('.consult-header .tag'))$('.consult-header .tag').textContent=statusLabel(S.enc.status);
  if($('#tele-start'))$('#tele-start').disabled=!!S.enc.started_at||!!S.enc.finalized_at;
  if($('#tele-end'))$('#tele-end').disabled=!S.enc.started_at||!!S.enc.ended_at||!!S.enc.finalized_at;
}
function setupSplitter(){
  const splitter=$('.splitter'), grid=$('.work-grid');if(!splitter||!grid)return;
  splitter.addEventListener('pointerdown',event=>{
    splitter.setPointerCapture(event.pointerId);
    const move=e=>{const rect=grid.getBoundingClientRect();grid.style.setProperty('--note-width',Math.max(30,Math.min(65,(e.clientX-rect.left)/rect.width*100))+'%');};
    splitter.addEventListener('pointermove',move);
    splitter.addEventListener('pointerup',()=>splitter.removeEventListener('pointermove',move),{once:true});
  });
  splitter.addEventListener('keydown',event=>{if(['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();const n=parseFloat(grid.style.getPropertyValue('--note-width'))||52;grid.style.setProperty('--note-width',Math.max(30,Math.min(65,n+(event.key==='ArrowRight'?2:-2)))+'%');}});
}
function renderFiles(){
  const i=S.enc.intake, docs=S.enc.documents, files=S.enc.attachments;
  return '<div class="section-title"><div><h2>Relato e documentos</h2><p>O relato original do paciente permanece separado da evolução médica.</p></div></div><div class="stack"><details class="card"><summary>Pré-consulta original · fonte: paciente</summary><dl>'+Object.entries(i).filter(([k])=>!['privacy_acknowledged','telemedicine_consent'].includes(k)).map(([k,v])=>'<div class="review-row"><dt>'+esc(intakeLabels[k]||k)+'</dt><dd>'+esc(typeof v==='object'&&v!==null?answer(v):v??'Não informado')+'</dd></div>').join('')+'</dl><p class="small">Ciência de privacidade: '+(i.privacy_acknowledged?'registrada pelo paciente':'não registrada')+' · Consentimento para teleconsulta informado pelo paciente: '+(i.telemedicine_consent?'sim':'não informado')+'. A conferência médica é registrada separadamente.</p></details><section><div class="row between" style="margin-bottom:15px"><h3>Exames e anexos privados</h3><label class="btn compact">'+icon('upload')+' Anexar<input type="file" data-upload="attachment" accept="application/pdf,image/png,image/jpeg" hidden></label></div><p class="small" style="margin-bottom:15px">PDF, PNG e JPEG, até 10 MB. Verificação de malware não integrada; arquivos são entregues como download privado.</p>'+files.map(f=>'<div class="document-row row between"><span>'+esc(f.filename)+'<br><small>'+Math.round(f.size/1024)+' KB · armazenamento privado</small></span>'+button(icon('download'),'fileDownload','compact','data-id="'+f.id+'" aria-label="Baixar anexo"')+'</div>').join('')+(!files.length?'<p class="muted small">Nenhum anexo recebido.</p>':'')+'</section><section><div class="row between" style="margin:20px 0"><h3>Documentos do atendimento</h3>'+button(icon('plus')+' Novo documento','newDocument','compact')+'</div><div class="document-list">'+(docs.map(renderDocument).join('')||'<p class="small">Nenhum documento preparado. Rascunhos e receitas em elaboração são visíveis somente ao médico.</p>')+'</div></section></div>';
}
const docKinds={prescription:'Receita médica',exam_request:'Solicitação de exames',referral:'Encaminhamento',guidance:'Orientações',certificate:'Documento médico',evolution:'Evolução e teleconsulta'};
function renderDocument(d){
  let actions=button(icon('download')+' '+(d.status==='ready'?'PDF para assinatura':d.status==='signed'||d.status==='delivered'?'PDF assinado verificado':'PDF de rascunho'),'pdf','compact','data-id="'+d.id+'"');
  if(d.status==='draft'||d.status==='review')actions+=button(d.status==='draft'?'Enviar para revisão':'Revisar e preparar versão final','transition','compact primary','data-id="'+d.id+'"');
  if(d.status==='ready')actions+='<label class="btn compact">'+icon('upload')+' Importar PDF assinado<input type="file" data-upload="signed" data-id="'+d.id+'" accept="application/pdf" hidden></label>';
  if(d.status==='signed')actions+=button('Disponibilizar ao paciente','transition','compact primary','data-id="'+d.id+'"');
  return '<article class="document-row"><div class="row between wrap"><h3>'+docKinds[d.kind]+'</h3><span class="tag '+(['signed','delivered'].includes(d.status)?'good':'warning')+'">'+statusLabel(d.status)+'</span></div><p class="small" style="margin-top:8px">Preparado em '+date(d.created_at,true)+'. '+(['draft','review'].includes(d.status)?'Exportações identificadas como rascunho.':d.status==='ready'?'Ainda não assinado. Entrega ao paciente bloqueada.':'Bytes assinados preservados.')+'</p>'+(d.verification&&!d.verification.verified?'<div class="notice error" style="margin-top:12px">'+esc(d.verification.reason)+'</div>':'')+'<div class="row wrap">'+actions+'</div></article>';
}
async function setTab(tab){
  S.readingPositions??={};
  if(S.readingTab)S.readingPositions[S.readingTab]=window.scrollY;
  S.tab=tab;
  S.readingTab=tab;
  if(S.enc)history.replaceState(null,'','/#atendimento='+encodeURIComponent(S.enc.id)+'&aba='+encodeURIComponent(tab));
  $$('.tab').forEach(el=>el.classList.toggle('active',el.dataset.tab===tab));
  $$('.tab-section').forEach(el=>el.hidden=el.dataset.section!==(tab==='note'||tab==='prescription'?'clinical':tab));
  $('.editor-area').classList.toggle('wide-rx',tab==='prescription');
  if(tab==='history'){
    const items=await api('/api/encounters/'+S.enc.id+'/versions');
    $('#history-content').innerHTML='<div class="pane-title"><div><h2>Memória do atendimento.</h2><p>Versões preservadas, com origem e momento do registro.</p></div>'+button('Novo retorno','followUp','compact')+'</div><div class="timeline">'+items.map(v=>'<div class="timeline-item"><small>'+date(v.created_at,true)+' · versão '+v.revision+' · '+esc(v.kind)+'</small><details><summary>Consultar conteúdo e origem</summary><p class="small">'+esc(v.actor.startsWith('patient:')?'Fonte: paciente':'Fonte: médico / ação supervisionada')+'</p><pre class="version-payload">'+esc(JSON.stringify(v.payload,null,2))+'</pre></details></div>').join('')+'</div>'+S.enc.addenda.map(a=>'<div class="card" style="margin:15px 0"><small>Adendo · '+date(a.created_at,true)+'</small><p style="white-space:pre-wrap">'+esc(a.text)+'</p></div>').join('')+'<div class="section-title"><h3>Atendimentos anteriores deste paciente</h3></div>'+S.enc.history.map(r=>'<div class="row between" style="margin:12px 0"><span>'+date(r.created_at,true)+' · '+statusLabel(r.status)+'</span>'+button('Abrir','open','compact','data-id="'+r.id+'"')+'</div>').join('');
  }
  window.scrollTo(0,S.readingPositions[tab]??0);
}
function profileForm(){
  const p=S.session.profile;
  return '<div class="page"><div class="page-header"><div><div class="eyebrow">IDENTIDADE E OPERAÇÃO</div><h1>Seu consultório.</h1><p>Complete somente informações reais e confira os dados antes de emitir documentos.</p></div></div><form data-form="profile" class="card stack" style="max-width:900px"><div class="form-grid">'+field('Nome profissional','name',p.name,{scope:'profile',required:true})+field('Atuação','specialty',p.specialty,{scope:'profile'})+field('CRM','crm',p.crm,{scope:'profile',required:true})+field('UF do CRM','crm_state',p.crm_state,{scope:'profile',required:true})+field('CPF do médico · vínculo do certificado','cpf',p.cpf,{scope:'profile'})+field('Contato profissional','professional_contact',p.professional_contact,{scope:'profile'})+field('Endereço profissional','professional_address',p.professional_address,{scope:'profile',wide:true})+field('Aviso de privacidade do consultório','privacy_notice',p.privacy_notice,{scope:'profile',area:true,wide:true,large:true,help:'Informe controlador, finalidade, acesso, direitos, contato e política de guarda aplicáveis. A ciência de privacidade é separada do consentimento de teleconsulta.'})+'</div><div class="notice">Assinatura ICP-Brasil: '+(S.session.capabilities.signature_configured?'configuração declarada; cada arquivo ainda exige verificação técnica.':'cadeia de confiança e CRLs precisam ser configuradas no servidor.')+'<br>SNCR e base de interações medicamentosas: não integrados. Emissão de receituários sujeitos a regras específicas bloqueada.</div><div id="form-error" role="alert"></div><div class="row"><button type="submit" class="btn primary">Salvar perfil</button>'+button('Consultar auditoria','audit','compact')+'</div></form><div style="margin-top:22px">'+button(icon('logout')+' Encerrar sessão','logout','subtle')+'</div></div>';
}
const intakeLabels={
  chief_complaint:'Queixa principal',expectation:'O que você espera da consulta?',original_report:'Relato original',
  onset:'Quando começou?',duration:'Há quanto tempo?',location:'Localização',radiation:'Irradiação',
  characteristic:'Como é o sintoma?',intensity:'Intensidade (opcional, 0–10)',frequency:'Frequência',
  evolution:'Como evoluiu?',aggravating:'O que piora?',relieving:'O que alivia?',associated:'Sintomas associados',
  explicit_negatives:'Sintomas que você explicitamente não apresenta',treatments_tried:'Tratamentos já tentados',
  conditions:'Doenças e antecedentes',medications:'Medicamentos em uso, com doses',
  allergies:'Alergias e tipo de reação',surgeries:'Cirurgias',family:'História familiar pertinente',psychosocial:'Contexto pessoal relevante'
};
function guardianFields(p,scope){
  return '<div id="guardian-fields" class="form-grid span2" '+(!p.needs_guardian&&!isMinor(p.birth_date)?'hidden':'')+'>'+field('Nome do responsável','guardian_name',p.guardian_name,{scope})+field('Vínculo com o paciente','guardian_relationship',p.guardian_relationship,{scope})+field('Contato do responsável','guardian_contact',p.guardian_contact,{scope,wide:true})+'</div>';
}
function isMinor(v){if(!v)return false;const p=zoneParts(new Date()), d=v.split('-').map(Number);return Number(p.year)-d[0]-(Number(p.month)<d[1]||(Number(p.month)===d[1]&&Number(p.day)<d[2])?1:0)<18;}
function patientFields(p,scope){
  return '<div class="form-grid">'+field('Nome completo','name',p.name,{scope,required:true,wide:true})+field('Nascimento','birth_date',p.birth_date||'',{scope,type:'date'})+field('Contato','contact',p.contact,{scope})+field('E-mail · opcional','email',p.email,{scope,type:'email'})+field('Documento de identificação','identification',p.identification,{scope})+field('Endereço','address',p.address,{scope,wide:true})+'<div class="span2">'+check('Precisa de responsável, além das situações de menoridade','needs_guardian',p.needs_guardian,scope)+'</div>'+guardianFields(p,scope)+'</div>';
}
async function patientPortal(){
  S.portal=await api('/api/patient');S.enc=null;S.dirty=false;S.conflict=false;S.step=0;
  const p=S.portal.patient,i=S.portal.intake,locked=!!S.portal.submitted_at;
  $('#app').innerHTML=(S.demo?'<div class="demo-banner">DEMONSTRAÇÃO · Use somente dados fictícios.</div>':'')+'<div class="patient-shell"><header class="patient-top">'+brand()+'<div class="small" style="text-align:right">'+esc(S.portal.doctor.name)+'<br>CRM-'+esc(S.portal.doctor.crm_state)+' '+esc(S.portal.doctor.crm)+'</div></header><main id="main" class="patient-body"><div class="patient-welcome"><div class="eyebrow">SEU ESPAÇO DE PRÉ-CONSULTA</div><h1>Vamos começar pela sua história.</h1><p>Conte com suas próprias palavras. Você pode deixar informações como “não informado” ou “não sabe”. Nenhuma resposta é presumida.</p></div>'+networkBanner()+'<div class="row between" style="margin-bottom:15px"><span class="tag">'+(locked?'Pré-consulta enviada':'Preenchimento privado')+'</span><span class="save-status saved">Salvo no servidor</span></div>'+(locked?'<div class="card stack"><h2>Seu relato chegou ao consultório.</h2><p>O médico poderá revisar as informações antes do encontro. Para corrigir ou complementar, entre em contato com o consultório.</p><p class="small">Enviado em '+date(S.portal.submitted_at,true)+'</p><div id="patient-docs">'+renderPatientDocuments()+'</div>'+button('Encerrar acesso','logout','subtle')+'</div>':'<nav class="wizard-steps" aria-label="Etapas da pré-consulta">'+['Você','Seu relato','Sua saúde','Anexos','Revisão'].map((l,k)=>'<button class="wizard-step '+(k===0?'active':'')+'" data-action="wizard" data-step="'+k+'"><i>'+(k+1)+'</i>'+l+'</button>').join('')+'</nav><div class="wizard-card"><section data-wizard="0"><div class="section-title"><div><h2>Antes de tudo, você.</h2><p>Confira a identificação e como podemos entrar em contato.</p></div></div>'+patientFields(p,'patient')+'</section><section data-wizard="1" hidden><div class="section-title"><div><h2>Conte o que está acontecendo.</h2><p>Use suas palavras. Detalhes opcionais aparecem se forem pertinentes.</p></div></div><div class="stack">'+field(intakeLabels.chief_complaint,'chief_complaint',i.chief_complaint,{scope:'intake',area:true,required:true})+field(intakeLabels.expectation,'expectation',i.expectation,{scope:'intake',area:true})+field('Conte livremente a história do problema','original_report',i.original_report,{scope:'intake',area:true,large:true})+'<details><summary>Organizar mais detalhes do problema · opcional</summary><div class="form-grid" style="margin-top:18px">'+Object.entries(intakeLabels).filter(([k])=>['onset','duration','location','radiation','characteristic','intensity','frequency','evolution','aggravating','relieving','associated','explicit_negatives','treatments_tried'].includes(k)).map(([k,l])=>field(l,k,i[k]??'',{scope:'intake',...(k==='intensity'?{type:'number'}:{area:true})})).join('')+'</div></details></div></section><section data-wizard="2" hidden><div class="section-title"><div><h2>Um pouco sobre sua saúde.</h2><p>“Nega”, “não sabe” e “não informado” têm significados diferentes.</p></div></div>'+['conditions','medications','allergies','surgeries','family','psychosocial'].map(k=>answerForm(intakeLabels[k],k,i[k],'intake')).join('')+'</section><section data-wizard="3" hidden><div class="section-title"><div><h2>Exames e documentos.</h2><p>Envie apenas o que for pertinente a esta consulta.</p></div></div><label class="btn">'+icon('upload')+' Selecionar arquivo<input type="file" data-upload="patientAttachment" accept="application/pdf,image/png,image/jpeg" hidden></label><p class="small" style="margin-top:15px">PDF, PNG ou JPEG, até 10 MB. Armazenamento privado, com acesso restrito ao seu atendimento.</p><div id="patient-attachments" style="margin-top:20px">'+renderPatientAttachments()+'</div></section><section data-wizard="4" hidden><div class="section-title"><div><h2>Revise antes de enviar.</h2><p>Seu relato permanece preservado na forma em que foi informado.</p></div></div><div id="intake-review"></div><div class="stack" style="margin-top:25px"><details class="notice"><summary>Aviso de privacidade do consultório</summary><p style="white-space:pre-wrap;margin-top:12px">'+esc(S.portal.doctor.privacy_notice||'O consultório ainda precisa configurar seu aviso de privacidade. Solicite a informação antes do envio.')+'</p></details>'+check('Li e tomei ciência do aviso de privacidade','privacy_acknowledged',i.privacy_acknowledged,'intake')+check('Concordo com a realização da teleconsulta após esclarecimento pelo consultório','telemedicine_consent',i.telemedicine_consent,'intake')+'<p class="small">O consentimento para teleconsulta é separado da ciência de privacidade. Não há autorização de gravação ou transcrição neste formulário.</p></div></section><footer class="wizard-footer">'+button(icon('back')+' Voltar','wizardPrev')+'<span id="wizard-next">'+button('Continuar '+icon('arrow'),'wizardNext','primary')+'</span></footer></div>')+'<p class="small" style="margin-top:23px">Este formulário não é monitoramento de urgência. Seus documentos só aparecem aqui após liberação do médico e verificação da assinatura.</p></main></div>';
  toggleAnswers();updateGuardian();if(!locked)wizard(0);
}
function renderPatientDocuments(){return '<h3>Documentos disponibilizados</h3>'+(S.portal.documents.length?S.portal.documents.map(d=>'<div class="document-row row between" style="margin-top:12px"><span>'+docKinds[d.kind]+'<br><small>Assinatura tecnicamente verificada</small></span>'+button(icon('download')+' Baixar','pdf','compact','data-id="'+d.id+'"')+'</div>').join(''):'<p class="small" style="margin-top:10px">Nenhum documento foi disponibilizado até o momento.</p>');}
function renderPatientAttachments(){return (S.portal.attachments||[]).map(f=>'<div class="document-row row between"><span>'+esc(f.filename)+'</span>'+button(icon('download'),'fileDownload','compact','data-id="'+f.id+'" aria-label="Baixar seu anexo"')+'</div>').join('')||'<p class="small">Nenhum arquivo anexado.</p>';}
function toggleAnswers(){
  $$('[data-intake$=".status"],[data-draft$="companion.status"]').forEach(el=>{const attr=el.hasAttribute('data-intake')?'intake':'draft',path=el.getAttribute('data-'+attr).replace('.status','.text');const text=$('[data-'+attr+'="'+path+'"]');if(text)text.disabled=el.value!=='informed'||!!S.enc?.finalized_at;});
}
function updateGuardian(){const p=S.portal?.patient||S.editPatient;if(!p||!$('#guardian-fields'))return;$('#guardian-fields').hidden=!p.needs_guardian&&!isMinor(p.birth_date);}
function wizard(step){
  S.step=Math.max(0,Math.min(4,Number(step)));
  $$('[data-wizard]').forEach(el=>el.hidden=Number(el.dataset.wizard)!==S.step);
  $$('.wizard-step').forEach(el=>el.classList.toggle('active',Number(el.dataset.step)===S.step));
  $('#wizard-next').innerHTML=S.step===4?button('Revisar e enviar '+icon('check'),'submitIntake','primary'):button('Continuar '+icon('arrow'),'wizardNext','primary');
  if(S.step===4)$('#intake-review').innerHTML='<dl>'+Object.entries(intakeLabels).map(([k,l])=>'<div class="review-row"><dt>'+esc(l)+'</dt><dd>'+esc(typeof S.portal.intake[k]==='object'&&S.portal.intake[k]!==null?answer(S.portal.intake[k]):S.portal.intake[k]??'Não informado')+'</dd></div>').join('')+'</dl>';
}
async function downloadApi(path,filename){
  const blob=await api(path,{binary:true});downloadBlob(blob,filename);
}
function downloadBlob(blob,filename){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),15000);}
function propose(proposal,source){
  const old=S.enc.draft.note, fields=Object.keys(proposal).filter(k=>typeof proposal[k]==='string'&&k!=='format'&&proposal[k]!==old[k]);
  S.proposal={proposal,source};
  modal(source==='ai'?'Sugestão de IA · revisão obrigatória':'Organização literal do relato','<p class="small" style="margin-bottom:20px">A redação atual só será substituída nos campos que você selecionar. O relato original do paciente continua preservado.</p>'+fields.map(k=>'<section style="margin-bottom:22px"><label class="check"><input type="checkbox" data-apply-note="'+esc(k)+'" '+(!old[k]?'checked':'')+'><span>Aplicar em '+esc(k)+'</span></label><div class="diff-grid" style="margin-top:10px"><div><div class="diff-label">Redação atual do médico</div><div class="diff-panel">'+esc(old[k]||'Campo vazio')+'</div></div><div><div class="diff-label">Proposta · fonte: '+(source==='ai'?'IA não confirmada':'paciente')+'</div><div class="diff-panel">'+esc(proposal[k])+'</div></div></div></section>').join('')+(!fields.length?'<div class="notice">Nenhuma alteração proposta.</div>':''),button('Manter meu texto','closeModal')+button('Aplicar campos selecionados','applyProposal','primary'));
}
async function compareConflict(){
  if(!S.conflict){toast('Nenhum conflito de versão pendente.');return;}
  const latest=await api(S.enc?'/api/encounters/'+S.enc.id:'/api/patient');
  S.serverVersion=latest;
  const local=S.enc?S.enc.draft:S.portal.intake, remote=S.enc?latest.draft:latest.intake;
  modal('Duas versões, nenhuma sobrescrita.','<p class="small" style="margin-bottom:18px">Compare antes de decidir. Você pode baixar seu texto e abrir a versão do servidor. Não há mesclagem automática.</p><div class="diff-grid"><div><div class="diff-label">Seu texto nesta aba</div><pre class="diff-panel">'+esc(JSON.stringify(local,null,2))+'</pre></div><div><div class="diff-label">Versão atual do servidor</div><pre class="diff-panel">'+esc(JSON.stringify(remote,null,2))+'</pre></div></div>',button('Baixar meu rascunho','exportUnsaved')+button('Continuar nesta tela','closeModal')+button('Abrir versão do servidor','useServerVersion','primary'));
}
async function action(name,el){
  const index=Number(el?.dataset.index);
  if(name==='closeModal'){closeModal();return;}
  if(name==='home')return home();
  if(name==='newEncounter'){newEncounter();return;}
  if(name==='open')return openEncounter(el.dataset.id);
  if(name==='tab')return setTab(el.dataset.tab);
  if(name==='retrySave'){if(S.conflict)return compareConflict();return save();}
  if(name==='compareConflict')return compareConflict();
  if(name==='settings'){
    if(!await flush())return;
    S.enc=null;S.portal=null;S.session.profile=await api('/api/profile');shell(profileForm(),'settings','Meu consultório');return;
  }
  if(name==='logout'){
    if(!await flush())return;
    await api('/api/logout',{method:'POST'});S.session=null;S.enc=null;S.portal=null;loginPage();return;
  }
  if(name==='demo'){
    S.session=await api('/api/demo',{method:'POST'});S.session=await api('/api/session');await home();return;
  }
  if(name==='medAdd'){
    S.enc.draft.medications.push({id:crypto.randomUUID(),ingredient:'',brand:'',strength:'',strength_unit:'',presentation:'',dose:'',dose_unit:'',route:'',frequency:'',duration:'',continuous:false,quantity:'',dispensing_unit:'',as_needed:false,condition:'',minimum_interval:'',daily_limit:'',prn_exception_reason:'',instructions:'',variable_schedule:'',category:'unclassified',favorite_id:null});markDirty();renderRxItems();return;
  }
  if(['medUp','medDown','medRemove','medCopy'].includes(name)){
    const items=S.enc.draft.medications;
    if(name==='medRemove')items.splice(index,1);
    if(name==='medCopy')items.splice(index+1,0,{...structuredClone(items[index]),id:crypto.randomUUID()});
    if(name==='medUp'&&index>0)[items[index-1],items[index]]=[items[index],items[index-1]];
    if(name==='medDown'&&index<items.length-1)[items[index+1],items[index]]=[items[index],items[index+1]];
    markDirty();renderRxItems();return;
  }
  if(name==='medFavorite'){await api('/api/favorites',{method:'POST',body:S.enc.draft.medications[index]});toast('Favorito salvo. Ao reutilizar, reconfirme para o paciente atual.');return;}
  if(name==='favoriteList'){
    const favorites=await api('/api/favorites');
    modal('Favoritos do seu consultório','<p class="small" style="margin-bottom:18px">A aplicação de um favorito não confirma a indicação, dose ou adequação para este paciente.</p>'+favorites.map(f=>'<div class="document-row row between"><span>'+esc(f.medication.ingredient||'Item sem nome')+'<br><small>'+esc(f.medication.strength)+' '+esc(f.medication.strength_unit)+'</small></span>'+button('Aplicar e revisar','applyFavorite','compact','data-id="'+f.id+'"')+'</div>').join('')+(!favorites.length?'<p class="small">Nenhum favorito salvo. Use o ícone de coração em um item preenchido.</p>':''),button('Fechar','closeModal'));return;
  }
  if(name==='applyFavorite'){
    const r=await api('/api/encounters/'+S.enc.id+'/favorites/'+el.dataset.id,{method:'POST'});
    S.enc.draft.medications.push(r.medication);markDirty();closeModal();renderRxItems();return;
  }
  if(name==='confirmFavorite'){
    if(!await flush())return;
    await api('/api/encounters/'+S.enc.id+'/medications/'+S.enc.draft.medications[index].id+'/confirm-favorite',{method:'POST'});
    toast('Favorito reconfirmado para este atendimento.');el.textContent='Reconfirmado neste atendimento';return;
  }
  if(name==='organize'){
    if(!await flush())return;
    const r=await api('/api/encounters/'+S.enc.id+'/organize',{method:'POST'});propose(r.proposal,'patient');return;
  }
  if(name==='ai'){
    modal('IA como apoio supervisionado','<div class="notice">A redação médica permanece intacta. Apenas um trecho do relato, com identificadores conhecidos removidos, será enviado à API. Nenhum diagnóstico ou prescrição será confirmado automaticamente.</div><p class="small" style="margin-top:15px">A minimização automática não garante anonimização de todo texto livre. Utilize somente após configurar as condições de tratamento de dados com o provedor.</p>',button('Continuar manualmente','closeModal')+button('Solicitar sugestão minimizada','requestAI','primary'));return;
  }
  if(name==='requestAI'){
    if(!await flush())return;
    const r=await api('/api/encounters/'+S.enc.id+'/ai',{method:'POST',body:{allow_external_processing:true}});
    const note={hpma:r.proposal.hpma};propose(note,'ai');
    $('#modal-content').insertAdjacentHTML('beforeend','<div class="notice" style="margin-top:15px"><strong>Contradições e perguntas sugeridas</strong><p>'+esc([...r.proposal.contradictions,...r.proposal.questions].join('\n')||'Nenhuma observação retornada. Isso não significa ausência de contradições.')+'</p><p>Nenhuma referência externa foi consultada.</p></div>');return;
  }
  if(name==='applyProposal'){
    $$('[data-apply-note]:checked').forEach(el=>{
      const key=el.dataset.applyNote,value=S.proposal.proposal[key];S.enc.draft.note[key]=value;
      S.enc.draft.note.sources??={};S.enc.draft.note.sources[key]=S.proposal.source;
      const input=$('[data-draft="note.'+key+'"]');if(input)input.value=value;
    });
    markDirty();closeModal();toast('Trechos selecionados aplicados. A revisão médica continua necessária.');return;
  }
  if(name==='vitalAdd'){S.enc.draft.tele.vitals.push({id:crypto.randomUUID(),kind:'',value:'',unit:'',source:'',measured_at:null});markDirty();$('#vitals').innerHTML=renderVitals();return;}
  if(name==='vitalRemove'){S.enc.draft.tele.vitals.splice(index,1);markDirty();$('#vitals').innerHTML=renderVitals();return;}
  if(name==='teleStart'||name==='teleEnd'){
    if(!await flush())return;
    const r=await api('/api/encounters/'+S.enc.id+'/tele/'+(name==='teleStart'?'start':'end'),{method:'POST',body:{revision:S.enc.revision}});
    Object.assign(S.enc,r);updateTimer();toast(name==='teleStart'?'Início registrado no servidor.':'Término registrado no servidor.');return;
  }
  if(name==='call'){
    if(!await flush())return;
    const r=await api('/api/encounters/'+S.enc.id+'/call');
    modal('Abrir plataforma de teleconsulta','<p>O atendimento será aberto em uma nova aba da plataforma escolhida. A aplicação não simula, grava ou transcreve a chamada.</p><p class="small" style="margin-top:15px">'+esc(new URL(r.url).hostname)+'</p>','<a class="btn primary" href="'+esc(r.url)+'" target="_blank" rel="noopener noreferrer">Acessar chamada externa '+icon('arrow')+'</a>');return;
  }
  if(name==='invite'){
    if(!await flush())return;
    const r=await api('/api/encounters/'+S.enc.id+'/invitations',{method:'POST'});S.newInvite=r;
    const invites=await api('/api/encounters/'+S.enc.id+'/invitations');
    modal('Convite privado para pré-consulta','<div class="notice">Link de uso único, válido por 72 horas. Compartilhe por um canal seguro com o paciente. Nenhuma mensagem foi enviada automaticamente.</div><label class="field" style="margin:20px 0"><span>Link do convite · exibido nesta emissão</span><textarea id="invite-url" rows="3" readonly>'+esc(r.url)+'</textarea></label><p class="small">Para testar sem substituir sua sessão médica, abra uma janela privada.</p><div class="stack" style="margin-top:22px">'+invites.map(v=>'<div class="row between"><span class="small">'+date(v.created_at,true)+' · '+(v.revoked_at?'Revogado':v.used_at?'Utilizado':'Não utilizado')+'</span>'+(!v.revoked_at?button('Revogar acesso','revokeInvite','compact danger','data-id="'+v.id+'"'):'')+'</div>').join('')+'</div>',button('Copiar link','copyInvite','primary'));return;
  }
  if(name==='copyInvite'){try{await navigator.clipboard.writeText(S.newInvite.url);toast('Link copiado.');}catch{$('#invite-url').select();toast('Selecione e copie o link.');}return;}
  if(name==='revokeInvite'){await api('/api/invitations/'+el.dataset.id,{method:'DELETE'});el.parentElement.innerHTML='<span class="tag">Convite e sessões vinculadas revogados</span>';return;}
  if(name==='patientEdit'){
    if(!await flush())return;S.editPatient=structuredClone(S.enc.patient);
    modal('Conferir cadastro do paciente','<form data-form="patientEdit">'+patientFields(S.editPatient,'editpatient')+'<div id="form-error"></div><div class="modal-foot">'+button('Cancelar','closeModal')+'<button class="btn primary" type="submit">Salvar correção com histórico</button></div></form>');return;
  }
  if(name==='finalize'){
    if(!await flush())return;
    modal('Revisão antes da finalização','<div class="notice">A evolução e o registro da teleconsulta ficarão imutáveis. Complementações serão registradas em adendos. Prescrições posteriores serão revisadas como novos documentos.</div><label class="check" style="margin-top:22px"><input type="checkbox" id="medical-review"><span>Revisei a identificação, o relato, os achados documentados, a avaliação e o plano deste atendimento.</span></label>',button('Voltar à revisão','closeModal')+button('Confirmar finalização','confirmFinalize','primary'));return;
  }
  if(name==='confirmFinalize'){
    if(!$('#medical-review').checked){toast('Confirme a revisão médica.');return;}
    const r=await api('/api/encounters/'+S.enc.id+'/finalize',{method:'POST',body:{revision:S.enc.revision,medical_review_confirmed:true}});
    Object.assign(S.enc,r);closeModal();S.enc=await api('/api/encounters/'+S.enc.id);renderWorkspace();toast('Evolução finalizada e preservada.');return;
  }
  if(name==='addendum'){
    modal('Acrescentar adendo','<form data-form="addendum"><label class="field"><span>Complementação médica · o registro anterior será preservado</span><textarea name="text" rows="7" minlength="5" required></textarea></label><div id="form-error"></div><div class="modal-foot">'+button('Cancelar','closeModal')+'<button class="btn primary" type="submit">Registrar adendo</button></div></form>');return;
  }
  if(name==='newDocument'){
    if(!await flush())return;
    const kind=el.dataset.kind||'guidance';
    modal('Preparar documento médico','<form data-form="newDocument"><div class="stack">'+select('Tipo de documento','kind',kind,Object.entries(docKinds),'doc')+'<label class="field"><span>Conteúdo revisado pelo médico · opcional na receita estruturada</span><textarea name="content" rows="7"></textarea></label><div class="notice">A receita usará os itens estruturados atuais e as orientações. Não inclui automaticamente diagnóstico ou CID. A criação gera um rascunho privado.</div><div id="form-error"></div><div class="modal-foot">'+button('Voltar à edição','closeModal')+'<button type="submit" class="btn primary">Criar rascunho</button></div></div></form>');return;
  }
  if(name==='transition'){
    const doc=await api('/api/documents/'+el.dataset.id);S.currentDocument=doc;
    if(doc.status==='draft'){
      await api('/api/documents/'+doc.id+'/transition',{method:'POST',body:{revision:doc.revision,target:'review',medical_review_confirmed:false}});await reloadDocuments();return;
    }
    const target=doc.status==='review'?'ready':'delivered';S.documentTarget=target;
    modal(target==='ready'?'Revisão do documento final':'Disponibilizar com acesso privado','<div class="notice">'+(target==='ready'?'Confira paciente, identificação profissional, conteúdo, dose, concentração, unidade, via, frequência, duração, quantidade e categoria. A versão final será congelada antes da assinatura.':'O paciente poderá acessar o PDF assinado pelo seu portal. O servidor conferirá novamente o hash e o resultado da assinatura.')+'</div>'+(target==='ready'?'<div class="rx-preview">'+esc(doc.payload.kind==='prescription'?doc.payload.medications.map(medLines).join('\n\n'):(doc.payload.content||''))+'</div>':'')+'<label class="check" style="margin-top:18px"><input type="checkbox" id="document-review"><span>Confirmei o paciente e revisei este documento antes de prosseguir.</span></label>',button('Voltar','closeModal')+button(target==='ready'?'Preparar PDF para assinatura':'Disponibilizar documento','confirmTransition','primary'));return;
  }
  if(name==='confirmTransition'){
    if(!$('#document-review').checked){toast('Confirme a revisão do documento.');return;}
    const d=S.currentDocument;await api('/api/documents/'+d.id+'/transition',{method:'POST',body:{revision:d.revision,target:S.documentTarget,medical_review_confirmed:true}});closeModal();await reloadDocuments();return;
  }
  if(name==='pdf'){await downloadApi('/api/documents/'+el.dataset.id+'/pdf','documento-medico-'+el.dataset.id.slice(0,8)+'.pdf');return;}
  if(name==='fileDownload'){await downloadApi('/api/files/'+el.dataset.id,'anexo-'+el.dataset.id.slice(0,8));return;}
  if(name==='wizard'){wizard(el.dataset.step);return;}
  if(name==='wizardPrev'){wizard(S.step-1);return;}
  if(name==='wizardNext'){wizard(S.step+1);return;}
  if(name==='submitIntake'){
    if(!await flush())return;
    await api('/api/patient/intake',{method:'PUT',body:{revision:S.portal.revision,patient:S.portal.patient,intake:S.portal.intake,submit:true}});
    toast('Pré-consulta enviada ao consultório.');await patientPortal();return;
  }
  if(name==='anonymized'){
    if(!await flush())return;
    const r=await api('/api/encounters/'+S.enc.id+'/anonymized');
    modal('Revisar exportação anonimizada','<div class="notice">'+esc(r.warning)+'</div><label class="field" style="margin-top:20px"><span>Revise e remova identificadores remanescentes</span><textarea id="anonymous-content" rows="13">'+esc(JSON.stringify(r.content,null,2))+'</textarea></label><label class="check" style="margin-top:18px"><input type="checkbox" id="anonymous-reviewed"><span>Revisei o conteúdo e a finalidade antes da exportação.</span></label>',button('Cancelar','closeModal')+button('Baixar texto revisado','downloadAnonymous','primary'));return;
  }
  if(name==='downloadAnonymous'){if(!$('#anonymous-reviewed').checked){toast('Revise o texto antes de exportar.');return;}downloadBlob(new Blob([$('#anonymous-content').value],{type:'text/plain;charset=utf-8'}),'caso-revisado-anonimizado.txt');return;}
  if(name==='exportUnsaved'){downloadBlob(new Blob([JSON.stringify(S.enc?.draft||S.portal?.intake,null,2)],{type:'application/json'}),'rascunho-privado-nao-sincronizado.json');return;}
  if(name==='useServerVersion'){
    S.dirty=false;S.conflict=false;closeModal();
    if(S.enc){S.enc=S.serverVersion;renderWorkspace();}else await patientPortal();return;
  }
  if(name==='followUp'){
    if(!await flush())return;
    const r=await api('/api/patients/'+S.enc.patient_id+'/encounters',{method:'POST'});
    await openEncounter(r.id);toast('Novo atendimento criado vazio, preservando o histórico anterior.');return;
  }
  if(name==='audit'){
    const rows=await api('/api/audit');
    modal('Auditoria do consultório','<p class="small" style="margin-bottom:18px">Ações, identificadores e datas. Conteúdo clínico não é reproduzido nos logs.</p><div class="timeline">'+rows.map(r=>'<div class="timeline-item"><small>'+date(r.created_at,true)+'</small><p>'+esc(r.action)+'</p><small>Referência: '+esc(r.reference||'operação administrativa')+'</small></div>').join('')+'</div>',button('Fechar','closeModal'));return;
  }
}
async function reloadDocuments(){
  const refreshed=await api('/api/encounters/'+S.enc.id);S.enc.documents=refreshed.documents;
  $('[data-section="files"]').innerHTML=renderFiles();await setTab('files');toast('Documento atualizado no servidor.');
}
document.addEventListener('click',async event=>{
  const el=event.target.closest('[data-action]');if(!el)return;event.preventDefault();
  try{await action(el.dataset.action,el);}catch(err){errorModal(err);}
});
document.addEventListener('keydown',event=>{if(event.key==='Enter'&&event.target.matches('[role="button"][data-action]')){event.preventDefault();event.target.click();}});
document.addEventListener('input',event=>{
  const el=event.target;
  if(el.id==='search'){renderRecords(el.value);return;}
  try{
    let value=el.type==='checkbox'?el.checked:el.value;
    if(el.hasAttribute('data-draft')){
      const path=el.dataset.draft;
      if(path.endsWith('.status')&&value!=='informed'&&getPath(S.enc.draft,path.replace('.status','.text'))){el.value='informed';toast('Há um relato neste campo. Apague-o explicitamente antes de alterar a situação.');return;}
      setPath(S.enc.draft,path,value);
      if(path.startsWith('note.')&&path!=='note.format'){S.enc.draft.note.sources??={};S.enc.draft.note.sources[path.slice(5)]='doctor';}
      if(path==='note.format')toggleNoteFormat();toggleAnswers();markDirty();if(path==='prescription_text')renderRxPreview();
    }else if(el.hasAttribute('data-med')){
      const med=S.enc.draft.medications[Number(el.dataset.med)];med[el.dataset.key]=value;
      if(el.dataset.key==='as_needed')el.closest('.rx-item').querySelector('.prn-fields').hidden=!value;
      markDirty();renderRxPreview();
    }else if(el.hasAttribute('data-vital')){
      if(el.dataset.key==='measured_at')value=localToISO(value);
      S.enc.draft.tele.vitals[Number(el.dataset.vital)][el.dataset.key]=value;markDirty();
    }else if(el.hasAttribute('data-patient')){S.portal.patient[el.dataset.patient]=value;updateGuardian();markDirty();}
    else if(el.hasAttribute('data-editpatient')){S.editPatient[el.dataset.editpatient]=value;updateGuardian();}
    else if(el.hasAttribute('data-intake')){
      const path=el.dataset.intake;
      if(path.endsWith('.status')&&value!=='informed'&&getPath(S.portal.intake,path.replace('.status','.text'))){el.value='informed';toast('Seu relato está preservado. Apague o texto antes de selecionar outro estado.');return;}
      if(path==='intensity')value=value===''?null:Number(value);
      setPath(S.portal.intake,path,value);toggleAnswers();markDirty();
    }
  }catch(err){toast(err.message);}
});
document.addEventListener('change',async event=>{
  const el=event.target;if(!el.dataset.upload||!el.files?.[0])return;
  const file=el.files[0], kind=el.dataset.upload;
  try{
    if(file.size>(kind==='signed'?15:10)*1024*1024)throw new Error('O arquivo excede o limite permitido.');
    if(!await flush())return;
    const endpoint=kind==='signed'?'/api/documents/'+el.dataset.id+'/signed-import':'/api/encounters/'+(S.enc?.id||S.portal.encounter_id)+'/attachments';
    const result=await api(endpoint,{method:'POST',headers:{'Content-Type':file.type||'application/octet-stream','X-File-Name':encodeURIComponent(file.name)},body:file});
    if(kind==='signed'){
      await reloadDocuments();
      modal(result.verified?'Assinatura tecnicamente verificada':'Assinatura não verificada','<div class="notice '+(result.verified?'success':'error')+'">'+esc(result.reason)+'</div><p class="small" style="margin-top:15px">'+(result.verified?'O arquivo foi preservado. A entrega ainda exige a ação explícita do médico.':'O documento permanece bloqueado para entrega como assinado.')+'</p>',button('Fechar','closeModal'));
    }else if(S.enc){
      const record=await api('/api/encounters/'+S.enc.id);S.enc.attachments=record.attachments;$('[data-section="files"]').innerHTML=renderFiles();toast('Arquivo armazenado de forma privada.');
    }else{const record=await api('/api/patient');S.portal.attachments=record.attachments;$('#patient-attachments').innerHTML=renderPatientAttachments();toast('Arquivo recebido e armazenado de forma privada.');}
  }catch(err){errorModal(err);}finally{el.value='';}
});
document.addEventListener('submit',async event=>{
  const form=event.target;if(!form.dataset.form)return;event.preventDefault();
  const submit=$('button[type="submit"]',form);if(submit)submit.disabled=true;
  try{
    const kind=form.dataset.form;
    if(kind==='login'){
      const data=new FormData(form);S.session=await api('/api/login',{method:'POST',body:{username:data.get('username'),password:data.get('password')}});
      S.session=await api('/api/session');if(S.session.role==='doctor')await home();else await patientPortal();
    }else if(kind==='newEncounter'){
      const patient={};$$('[data-new]',form).forEach(el=>patient[el.dataset.new]=el.value||null);
      if(!patient.contact)patient.contact='';
      const r=await api('/api/encounters',{method:'POST',body:{patient}});closeModal();await openEncounter(r.id);
    }else if(kind==='profile'){
      const profile={};$$('[data-profile]',form).forEach(el=>profile[el.dataset.profile]=el.value);
      S.session.profile=await api('/api/profile',{method:'PUT',body:profile});toast('Perfil e aviso de privacidade salvos no servidor.');
    }else if(kind==='patientEdit'){
      await api('/api/encounters/'+S.enc.id+'/patient',{method:'PUT',body:{revision:S.enc.revision,patient:S.editPatient,intake:S.enc.intake,submit:false}});
      closeModal();await openEncounter(S.enc.id);
    }else if(kind==='addendum'){
      await api('/api/encounters/'+S.enc.id+'/addenda',{method:'POST',body:{text:new FormData(form).get('text')}});
      closeModal();S.enc=await api('/api/encounters/'+S.enc.id);await setTab('history');
    }else if(kind==='newDocument'){
      if(!await flush())return;
      await api('/api/encounters/'+S.enc.id+'/documents',{method:'POST',body:{kind:$('[data-doc="kind"]',form).value,content:new FormData(form).get('content'),encounter_revision:S.enc.revision}});
      closeModal();await reloadDocuments();
    }
  }catch(err){
    const box=$('#form-error',form)||$('#login-error',form);
    if(box){box.className='notice error';box.hidden=false;box.textContent=errors(err);}else errorModal(err);
  }finally{if(submit)submit.disabled=false;}
});
window.addEventListener('beforeunload',event=>{if(S.dirty||S.saving){event.preventDefault();event.returnValue='';}});
window.addEventListener('online',()=>{if(S.dirty&&!S.conflict)save();});
window.addEventListener('pagehide',()=>{
  if(!S.dirty||S.conflict||!S.session)return;
  const doctor=S.session.role==='doctor',endpoint=doctor?'/api/encounters/'+S.enc.id+'/draft':'/api/patient/intake';
  const body=doctor?{revision:S.enc.revision,draft:S.enc.draft}:{revision:S.portal.revision,patient:S.portal.patient,intake:S.portal.intake,submit:false};
  const encoded=JSON.stringify(body);if(encoded.length<60000)fetch(endpoint,{method:'PUT',headers:{'Content-Type':'application/json','X-CSRF-Token':S.session.csrf},body:encoded,credentials:'same-origin',keepalive:true}).catch(()=>{});
});
setInterval(updateTimer,1000);
async function boot(){
  try{
    const health=await api('/health');S.demo=health.demo_enabled;
    const token=new URLSearchParams(location.hash.slice(1)).get('token');
    if(token){await api('/api/invitations/exchange',{method:'POST',body:{token}});history.replaceState(null,'','/convite');}
    try{S.session=await api('/api/session');}catch(err){if(err.status===401){loginPage();return;}throw err;}
    if(S.session.role==='doctor'){
      const route=new URLSearchParams(location.hash.slice(1)),id=route.get('atendimento'),tab=route.get('aba');
      if(id){await openEncounter(id);if(['note','prescription','tele','files','history'].includes(tab))await setTab(tab);}
      else await home();
    }else await patientPortal();
  }catch(err){
    $('#app').innerHTML='<main id="main" class="patient-body"><div style="margin:35px 0">'+brand()+'</div><div class="card stack"><h1>Acesso não concluído.</h1><p>'+esc(errors(err))+'</p><a href="/" class="btn">Voltar à entrada</a></div></main>';
  }
}
boot();

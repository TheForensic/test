let CSRF = null;

async function fetchJSON(url, opts){
  opts = opts || {};
  opts.headers = opts.headers || {};
  if (CSRF && (opts.method||'GET').toUpperCase() !== 'GET') opts.headers['x-csrf'] = CSRF;
  const res = await fetch(url, opts);
  return await res.json();
}

function showTab(name){
  document.querySelectorAll('.tab').forEach(el=>el.classList.remove('active'));
  document.getElementById('tab-'+name).classList.add('active');
}

document.querySelectorAll('nav a').forEach(a=>{
  a.addEventListener('click', (e)=>{
    e.preventDefault();
    showTab(a.dataset.tab);
  });
});

document.getElementById('logout').onclick = async ()=>{
  await fetchJSON('/auth/logout',{method:'POST'});
  location.href = '/panel/login';
};

async function refresh(){
  const h = await fetchJSON('/health');
  document.getElementById('status').textContent = `running=${h.running}, lastRun=${h.lastRun||'-'}, nextRun=${h.nextRun||'-'}`;
  document.getElementById('ver').textContent = h.version || '1.0.0';
  const cfg = await fetchJSON('/config');
  document.getElementById('port').value = cfg.config.PORT || '';
  document.getElementById('bindhost').value = cfg.config.BIND_HOST || '';
  document.getElementById('disableCron').checked = (cfg.config.DISABLE_INTERNAL_CRON||'').toString().toLowerCase()==='true';
}

document.getElementById('runNow').onclick = async ()=>{
  const r = await fetchJSON('/run');
  alert(JSON.stringify(r));
  refresh();
};

document.getElementById('applySched').onclick = async ()=>{
  const daily = document.querySelector('input[name="schedMode"][value="daily"]').checked;
  const disable = document.getElementById('disableCron').checked;
  const body = {};
  if (disable){ body.DISABLE_INTERNAL_CRON = true; }
  if (daily){
    const hhmm = document.getElementById('hhmm').value.trim();
    const m = hhmm.match(/^(\d{2}):(\d{2})$/);
    if(!m) return alert('Invalid HH:MM');
    const [_,hh,mm] = m;
    body.CRON_SCHEDULE = `${mm} ${hh} * * *`;
    body.INTERVAL_HOURS = '';
  } else {
    const n = parseInt(document.getElementById('hours').value,10);
    if(!(n>0)) return alert('Invalid hours');
    body.CRON_SCHEDULE = '';
    body.INTERVAL_HOURS = n;
  }
  const j = await fetchJSON('/config',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  if(j.ok){document.getElementById('schedMsg').textContent = 'Saved'; refresh();}
}

document.getElementById('saveSecrets').onclick = async ()=>{
  const tok = document.getElementById('tok').value.trim();
  const chat = document.getElementById('chat').value.trim();
  const j=await fetchJSON('/secrets',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({TELEGRAM_BOT_TOKEN:tok, TELEGRAM_CHAT_ID:chat})});
  if(j.ok){ document.getElementById('secMsg').textContent='Saved'; }
}

async function loadLogs(){
  const j = await fetchJSON('/logs');
  if(j.ok){ document.getElementById('logs').textContent = j.logs.join('\n'); }
}

// get CSRF
fetchJSON('/panel/csrf').then(({csrf})=>{ CSRF = csrf; }).catch(()=>{});
refresh();
loadLogs();
setInterval(()=>{refresh(); loadLogs();}, 10000);

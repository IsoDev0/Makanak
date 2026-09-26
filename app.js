'use strict';
let state, token, busy = false, frameBusy = false;
const $ = id => document.getElementById(id);
const text = (id, value) => { $(id).textContent = value; };
const time = value => new Date(value * 1000).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'});
function error(message) { text('toast', message); $('toast').hidden = false; setTimeout(() => {$('toast').hidden = true;}, 7000); }
async function post(route, data = {}) {
  try {
    const response = await fetch(route, {method:'POST',headers:{'Content-Type':'application/json','X-Makanak-Token':token},body:JSON.stringify(data)});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Request failed');
    await refresh();
    return result;
  } catch (e) { error(e.message); }
}
function rowCell(row, value) { const cell = document.createElement('td'); cell.textContent = value; row.append(cell); return cell; }
function diagnostic(title, detail, ok, label) {
  const row = document.createElement('div'); row.className = 'diagnostic';
  const left = document.createElement('div'); left.textContent = title;
  const small = document.createElement('small'); small.textContent = detail; left.append(small);
  const right = document.createElement('span'); right.className = ok ? 'good' : 'bad'; right.textContent = label || (ok ? 'Ready' : 'Check');
  row.append(left, right); return row;
}
function render(s) {
  const demo = s.mode === 'demo', online = s.mqtt.online;
  text('modeLabel', demo ? 'DEMO MODE' : 'HARDWARE MODE');
  text('modeButton', demo ? 'Connect hardware ↗' : 'Switch to demo');
  text('notice', demo ? 'Demo mode is active. Controls are simulated; no hardware commands are sent.' : 'Hardware mode is active. Controls send real commands to your ESP32.');
  text('spotLabel', s.spot); text('brokerStatus', s.mqtt.connected ? 'Connected' : (demo ? 'Demo · disconnected' : 'Not connected'));
  text('brokerDetail', s.mqtt.error || 'TLS connected · port ' + s.connection.port);
  text('deviceStatus', demo ? 'Simulated device' : online ? 'Online' : 'No fresh heartbeat');
  text('deviceDetail', s.mqtt.last_seen ? 'Last seen ' + time(s.mqtt.last_seen) : 'Fresh heartbeat required');
  text('cameraStatus', s.camera.status); text('cameraDetail', s.camera.error || s.camera.method || 'Local camera · English plate text');
  $('visionMode').value = s.camera.mode;
  text('cameraChip', s.camera.status === 'Camera running' ? 'CAMERA LIVE' : 'AI VISION');
  text('controlMode', demo ? 'Simulated controls' : 'Live ESP32 controls');
  const device = demo ? s.demo : s.mqtt.device;
  text('spaceState', !demo && !online ? 'Unknown / offline' : device.alert ? 'Alarm active' : device.reserved ? 'Reserved' : 'Available');
  text('position', 'Commanded servo: ' + (device.position ?? 'unknown') + (demo ? '' : ' · no position sensor'));
  $('automatic').checked = s.armed;
  document.querySelectorAll('[data-command]').forEach(button => {button.disabled = !demo && !online;});
  const commands = s.mqtt.commands;
  text('commandStatus', demo ? 'Demo controls do not send MQTT commands.' : commands.length ? commands.at(-1).command + ' · ' + commands.at(-1).status : 'No command sent this session.');
  if (s.last_plate) {
    text('lastPlate', s.last_plate.plate); text('plateDecision', s.last_plate.decision);
    text('plateConfidence', Math.round(s.last_plate.confidence * 100) + '% confidence · ' + s.last_plate.source + ' · ' + time(s.last_plate.time));
  }
  const rows = $('reservationRows'); rows.replaceChildren(); let count = 0;
  for (const r of s.reservations) {
    const active = r.active && r.expires > Date.now()/1000; if (active) count++;
    const row = document.createElement('tr'); rowCell(row,r.plate); rowCell(row,r.spot);
    rowCell(row,new Date(r.expires*1000).toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}));
    const badge = document.createElement('span'); badge.className = 'badge' + (active ? '' : ' expired'); badge.textContent = active ? 'Active' : 'Expired / inactive'; rowCell(row,'').append(badge);
    const remove = document.createElement('button'); remove.textContent = 'Remove'; remove.onclick = () => post('/api/reservations/delete',{plate:r.plate}); rowCell(row,'').append(remove); rows.append(row);
  }
  if (!s.reservations.length) { const row = document.createElement('tr'); const cell = rowCell(row,'No reservations yet. Add a plate above to get started.'); cell.colSpan=5; cell.className='empty'; rows.append(row); }
  text('reservationCount',count + ' ACTIVE');
  const deps = Object.values(s.dependencies).every(Boolean);
  $('diagnosticRows').replaceChildren(
    diagnostic('Local dashboard', 'Your browser is connected to the Python application.', true),
    diagnostic('AI dependencies', deps ? 'OpenCV, EasyOCR and Ultralytics detected.' : 'Run INSTALL_AI.cmd to install the missing camera packages.', deps),
    diagnostic('Plate model', s.model ? 'models/best.pt is present.' : 'Copy the trained plate model into models/best.pt.', s.model),
    diagnostic('MQTT broker', s.mqtt.connected ? 'Connected to EMQX.' : s.mqtt.error, s.mqtt.connected, demo ? 'Demo' : undefined),
    diagnostic('ESP32 firmware', online ? 'Fresh heartbeat received. Hardware controls are ready.' : 'Upload the supplied firmware, then check Wi-Fi and Serial Monitor at 115200.', online, demo ? 'Demo' : undefined));
  text('connectionInfo', s.connection.host + ' · ' + s.connection.topic + '/{command,status,ack}');
  const events = $('events'); events.replaceChildren();
  for (const e of s.events.slice(0,30)) { const row=document.createElement('div'); row.className='event'; const stamp=document.createElement('time'); stamp.textContent=time(e.time); const message=document.createElement('span'); message.textContent=e.message; row.append(stamp,message); events.append(row); }
  const running = ['Camera running','Loading AI…','Stopping after current analysis…'].includes(s.camera.status);
  $('startCamera').disabled = running; $('photoButton').disabled = running; $('stopCamera').disabled = !running;
  $('visionMode').disabled = running;
  if (!frameBusy && ['Camera running','Photo analyzed'].includes(s.camera.status)) {
    frameBusy = true;
    const img = $('frame'); img.onload=() => {frameBusy=false; img.hidden=false; $('cameraPlaceholder').hidden=true;}; img.onerror=() => {frameBusy=false;}; img.src='/api/frame?t='+Date.now();
  }
}
async function refresh() {
  if (busy) return;
  busy=true;
  try { const response=await fetch('/api/state'); if (!response.ok) throw new Error('Server unavailable'); state=await response.json(); token=state.token; render(state); }
  catch(e) {text('notice','Dashboard disconnected. Keep START.cmd running, then refresh this page.'); document.querySelectorAll('[data-command]').forEach(b=>b.disabled=true);}
  finally {busy=false;}
}
document.querySelectorAll('[data-command]').forEach(button=>button.onclick=()=>post('/api/command',{command:button.dataset.command}));
$('modeButton').onclick=()=>post('/api/mode',{mode:state?.mode==='demo'?'hardware':'demo'});
$('automatic').onchange=async event=>{await post('/api/arm',{enabled:event.target.checked}); await refresh();};
$('startCamera').onclick=()=>post('/api/camera/start'); $('stopCamera').onclick=()=>post('/api/camera/stop'); $('photoButton').onclick=()=>post('/api/photo');
$('visionMode').onchange=event=>post('/api/vision/mode',{mode:event.target.value});
$('reservationForm').onsubmit=async event=>{event.preventDefault(); const data=Object.fromEntries(new FormData(event.target)); const result=await post('/api/reservations',data); if(result) event.target.elements.plate.value='';};
$('checkForm').onsubmit=event=>{event.preventDefault();post('/api/check',Object.fromEntries(new FormData(event.target)));};
refresh(); setInterval(refresh,1500);

// ══════════════════════════════════════════════════
// CONFIG — Supabase (free real-time database)
// No token needed by players — works for everyone!
// ══════════════════════════════════════════════════
const SB_URL    = '__SUPABASE_URL__';
const SB_ANON   = '__SUPABASE_ANON_KEY__';
const SB_HEADERS = {
  'apikey': SB_ANON,
  'Authorization': `Bearer ${SB_ANON}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=representation'
};

// ── State ──
let myRole   = null;
let myName   = '';
let roomCode = '';
let gameState= {};
let pollTimer= null;
let roundNum = 1;
let scores   = {p1:0, p2:0};

const EMOJI = {rock:'✊', paper:'✋', scissors:'✌️'};
const BEATS = {rock:'scissors', scissors:'paper', paper:'rock'};
const BEAT_MSG = {rock:'Rock crushes Scissors!', paper:'Paper covers Rock!', scissors:'Scissors cut Paper!'};
const COLORS= ['#FF6B6B','#4ECDC4','#FFE66D','#a8dadc','#e94560','#06d6a0','#ffd166'];
let vsComputer = false;   // true when playing vs CPU
let cpuDifficulty = 'medium';
let playerMoveHistory = []; // for hard AI pattern tracking

// ── VS COMPUTER ──
function startVsComputer(){
  const name = getName(); if(!name) return;
  const picker = document.getElementById('difficultyPicker');
  picker.style.display = picker.style.display === 'flex' ? 'none' : 'flex';
}
function hideDifficulty(){
  document.getElementById('difficultyPicker').style.display = 'none';
}

function launchVsComputer(difficulty){
  const name = getName(); if(!name) return;
  myName = name;
  vsComputer = true;
  cpuDifficulty = difficulty;
  myRole = 'p1';
  roomCode = '';
  roundNum = 1;
  scores = {p1:0, p2:0};
  playerMoveHistory = [];
  document.getElementById('difficultyPicker').style.display = 'none';

  const cpuName = difficulty === 'easy' ? '🤖 Rookie Bot' : difficulty === 'medium' ? '🤖 Smart Bot' : '🤖 Evil Bot';
  document.getElementById('pickInstruction').textContent = '🤫 Pick your move!';
  document.getElementById('pickedConfirm').style.display = 'none';
  enterGameScreen(myName, cpuName);
}

function cpuPickMove(playerChoice){
  const moves = ['rock','paper','scissors'];
  if(cpuDifficulty === 'easy'){
    // Fully random
    return moves[Math.floor(Math.random()*3)];
  } else if(cpuDifficulty === 'medium'){
    // 60% random, 40% tries to beat the player's last move
    if(playerMoveHistory.length > 0 && Math.random() < 0.4){
      const lastMove = playerMoveHistory[playerMoveHistory.length-1];
      // Pick the move that beats the player's last move
      return Object.keys(BEATS).find(m => BEATS[m] === lastMove);
    }
    return moves[Math.floor(Math.random()*3)];
  } else {
    // Hard: uses the most common move in player's history to counter it
    if(playerMoveHistory.length >= 2){
      const freq = {rock:0,paper:0,scissors:0};
      playerMoveHistory.forEach(m => freq[m]++);
      const likelyMove = Object.keys(freq).sort((a,b)=>freq[b]-freq[a])[0];
      // Counter that move with 75% chance
      if(Math.random() < 0.75){
        return Object.keys(BEATS).find(m => BEATS[m] === likelyMove);
      }
    }
    return moves[Math.floor(Math.random()*3)];
  }
}

// ── Supabase "Database" API ──
// Each room is a row in the "rooms" table with column "code" as the unique key

async function dbGet(code){
  try {
    const res = await fetch(
      `${SB_URL}/rest/v1/rooms?code=eq.${code}&limit=1`,
      { headers: SB_HEADERS, cache: 'no-store' }
    );
    if(!res.ok) return null;
    const rows = await res.json();
    if(!rows || rows.length === 0) return null;
    const row = rows[0];
    // Flatten the stored JSON data back out
    return typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
  } catch(e){ return null; }
}

async function dbSet(code, data){
  try {
    // Upsert (insert or update)
    const res = await fetch(`${SB_URL}/rest/v1/rooms`, {
      method: 'POST',
      headers: { ...SB_HEADERS, 'Prefer': 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({ code, data: JSON.stringify(data) })
    });
    return res.ok || res.status === 201;
  } catch(e){ return false; }
}

async function dbPatch(code, patch){
  try {
    const existing = await dbGet(code);
    if(existing === null) return false;
    const merged = Object.assign({}, existing);
    for(const k of Object.keys(patch)){
      if(k.includes('/')){
        const [a,b] = k.split('/');
        if(!merged[a]) merged[a] = {};
        merged[a][b] = patch[k];
      } else if(typeof patch[k]==='object' && patch[k]!==null && !Array.isArray(patch[k])){
        merged[k] = Object.assign({}, merged[k]||{}, patch[k]);
      } else {
        merged[k] = patch[k];
      }
    }
    return await dbSet(code, merged);
  } catch(e){ return false; }
}

async function dbDelete(code){
  try {
    await fetch(`${SB_URL}/rest/v1/rooms?code=eq.${code}`, {
      method: 'DELETE',
      headers: SB_HEADERS
    });
  } catch(e){}
}

// ── Helpers ──
function showScreen(id){ document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active')); document.getElementById(id).classList.add('active'); }

function toast(msg, dur=2500){
  const t=document.getElementById('toast'); t.textContent=msg; t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'), dur);
}

function genCode(){
  const words=['BLUE','STAR','FIRE','COOL','FAST','LION','ROCK','MEGA','EPIC','WILD'];
  return words[Math.floor(Math.random()*words.length)] + Math.floor(10+Math.random()*90);
}

// ── QR CODE (join link) ──
function joinUrlFor(code){
  return `${location.origin}${location.pathname}?room=${code}`;
}
function renderJoinQr(code){
  const url = joinUrlFor(code);
  const img = document.getElementById('qrImage');
  img.src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=8&data=${encodeURIComponent(url)}`;
}

// Prefill room code if arriving via a scanned QR / shared join link (?room=CODE)
(function prefillFromUrl(){
  const params = new URLSearchParams(location.search);
  const code = (params.get('room') || '').trim().toUpperCase();
  if(code){
    document.getElementById('roomCodeInput').value = code;
    document.getElementById('playerNameInput').focus();
    toast('🔑 Room code filled in — enter your name and tap Join!', 3500);
  }
})();

function getName(){
  const n = document.getElementById('playerNameInput').value.trim();
  if(!n){ toast('⚠️ Please enter your name first!'); return null; }
  return n;
}

// ── CREATE ROOM ──
async function createRoom(){
  const name = getName(); if(!name) return;
  vsComputer = false;
  myName = name;
  const btn = document.getElementById('createBtn');
  btn.disabled = true; btn.textContent = '⏳ Creating…';

  roomCode = genCode();
  myRole = 'p1';

  const roomData = {
    p1: { name: myName, move: null },
    p2: { name: null,   move: null },
    status: 'waiting',
    round: 1,
    scores: { p1:0, p2:0 },
    created: Date.now()
  };

  const ok = await dbSet(roomCode, roomData);
  btn.disabled = false; btn.textContent = '🎮 Create a New Game';

  if(!ok){ toast('❌ Could not connect. Check your internet!', 3000); return; }

  document.getElementById('lobbyCode').textContent = roomCode;
  document.getElementById('slot1Name').textContent = myName;
  renderJoinQr(roomCode);
  showScreen('lobbyScreen');

  // Poll for player 2 joining
  startPolling();
}

// ── JOIN ROOM ──
async function joinRoom(){
  const name = getName(); if(!name) return;
  const code = document.getElementById('roomCodeInput').value.trim().toUpperCase();
  if(code.length < 4){ toast('⚠️ Enter a valid room code!'); return; }

  myName = name; roomCode = code; myRole = 'p2';

  toast('🔍 Looking for room…', 2000);

  const room = await dbGet(roomCode);
  if(!room){ toast('❌ Room not found! Check the code.', 3000); return; }
  if(room.status !== 'waiting'){ toast('❌ This room is already full!', 3000); return; }

  // Join the room
  const ok = await dbPatch(roomCode, {
    p2: { name: myName, move: null },
    status: 'playing'
  });
  if(!ok){ toast('❌ Could not join. Try again!', 3000); return; }

  scores = room.scores || {p1:0, p2:0};
  roundNum = room.round || 1;

  enterGameScreen(room.p1.name, myName);
  startPolling();
}

// ── CANCEL ROOM ──
async function cancelRoom(){
  stopPolling();
  await dbDelete(roomCode);
  showScreen('homeScreen');
}

// ── ENTER GAME SCREEN ──
function enterGameScreen(p1Name, p2Name){
  document.getElementById('scoreN1').textContent = p1Name;
  document.getElementById('scoreN2').textContent = p2Name;
  document.getElementById('scoreP1').textContent = scores.p1;
  document.getElementById('scoreP2').textContent = scores.p2;
  document.getElementById('roundLabel').textContent = `Round ${roundNum}`;

  document.getElementById('revealName1').textContent = p1Name;
  document.getElementById('revealName2').textContent = p2Name;

  showPickPhase();
  showScreen('gameScreen');
}

// ── SHOW PICK PHASE ──
function showPickPhase(){
  document.getElementById('pickPhase').style.display   = 'flex';
  document.getElementById('resultPhase').style.display = 'none';
  document.getElementById('pickedConfirm').style.display = 'none';
  document.getElementById('pickInstruction').style.display = 'block';
  document.querySelectorAll('.hand-btn').forEach(b=>{ b.disabled=false; b.classList.remove('selected'); });
  document.getElementById('pickStatusText').textContent = 'Pick your move!';
}

// ── PICK MOVE ──
async function pickMove(choice){
  document.querySelectorAll('.hand-btn').forEach(b=>b.disabled=true);
  document.querySelectorAll('.hand-btn').forEach(b=>{ if(b.dataset.c===choice) b.classList.add('selected'); });
  document.getElementById('pickedConfirm').style.display = 'block';
  document.getElementById('pickInstruction').style.display = 'none';

  if(vsComputer){
    // CPU picks instantly (with tiny delay for drama)
    playerMoveHistory.push(choice);
    const cpuMove = cpuPickMove(choice);
    const cpuName = document.getElementById('scoreN2').textContent;
    setTimeout(()=>{
      revealResult({
        p1: { name: myName, move: choice },
        p2: { name: cpuName, move: cpuMove }
      });
    }, 700);
  } else {
    await dbPatch(roomCode, { [`${myRole}/move`]: choice });
  }
}

// ── POLLING ──
function startPolling(){
  stopPolling();
  pollTimer = setInterval(poll, 2000);
}
function stopPolling(){ if(pollTimer){ clearInterval(pollTimer); pollTimer=null; } }

async function poll(){
  const room = await dbGet(roomCode);
  if(!room){ stopPolling(); toast('❌ Room closed!', 3000); showScreen('homeScreen'); return; }

  // Lobby: waiting for P2
  if(myRole==='p1' && document.getElementById('lobbyScreen').classList.contains('active')){
    if(room.status==='playing' && room.p2 && room.p2.name){
      stopPolling();
      scores = room.scores || {p1:0,p2:0};
      roundNum = room.round || 1;

      // Update lobby slots briefly then enter game
      document.getElementById('slot2').classList.add('joined');
      document.getElementById('slot2Name').textContent = room.p2.name;
      toast(`🎮 ${room.p2.name} joined! Let's go!`, 1500);
      setTimeout(()=>{ enterGameScreen(myName, room.p2.name); startPolling(); }, 1200);
    }
    return;
  }

  // Game screen
  if(document.getElementById('gameScreen').classList.contains('active')){
    if(document.getElementById('pickPhase').style.display !== 'none'){
      // Check if both players have picked
      const p1move = room.p1 && room.p1.move;
      const p2move = room.p2 && room.p2.move;

      if(myRole==='p1'){
        if(p2move && !p1move) document.getElementById('pickStatusText').textContent = '⚡ Opponent ready — now pick!';
        if(p1move && !p2move) document.getElementById('pickStatusText').textContent = '⌛ Waiting for opponent…';
        if(p1move && p2move)  { stopPolling(); revealResult(room); }
      } else {
        if(p1move && !p2move) document.getElementById('pickStatusText').textContent = '⚡ Opponent ready — now pick!';
        if(p2move && !p1move) document.getElementById('pickStatusText').textContent = '⌛ Waiting for opponent…';
        if(p1move && p2move)  { stopPolling(); revealResult(room); }
      }
    } else if(document.getElementById('resultPhase').style.display !== 'none'){
      // Check if next round was triggered
      const newRound = room.round || 1;
      if(newRound > roundNum){
        roundNum = newRound;
        scores = room.scores || {p1:0,p2:0};
        updateScores();
        stopPolling();
        showPickPhase();
        startPolling();
      }
    }
  }
}

// ── REVEAL RESULT ──
function revealResult(room){
  const p1move = room.p1.move;
  const p2move = room.p2.move;
  const p1name = room.p1.name;
  const p2name = room.p2.name;

  document.getElementById('pickPhase').style.display   = 'none';
  document.getElementById('resultPhase').style.display = 'flex';

  document.getElementById('revealEmoji1').textContent = EMOJI[p1move];
  document.getElementById('revealEmoji2').textContent = EMOJI[p2move];
  document.getElementById('revealName1').textContent  = p1name;
  document.getElementById('revealName2').textContent  = p2name;

  const banner  = document.getElementById('resultBanner');
  const sub     = document.getElementById('resultSub');
  const side1   = document.getElementById('revealSide1');
  const side2   = document.getElementById('revealSide2');
  side1.classList.remove('winner'); side2.classList.remove('winner');

  let result, bannerText, subText;

  if(p1move === p2move){
    result = 'draw';
    bannerText = "🤝 It's a Draw!";
    subText = 'Nobody wins this round!';
    banner.className = 'result-banner draw';
    playDrawMusic();
  } else if(BEATS[p1move] === p2move){
    result = 'p1wins';
    bannerText = `🏆 ${p1name} Wins!`;
    subText = BEAT_MSG[p1move];
    banner.className = 'result-banner win';
    side1.classList.add('winner');
    scores.p1++;
    if(myRole==='p1'){ confetti(); playPartyMusic(); setTimeout(stopMusic,6000); }
    else { playLoseMusic(); setTimeout(stopMusic,4000); }
  } else {
    result = 'p2wins';
    bannerText = `🏆 ${p2name} Wins!`;
    subText = BEAT_MSG[p2move];
    banner.className = 'result-banner win';
    side2.classList.add('winner');
    scores.p2++;
    if(myRole==='p2'){ confetti(); playPartyMusic(); setTimeout(stopMusic,6000); }
    else { playLoseMusic(); setTimeout(stopMusic,4000); }
  }

  banner.textContent = bannerText;
  sub.textContent    = subText;
  updateScores();

  // Only p1 updates the database when playing online (avoid race condition)
  if(!vsComputer && myRole==='p1'){
    dbPatch(roomCode, { scores: scores });
  }

  // Show next round button
  document.getElementById('nextRoundBtn').style.display = 'inline-block';

  // Resume polling only for online games
  if(!vsComputer) startPolling();
}

// ── NEXT ROUND ──
async function nextRound(){
  stopMusic();
  roundNum++;
  document.getElementById('nextRoundBtn').style.display = 'none';
  document.getElementById('roundLabel').textContent = `Round ${roundNum}`;

  if(!vsComputer){
    await dbPatch(roomCode, {
      'p1/move': null,
      'p2/move': null,
      round: roundNum
    });
    startPolling();
  }

  showPickPhase();
}

function updateScores(){
  document.getElementById('scoreP1').textContent = scores.p1;
  document.getElementById('scoreP2').textContent = scores.p2;
}

// ── LEAVE GAME ──
async function leaveGame(){
  stopPolling(); stopMusic();
  if(!vsComputer){
    // Both players delete the room so the other gets sent home too
    await dbDelete(roomCode);
  }
  vsComputer = false;
  playerMoveHistory = [];
  showScreen('homeScreen');
}

// ── COPY CODE ──
function copyCode(){
  navigator.clipboard.writeText(roomCode).then(()=>toast('📋 Room code copied!'));
}

// ── CONFETTI ──
function confetti(){
  const box=document.getElementById('confWrap'); box.innerHTML='';
  for(let i=0;i<70;i++){
    const p=document.createElement('div'); p.className='conf-piece';
    p.style.cssText=`left:${Math.random()*100}%;top:-10px;background:${COLORS[Math.floor(Math.random()*COLORS.length)]};width:${6+Math.random()*10}px;height:${6+Math.random()*10}px;border-radius:${Math.random()>.5?'50%':'2px'};animation-duration:${1.5+Math.random()*2}s;animation-delay:${Math.random()*.8}s;`;
    box.appendChild(p);
  }
  setTimeout(()=>box.innerHTML='',4000);
}

// ── AUDIO ──
let audioCtx=null, loopTimer=null;
function getCtx(){ if(!audioCtx) audioCtx=new(window.AudioContext||window.webkitAudioContext)(); return audioCtx; }
function stopMusic(){ if(loopTimer){ clearInterval(loopTimer); loopTimer=null; } }

function playPartyMusic(){
  stopMusic(); const c=getCtx();
  const mel=[[523,.00,.18],[659,.20,.18],[784,.40,.18],[1047,.60,.28],[784,.92,.18],[880,1.12,.18],[1047,1.32,.36],[988,1.72,.18],[880,1.92,.18],[784,2.12,.18],[659,2.32,.28],[523,2.64,.18],[659,2.84,.18],[784,3.04,.36],[880,3.44,.18],[988,3.64,.18],[1047,3.84,.28],[880,4.16,.18],[784,4.36,.18],[659,4.56,.36],[523,4.96,.14],[659,5.12,.14],[784,5.28,.14],[880,5.44,.14],[1047,5.60,.50]];
  const bas=[[131,.00,.4],[131,.50,.4],[147,1.00,.4],[131,1.50,.4],[131,2.00,.4],[131,2.50,.4],[174,3.00,.4],[131,3.50,.4],[131,4.00,.4],[131,4.50,.4],[147,5.00,.4],[131,5.60,.4]];
  const kck=[0,.5,1,1.5,2,2.5,3,3.5,4,4.5,5,5.5]; const L=6.2;
  function sched(s){
    mel.forEach(([f,t,d])=>{ const o=c.createOscillator(),g=c.createGain(); o.type='square'; o.frequency.setValueAtTime(f,s+t); g.gain.setValueAtTime(0,s+t); g.gain.linearRampToValueAtTime(.08,s+t+.02); g.gain.linearRampToValueAtTime(.05,s+t+d*.6); g.gain.linearRampToValueAtTime(0,s+t+d); o.connect(g); g.connect(c.destination); o.start(s+t); o.stop(s+t+d+.05); });
    bas.forEach(([f,t,d])=>{ const o=c.createOscillator(),g=c.createGain(); o.type='sine'; o.frequency.setValueAtTime(f,s+t); g.gain.setValueAtTime(.12,s+t); g.gain.linearRampToValueAtTime(0,s+t+d); o.connect(g); g.connect(c.destination); o.start(s+t); o.stop(s+t+d+.05); });
    kck.forEach(t=>{ const o=c.createOscillator(),g=c.createGain(); o.type='sine'; o.frequency.setValueAtTime(120,s+t); o.frequency.linearRampToValueAtTime(40,s+t+.08); g.gain.setValueAtTime(.3,s+t); g.gain.linearRampToValueAtTime(0,s+t+.12); o.connect(g); g.connect(c.destination); o.start(s+t); o.stop(s+t+.15); });
    for(let i=0;i<12;i++){ const b=c.createBuffer(1,c.sampleRate*.05,c.sampleRate),d=b.getChannelData(0); for(let j=0;j<d.length;j++) d[j]=Math.random()*2-1; const src=c.createBufferSource(),g=c.createGain(),fl=c.createBiquadFilter(); fl.type='highpass'; fl.frequency.value=8000; src.buffer=b; g.gain.setValueAtTime(.06,s+i*.5); g.gain.linearRampToValueAtTime(0,s+i*.5+.05); src.connect(fl); fl.connect(g); g.connect(c.destination); src.start(s+i*.5); }
  }
  let st=c.currentTime; sched(st);
  loopTimer=setInterval(()=>{ st+=L; sched(st); }, L*1000-100);
}

function playLoseMusic(){
  stopMusic(); const c=getCtx(), now=c.currentTime;
  [[466,.00,.32],[415,.32,.32],[370,.64,.32],[311,.96,.90]].forEach(([f,s,d])=>{
    const o=c.createOscillator(),g=c.createGain(),lfo=c.createOscillator(),lg=c.createGain();
    lfo.frequency.value=5; lg.gain.value=s>.6?6:0; lfo.connect(lg); lg.connect(o.frequency);
    o.type='sawtooth'; o.frequency.setValueAtTime(f,now+s);
    g.gain.setValueAtTime(0,now+s); g.gain.linearRampToValueAtTime(.18,now+s+.04); g.gain.linearRampToValueAtTime(.14,now+s+d*.7); g.gain.linearRampToValueAtTime(0,now+s+d);
    const fl=c.createBiquadFilter(); fl.type='lowpass'; fl.frequency.value=900; fl.Q.value=2;
    o.connect(fl); fl.connect(g); g.connect(c.destination);
    lfo.start(now+s); o.start(now+s); lfo.stop(now+s+d+.1); o.stop(now+s+d+.1);
  });
  const t=c.createOscillator(),tg=c.createGain(); t.type='sine'; t.frequency.setValueAtTime(200,now+2); t.frequency.linearRampToValueAtTime(60,now+2.3); tg.gain.setValueAtTime(.25,now+2); tg.gain.linearRampToValueAtTime(0,now+2.4); t.connect(tg); tg.connect(c.destination); t.start(now+2); t.stop(now+2.5);
}

function playDrawMusic(){
  stopMusic(); const c=getCtx(), now=c.currentTime;
  [[523,.00,.18],[659,.20,.18],[523,.40,.18],[659,.60,.18],[523,.80,.18],[659,1.00,.18],[587,1.22,.50],[554,1.80,.60]].forEach(([f,s,d],i)=>{
    const o=c.createOscillator(),g=c.createGain(); o.type=i%2===0?'triangle':'sine'; o.frequency.setValueAtTime(f,now+s);
    if(i===7) o.frequency.linearRampToValueAtTime(f*.88,now+s+d);
    g.gain.setValueAtTime(0,now+s); g.gain.linearRampToValueAtTime(.12,now+s+.03); g.gain.linearRampToValueAtTime(.08,now+s+d*.7); g.gain.linearRampToValueAtTime(0,now+s+d);
    o.connect(g); g.connect(c.destination); o.start(now+s); o.stop(now+s+d+.05);
  });
  [0,.2,.4,.6,.8,1.0].forEach((t,i)=>{ const o=c.createOscillator(),g=c.createGain(); o.type='sine'; const f=i%2===0?880:1046; o.frequency.setValueAtTime(f,now+t); o.frequency.linearRampToValueAtTime(f*.7,now+t+.18); g.gain.setValueAtTime(.07,now+t); g.gain.linearRampToValueAtTime(0,now+t+.18); o.connect(g); g.connect(c.destination); o.start(now+t); o.stop(now+t+.2); });
  const w=c.createOscillator(),wg=c.createGain(); w.type='sine'; w.frequency.setValueAtTime(1200,now+2.5); w.frequency.linearRampToValueAtTime(700,now+3.0); wg.gain.setValueAtTime(.08,now+2.5); wg.gain.linearRampToValueAtTime(0,now+3.1); w.connect(wg); wg.connect(c.destination); w.start(now+2.5); w.stop(now+3.2);
}

// Allow Enter key to submit
document.getElementById('playerNameInput').addEventListener('keydown', e=>{ if(e.key==='Enter') document.getElementById('createBtn').click(); });
document.getElementById('roomCodeInput').addEventListener('keydown',  e=>{ if(e.key==='Enter') joinRoom(); });
document.getElementById('roomCodeInput').addEventListener('input', e=>{ e.target.value=e.target.value.toUpperCase(); });

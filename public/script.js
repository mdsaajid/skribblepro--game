const socket = io();
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

// --- STATE ---
let myCode = "", myId = "";
let isMyTurn = false, isHost = false, isSpectator = false, canDraw = false;
let isDrawing = false, currentTool = 'brush';
let currentColor = '#000000', currentSize = 5;
let startX, startY, snapshot;
let undoStack = [];

const avatars = ['😎','👽','🤠','👻','🤖','🐱','🐶','🦊','🦁','🐸','🦄','🐵','💀','💩','🤡','👹','👺','👿','👾','🤖','🎃','⛄','🥦','🍔','🍕','🌮','🌭','🍩','🍪','🍒','🥑','🍆','🥔','🥕','🌽','🌶️'];
let avatarIdx = 0;
const quickColors = ['#000000', '#ffffff', '#ff0055', '#ff9900', '#ffee00', '#00ff9d', '#00d2ff', '#9d4edd'];

function init() {
    const qc = document.getElementById('quickColors');
    quickColors.forEach(c => {
        const d = document.createElement('div');
        d.style.cssText = `width:24px; height:24px; border-radius:50%; background:${c}; cursor:pointer; border:2px solid rgba(255,255,255,0.2);`;
        d.onclick = () => setColor(c);
        qc.appendChild(d);
    });
}
init();

// --- UI HELPERS ---
function updateSliderUI(el, id) { document.getElementById(id).innerText = el.value; }
function changeAvatar(d) {
    avatarIdx = (avatarIdx + d + avatars.length) % avatars.length;
    document.getElementById('avatarPreview').innerText = avatars[avatarIdx];
}
function showTab(t) {
    document.getElementById('hostPanel').style.display = t==='host'?'block':'none';
    document.getElementById('joinPanel').style.display = t==='join'?'block':'none';
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    event.target.classList.add('active');
}
function toggleMenu() {
    const m = document.getElementById('mobileMenu');
    m.style.display = m.style.display === 'none' ? 'flex' : 'none';
}
function showToast(msg) {
    const c = document.getElementById('toast-container');
    const t = document.createElement('div'); t.className='toast'; t.innerText=msg;
    c.appendChild(t); setTimeout(()=>t.remove(), 3000);
}

// --- CANVAS LOGIC (FIXED FOR MOBILE BLUR) ---
function resizeCanvas() {
    const parent = canvas.parentElement;
    if (!parent) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = parent.getBoundingClientRect();

    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    if (undoStack.length > 0) {
        const img = new Image();
        img.onload = () => { ctx.drawImage(img, 0, 0, rect.width, rect.height); };
        img.src = undoStack[undoStack.length - 1];
    }
}
window.addEventListener('resize', resizeCanvas);

const getPos = (e) => {
    const rect = canvas.getBoundingClientRect();
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    const cy = e.touches ? e.touches[0].clientY : e.clientY;
    return { x: cx - rect.left, y: cy - rect.top };
};

const startDraw = (e) => {
    if (!canDraw) return;
    if (e.type === 'touchstart') e.preventDefault();
    isDrawing = true; 
    snapshot = canvas.toDataURL();
    undoStack.push(snapshot);
    if(undoStack.length > 10) undoStack.shift(); 

    const pos = getPos(e); 
    startX = pos.x; startY = pos.y;
    ctx.beginPath(); ctx.moveTo(startX, startY);
    if(['brush','eraser','pencil'].includes(currentTool)) draw(e);
};

const draw = (e) => {
    if (!isDrawing || !canDraw) return;
    if (e.type === 'touchmove') e.preventDefault();
    const pos = getPos(e);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = currentSize;
    
    if(currentTool==='eraser') { 
        ctx.globalCompositeOperation = 'destination-out';
        ctx.strokeStyle = 'rgba(0,0,0,1)';
        ctx.lineTo(pos.x, pos.y); ctx.stroke();
        ctx.globalCompositeOperation = 'source-over';
    } else if(['brush','pencil'].includes(currentTool)) { 
        ctx.strokeStyle = currentColor; ctx.lineTo(pos.x, pos.y); ctx.stroke(); 
    } else {
        const img = new Image();
        img.onload = () => {
            const dpr = window.devicePixelRatio || 1;
            ctx.clearRect(0,0,canvas.width/dpr, canvas.height/dpr);
            ctx.drawImage(img, 0, 0, canvas.width/dpr, canvas.height/dpr);
            ctx.beginPath(); ctx.fillStyle = currentColor; ctx.strokeStyle = currentColor;
            if(currentTool==='rectangle') ctx.strokeRect(startX, startY, pos.x-startX, pos.y-startY);
            else if(currentTool==='circle') { 
                const r=Math.sqrt(Math.pow(pos.x-startX,2)+Math.pow(pos.y-startY,2)); 
                ctx.beginPath(); ctx.arc(startX,startY,r,0,2*Math.PI); ctx.stroke(); 
            }
        };
        img.src = snapshot; 
    }
};

const stopDraw = (e) => {
    if(!isDrawing) return;
    if(e.type === 'touchend') e.preventDefault();
    isDrawing = false; ctx.beginPath(); emitCanvasUpdate();
};

canvas.addEventListener('mousedown', startDraw); canvas.addEventListener('mousemove', draw);
canvas.addEventListener('mouseup', stopDraw); canvas.addEventListener('mouseout', stopDraw);
canvas.addEventListener('touchstart', startDraw, {passive: false}); canvas.addEventListener('touchmove', draw, {passive: false});
canvas.addEventListener('touchend', stopDraw, {passive: false});

function emitCanvasUpdate() { socket.emit('canvasUpdate', { code: myCode, imageData: canvas.toDataURL() }); }

// --- SOCKET LOGIC ---
function hostRoom() {
    const btn = document.getElementById('btnCreate');
    if(btn) { btn.innerText = "Creating..."; btn.disabled = true; }
    
    const settings = {
        maxPlayers: parseInt(document.getElementById('sMaxP').value),
        drawTime: parseInt(document.getElementById('sTime').value),
        rounds: parseInt(document.getElementById('sRounds').value),
        words: document.getElementById('sWords').value.split(',').map(w=>w.trim()).filter(w=>w)
    };
    const isSpec = document.getElementById('spectatorMode').checked;
    const username = document.getElementById('username').value.trim() || "Host";
    socket.emit('createRoom', { username, settings, isSpectator: isSpec });
}

function joinRoom() {
    const code = document.getElementById('joinCode').value.toUpperCase().trim();
    const username = document.getElementById('username').value.trim() || "Guest";
    const isSpec = document.getElementById('joinSpectator')?.checked;
    socket.emit('joinRoom', { username, code, avatar: avatars[avatarIdx], isSpectator: isSpec });
}

function startGame() { socket.emit('startGame', myCode); toggleMenu(); }
function togglePause() { socket.emit('togglePause', myCode); }

// --- EVENTS ---
socket.on('roomCreated', (code) => { 
    enterGame(code); isHost = true; 
    document.getElementById('hostControls').style.display='block';
    document.getElementById('headerStartBtn').style.display='flex';
});
socket.on('joinSuccess', ({code}) => enterGame(code));
socket.on('errorMsg', (msg) => { showToast(msg); document.getElementById('btnCreate').innerText = "CREATE ROOM"; document.getElementById('btnCreate').disabled = false; });

function enterGame(code) {
    myCode = code;
    document.getElementById('setupScreen').classList.remove('active');
    document.getElementById('gameScreen').classList.add('active');
    document.getElementById('headerRoomCode').innerText = code;
    document.getElementById('menuRoomCode').innerText = code;
    setTimeout(resizeCanvas, 200);
}

socket.on('updatePlayers', ({players, drawerId}) => {
    document.getElementById('playerList').innerHTML = players.map(p => `
        <div class="player-card ${p.id===drawerId?'is-drawer':''} ${p.hasGuessed?'has-guessed':''}">
            <div style="font-size:1.5rem; margin-right:10px;">${p.avatar}</div>
            <div style="flex:1;">${p.username}</div>
            <div style="font-weight:bold;">${p.score}</div>
        </div>
    `).join('');
});

socket.on('newTurn', ({drawerId}) => {
    isMyTurn = socket.id === drawerId;
    document.getElementById('toolbar').style.display = (isMyTurn && !isSpectator) ? 'flex' : 'none';
    document.getElementById('guessInput').disabled = isMyTurn || isSpectator;
    document.getElementById('guessInput').placeholder = isMyTurn ? "You are drawing!" : "Type guess...";
    document.getElementById('wordHintTop').innerText = isMyTurn ? "DRAW THIS:" : "GUESS THIS:";
    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0,0,canvas.width/dpr, canvas.height/dpr);
    undoStack = [];
    canDraw = false;
});

socket.on('canvasUpdate', (data) => {
    if(!data) {
        const dpr = window.devicePixelRatio || 1;
        ctx.clearRect(0,0,canvas.width/dpr, canvas.height/dpr);
        return;
    }
    const img = new Image();
    img.onload = () => {
        const dpr = window.devicePixelRatio || 1;
        ctx.clearRect(0,0,canvas.width/dpr, canvas.height/dpr);
        ctx.drawImage(img, 0, 0, canvas.width/dpr, canvas.height/dpr);
    };
    img.src = data;
});

socket.on('timerUpdate', (t) => {
    document.getElementById('timerDisplay').innerText = t;
});

// --- PODIUM ---
socket.on('gameOver', ({ leaderboard }) => {
    document.getElementById('gameScreen').classList.remove('active');
    const screen = document.getElementById('gameOverScreen');
    screen.style.display = 'flex';
    
    const top3 = leaderboard.slice(0, 3);
    let podiumHTML = '';
    
    if(top3[1]) podiumHTML += `<div class="podium-item"><div class="p-avatar">${top3[1].avatar}</div><div class="p-bar rank-2">${top3[1].score}</div><div class="p-name">${top3[1].username}</div></div>`;
    if(top3[0]) podiumHTML += `<div class="podium-item"><div class="p-avatar">👑</div><div class="p-bar rank-1">${top3[0].score}</div><div class="p-name">${top3[0].username}</div></div>`;
    if(top3[2]) podiumHTML += `<div class="podium-item"><div class="p-avatar">${top3[2].avatar}</div><div class="p-bar rank-3">${top3[2].score}</div><div class="p-name">${top3[2].username}</div></div>`;
    
    document.getElementById('podiumContainer').innerHTML = podiumHTML;

    const rest = leaderboard.slice(3);
    document.getElementById('finalLeaderboard').innerHTML = rest.map((p, i) => `
        <div style="display:flex; justify-content:space-between; padding:8px; border-bottom:1px solid rgba(255,255,255,0.1);">
            <span>${i+4}. ${p.avatar} ${p.username}</span> <span>${p.score}</span>
        </div>
    `).join('');
});

// --- EXTRAS ---
socket.on('correctGuess', () => sendReaction('like'));
function sendReaction(type) { socket.emit('sendReaction', { code: myCode, type }); }
socket.on('reactionDisplay', (type) => {
    const el = document.createElement('div');
    el.innerText = type === 'like' ? '👍' : '👎';
    el.className = 'flying-emoji';
    el.style.left = (Math.random() * 80 + 10) + '%';
    el.style.bottom = '100px';
    document.getElementById('reaction-layer').appendChild(el);
    setTimeout(() => el.remove(), 2000);
});
socket.on('chooseWord', (words) => {
    document.getElementById('wordChoices').innerHTML = words.map(w => `<button class="btn-primary" onclick="socket.emit('wordChosen', {code: myCode, word: '${w}'}); document.getElementById('wordSelect').style.display='none';">${w}</button>`).join('');
    document.getElementById('wordSelect').style.display = 'flex';
});
socket.on('yourWord', (w) => { document.getElementById('wordHintBottom').innerText = w; canDraw = true; });
socket.on('wordHint', ({hint}) => document.getElementById('wordHintBottom').innerText = hint);
socket.on('chatMsg', (d) => {
    const el = document.createElement('div');
    el.className = `chat-msg ${d.sys?'sys':''}`;
    el.innerHTML = d.sys ? d.msg : `<strong>${d.username}:</strong> ${d.msg}`;
    document.getElementById('chatBox').appendChild(el);
    document.getElementById('chatBox').scrollTop = 99999;
});
document.getElementById('guessInput').addEventListener('keypress', e => {
    if(e.key === 'Enter' && e.target.value.trim()) {
        socket.emit('submitGuess', { code: myCode, guess: e.target.value.trim() });
        e.target.value = '';
    }
});
function setTool(t) { currentTool = t; document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active')); event.currentTarget.classList.add('active'); }
function setColor(c) { currentColor = c; document.getElementById('colorPicker').value = c; }
function undo() { if(undoStack.length>0) { undoStack.pop(); resizeCanvas(); setTimeout(emitCanvasUpdate, 50); } }
function clearCanvasAction() { if(!canDraw)return; const dpr=window.devicePixelRatio||1; ctx.clearRect(0,0,canvas.width/dpr, canvas.height/dpr); emitCanvasUpdate(); }
function fillCanvas() { if(!canDraw)return; const dpr=window.devicePixelRatio||1; ctx.fillStyle=currentColor; ctx.fillRect(0,0,canvas.width/dpr, canvas.height/dpr); emitCanvasUpdate(); }

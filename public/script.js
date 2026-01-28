const socket = io();
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const toolbar = document.getElementById('toolbar');

// Game State
let myCode = "";
let myId = "";
let isMyTurn = false;
let isHost = false;
let isSpectator = false;
let canDraw = false; 

// Drawing State
let isDrawing = false;
let currentTool = 'brush'; 
let currentColor = '#000000';
let currentSize = 5;
let startX, startY;
let snapshot; 
let undoStack = [];
let redoStack = [];

// Init Setup
const avatars = ['😎', '👽', '🤠', '👻', '🤖', '🐱', '🐶', '🦊', '🦁', '🐸'];
let avatarIdx = 0;

// --- TOUCH & MOUSE HANDLING (Crucial for Mobile) ---
const getPos = (e) => {
    const rect = canvas.getBoundingClientRect();
    // Use first touch if available, otherwise mouse
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
        x: (clientX - rect.left) * (canvas.width / rect.width),
        y: (clientY - rect.top) * (canvas.height / rect.height)
    };
}

const startDraw = (e) => {
    if (!canDraw) return;
    // Prevent scrolling on touch devices
    if(e.type === 'touchstart') e.preventDefault();
    
    isDrawing = true;
    saveState(); 
    const pos = getPos(e);
    startX = pos.x;
    startY = pos.y;
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
    
    if (['brush', 'pencil', 'eraser'].includes(currentTool)) {
        draw(e); 
    }
}

const draw = (e) => {
    if (!isDrawing || !canDraw) return;
    if(e.type === 'touchmove') e.preventDefault(); // Critical: Stop screen drag
    
    const pos = getPos(e);
    ctx.lineWidth = currentSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (currentTool === 'brush' || currentTool === 'pencil') {
        ctx.strokeStyle = currentColor;
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
    } else if (currentTool === 'eraser') {
        ctx.strokeStyle = '#ffffff'; 
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
    } else {
        // Shapes
        ctx.putImageData(snapshot, 0, 0);
        ctx.beginPath();
        drawShape(pos.x, pos.y);
    }
}

const stopDraw = (e) => {
    if (!isDrawing) return;
    if (e && e.type === 'touchend') e.preventDefault();
    isDrawing = false;
    ctx.beginPath(); 
    emitCanvasUpdate();
}

function drawShape(endX, endY) {
    ctx.fillStyle = currentColor;
    ctx.strokeStyle = currentColor;
    if (currentTool === 'rectangle') {
        ctx.strokeRect(startX, startY, endX - startX, endY - startY);
    } else if (currentTool === 'circle') {
        const radius = Math.sqrt(Math.pow(endX - startX, 2) + Math.pow(endY - startY, 2));
        ctx.beginPath();
        ctx.arc(startX, startY, radius, 0, 2 * Math.PI);
        ctx.stroke();
    } else if (currentTool === 'triangle') {
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        ctx.lineTo(startX + (startX - endX), endY);
        ctx.closePath();
        ctx.stroke();
    } else if (currentTool === 'line') {
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        ctx.stroke();
    }
}

// Add Listeners (Passive: False is required for preventing scroll)
canvas.addEventListener('mousedown', startDraw);
canvas.addEventListener('mousemove', draw);
canvas.addEventListener('mouseup', stopDraw);
canvas.addEventListener('mouseout', stopDraw);

canvas.addEventListener('touchstart', startDraw, { passive: false });
canvas.addEventListener('touchmove', draw, { passive: false });
canvas.addEventListener('touchend', stopDraw, { passive: false });
canvas.addEventListener('touchcancel', stopDraw);

// --- OTHER FUNCTIONS ---

function setTool(tool) {
    currentTool = tool;
    document.querySelectorAll('.tool-btn').forEach(btn => btn.classList.remove('active'));
    event.currentTarget.classList.add('active');
    if (tool === 'pencil') setSize(2);
    if (tool === 'brush') setSize(10);
}

function setColor(color) {
    currentColor = color;
    document.getElementById('colorPicker').value = color;
}

function setSize(size) {
    currentSize = size;
    document.getElementById('sizeSlider').value = size;
}

function saveState() {
    undoStack.push(canvas.toDataURL());
    redoStack = []; 
}

function undo() {
    if (undoStack.length > 0) {
        redoStack.push(canvas.toDataURL()); 
        restoreState(undoStack.pop());
        setTimeout(emitCanvasUpdate, 50);
    }
}

function redo() {
    if (redoStack.length > 0) {
        undoStack.push(canvas.toDataURL()); 
        restoreState(redoStack.pop());
        setTimeout(emitCanvasUpdate, 50);
    }
}

function restoreState(dataUrl) {
    const img = new Image();
    img.onload = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
    };
    img.src = dataUrl;
}

function clearCanvasAction() {
    if(!canDraw) return;
    saveState();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    emitCanvasUpdate();
}

function fillCanvas() {
    if(!canDraw) return;
    saveState();
    ctx.fillStyle = currentColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    emitCanvasUpdate();
}

function emitCanvasUpdate() {
    if(canDraw) {
       const imageData = canvas.toDataURL('image/png', 0.5); 
       socket.emit('canvasUpdate', { code: myCode, imageData });
    }
}

// --- UI HELPERS ---
function changeAvatar(dir) {
    avatarIdx = (avatarIdx + dir + avatars.length) % avatars.length;
    document.getElementById('avatarPreview').innerText = avatars[avatarIdx];
}

function showTab(tab) {
    document.getElementById('hostPanel').style.display = tab === 'host' ? 'block' : 'none';
    document.getElementById('joinPanel').style.display = tab === 'join' ? 'block' : 'none';
    document.querySelectorAll('.tabs button').forEach(b => b.classList.remove('active-tab'));
    event.target.classList.add('active-tab');
}

function resizeCanvas() {
    const displayWidth = canvas.parentElement.offsetWidth;
    const displayHeight = canvas.parentElement.offsetHeight;
    if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
        const savedData = canvas.toDataURL();
        canvas.width = displayWidth;
        canvas.height = displayHeight;
        restoreState(savedData);
    }
}
window.addEventListener('resize', resizeCanvas);

// --- SOCKET LOGIC ---
function hostRoom() {
    const rawWords = document.getElementById('sWords').value;
    const words = rawWords.split(',').map(w => w.trim()).filter(w => w.length > 0);
    const settings = {
        maxPlayers: parseInt(document.getElementById('sMaxP').value) || 8,
        drawTime: parseInt(document.getElementById('sTime').value) || 80,
        rounds: parseInt(document.getElementById('sRounds').value) || 3,
        words: words.length >= 5 ? words : undefined
    };
    const username = document.getElementById('username').value.trim() || "Host";
    isHost = true;
    isSpectator = document.getElementById('spectatorMode').checked;
    socket.emit('createRoom', { username, settings, isSpectator });
}

function joinRoom() {
    const code = document.getElementById('joinCode').value.toUpperCase().trim();
    if(code.length < 5) { alert("Invalid Code"); return; }
    const username = document.getElementById('username').value.trim() || "Guest";
    isSpectator = document.getElementById('joinAsSpectator').checked;
    socket.emit('joinRoom', { username, code, avatar: avatars[avatarIdx], isSpectator });
}

function startGame() { socket.emit('startGame', myCode); }
function togglePause() { socket.emit('togglePause', myCode); }

function enterGame(code) {
    myCode = code;
    document.getElementById('setupScreen').style.display = 'none';
    document.getElementById('gameScreen').style.display = 'flex';
    document.getElementById('roomCodeDisplay').innerText = `Code: ${code}`;
    setTimeout(resizeCanvas, 100);
}

socket.on('connect', () => { myId = socket.id; });
socket.on('roomCreated', (code) => {
    enterGame(code);
    if (isHost) document.getElementById('hostControls').style.display = 'flex';
});
socket.on('joinSuccess', ({ code }) => { enterGame(code); });
socket.on('youAreSpectator', () => {
    isSpectator = true;
    toolbar.style.display = 'none';
    document.getElementById('guessInput').disabled = true;
    document.getElementById('guessInput').placeholder = "Spectating...";
});

socket.on('updatePlayers', ({ players, drawerId }) => {
    const list = document.getElementById('playerList');
    list.innerHTML = players.map(p => `
        <div class="player-card ${p.hasGuessed ? 'has-guessed' : ''} ${p.id === drawerId ? 'is-drawer' : ''}">
            <span>${p.avatar} ${p.username} ${p.id === drawerId ? '🖌️' : ''}</span>
            <span class="player-score">${p.score}</span>
            ${isHost && p.id !== myId ? `<button class="kick-btn" onclick="kick('${p.id}')">X</button>` : ''}
        </div>
    `).join('');
});

socket.on('updateSpectators', (specs) => {
    const list = document.getElementById('spectatorList');
    list.innerHTML = specs.length ? "<h4>Specs</h4>" + specs.map(s => `
        <div class="player-card" style="opacity: 0.7;">
            <span>${s.avatar} ${s.username}</span>
            ${isHost && s.id !== myId ? `<button class="kick-btn" onclick="kick('${s.id}', true)">X</button>` : ''}
        </div>
    `).join('') : "";
});

socket.on('canvasUpdate', (img) => { if(img) restoreState(img); else ctx.clearRect(0,0,canvas.width,canvas.height); });
socket.on('timerUpdate', (t) => document.getElementById('timerDisplay').innerText = t);

socket.on('newTurn', ({ drawerId }) => {
    isMyTurn = myId === drawerId;
    toolbar.style.display = (isMyTurn && !isSpectator) ? 'flex' : 'none';
    document.getElementById('guessInput').disabled = isMyTurn || isSpectator;
    document.getElementById('wordHintTop').innerText = isMyTurn ? "DRAW:" : "GUESS:";
    document.getElementById('wordHintBottom').innerText = "WAITING...";
    undoStack = []; redoStack = []; canDraw = false; 
    ctx.clearRect(0,0,canvas.width,canvas.height);
    setTool('brush'); setColor('#000000');
});

socket.on('wordHint', ({ hint, length }) => {
    document.getElementById('wordHintTop').innerText = `WORD (${length})`;
    document.getElementById('wordHintBottom').innerText = hint;
});
socket.on('yourWord', (w) => {
    document.getElementById('wordHintTop').innerText = "DRAW THIS:";
    document.getElementById('wordHintBottom').innerText = w;
    canDraw = true; 
});
socket.on('chooseWord', (words) => {
    const div = document.getElementById('wordChoices');
    div.innerHTML = words.map(w => `<button onclick="selectWord('${w}')">${w}</button>`).join('');
    document.getElementById('wordSelect').style.display = 'flex';
});
socket.on('chatMsg', (data) => {
    const chat = document.getElementById('chatBox');
    const d = document.createElement('div');
    if (data.sys) { d.classList.add('sys'); d.innerText = data.msg; }
    else { d.innerHTML = `<strong>${data.username}:</strong> ${data.msg}`; }
    chat.appendChild(d); chat.scrollTop = chat.scrollHeight;
});
socket.on('gamePaused', (paused) => {
    document.getElementById('pauseBtn').innerText = paused ? "RESUME" : "PAUSE";
    document.getElementById('overlayMessage').style.display = paused ? 'flex' : 'none';
    document.getElementById('overlayMessage').innerText = "PAUSED";
});
socket.on('gameOver', ({ winner }) => { alert(`WINNER: ${winner.username} (${winner.score}pts)`); location.reload(); });
socket.on('errorMsg', (msg) => alert(msg));

// Inputs
const guessInput = document.getElementById('guessInput');
guessInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && guessInput.value.trim()) {
        socket.emit('submitGuess', { code: myCode, guess: guessInput.value.trim() });
        guessInput.value = '';
    }
});
function selectWord(word) {
    socket.emit('wordChosen', { code: myCode, word });
    document.getElementById('wordSelect').style.display = 'none';
}
function kick(id, spec=false) {
    if(confirm("Kick player?")) socket.emit('kickPlayer', { code: myCode, playerId: id, isSpectator: spec });
}

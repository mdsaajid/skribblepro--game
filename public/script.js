const socket = io();
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const toolbar = document.getElementById('toolbar');

// ================= GAME STATE =================
let myCode = "";
let myId = "";
let isMyTurn = false;
let isHost = false;
let isSpectator = false;
let canDraw = false; 

// ================= DRAWING STATE =================
let isDrawing = false;
let currentTool = 'brush'; 
let currentColor = '#000000';
let currentSize = 5;
let startX, startY;
let snapshot; 

let undoStack = [];
let redoStack = [];

// ================= INITIALIZATION =================
const avatars = ['😎', '👽', '🤠', '👻', '🤖', '🐱', '🐶', '🦊', '🦁', '🐸', '🦄', '🐲'];
let avatarIdx = 0;
const paletteColors = ['#000000', '#ffffff', '#7f7f7f', '#c3c3c3', '#880015', '#b97a57', '#ed1c24', '#ffaec9', '#ff7f27', '#ffc90e', '#fff200', '#efe4b0', '#22b14c', '#b5e61d', '#00a2e8', '#99d9ea', '#3f48cc', '#7092be', '#a349a4', '#c8bfe7'];

function initPalette() {
    const container = document.getElementById('colorPalette');
    paletteColors.forEach(color => {
        const div = document.createElement('div');
        div.className = 'palette-color';
        div.style.backgroundColor = color;
        div.onclick = () => setColor(color);
        if(color === currentColor) div.classList.add('active');
        container.appendChild(div);
    });
}
initPalette();

// ================= TOOLBAR FUNCTIONS =================
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
    document.querySelectorAll('.palette-color').forEach(div => {
        div.classList.toggle('active', div.style.backgroundColor === color);
        if(rgbToHex(div.style.backgroundColor) === color) div.classList.add('active');
    });
}

function rgbToHex(rgb) {
    if (rgb.startsWith('#')) return rgb;
    rgb = rgb.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
    if(!rgb) return rgb;
    return "#" + ("0" + parseInt(rgb[1],10).toString(16)).slice(-2) + ("0" + parseInt(rgb[2],10).toString(16)).slice(-2) + ("0" + parseInt(rgb[3],10).toString(16)).slice(-2);
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
        setTimeout(() => emitCanvasUpdate(), 50);
    }
}

function redo() {
    if (redoStack.length > 0) {
        undoStack.push(canvas.toDataURL()); 
        restoreState(redoStack.pop());
        setTimeout(() => emitCanvasUpdate(), 50);
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


// ================= DRAWING ENGINE =================
const getPos = (e) => {
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
        x: (clientX - rect.left) * (canvas.width / rect.width),
        y: (clientY - rect.top) * (canvas.height / rect.height)
    };
}

const startDraw = (e) => {
    if (!canDraw) return;
    isDrawing = true;
    saveState(); 
    const pos = getPos(e);
    startX = pos.x;
    startY = pos.y;
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
    if (currentTool === 'brush' || currentTool === 'pencil' || currentTool === 'eraser') {
        draw(e); 
    }
    e.preventDefault();
}

const draw = (e) => {
    if (!isDrawing || !canDraw) return;
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
        ctx.putImageData(snapshot, 0, 0);
        ctx.beginPath();
        drawShape(pos.x, pos.y);
    }
    e.preventDefault();
}

const stopDraw = () => {
    if (!isDrawing) return;
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

canvas.addEventListener('mousedown', startDraw);
canvas.addEventListener('mousemove', draw);
canvas.addEventListener('mouseup', stopDraw);
canvas.addEventListener('mouseout', stopDraw);

canvas.addEventListener('touchstart', startDraw, { passive: false });
canvas.addEventListener('touchmove', draw, { passive: false });
canvas.addEventListener('touchend', stopDraw);
canvas.addEventListener('touchcancel', stopDraw);

function emitCanvasUpdate() {
    if(canDraw) {
       const imageData = canvas.toDataURL('image/png', 0.5); 
       socket.emit('canvasUpdate', { code: myCode, imageData });
    }
}

// ================= UI / SETUP =================
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
    if(code.length < 5) { alert("Invalid Room Code"); return; }
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
    document.getElementById('guessInput').placeholder = "Spectating Mode";
});

socket.on('updatePlayers', ({ players, drawerId }) => {
    const list = document.getElementById('playerList');
    list.innerHTML = players.map(p => `
        <div class="player-card ${p.hasGuessed ? 'has-guessed' : ''} ${p.id === drawerId ? 'is-drawer' : ''}">
            <span>${p.avatar} ${p.username} ${p.id === drawerId ? '🖌️' : ''}</span>
            <span class="player-score">${p.score}</span>
            ${isHost && p.id !== myId ? `<button class="kick-btn" onclick="kick('${p.id}')"><i class="fa-solid fa-xmark"></i></button>` : ''}
        </div>
    `).join('');
});

socket.on('updateSpectators', (specs) => {
    const list = document.getElementById('spectatorList');
    list.innerHTML = specs.length ? "<h4>Spectators</h4>" + specs.map(s => `
        <div class="player-card" style="opacity: 0.7;">
            <span>${s.avatar} ${s.username}</span>
            ${isHost && s.id !== myId ? `<button class="kick-btn" onclick="kick('${s.id}', true)"><i class="fa-solid fa-xmark"></i></button>` : ''}
        </div>
    `).join('') : "";
});

socket.on('canvasUpdate', (imageData) => {
    if (imageData) {
        restoreState(imageData);
    } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height); 
    }
});

socket.on('timerUpdate', (time) => document.getElementById('timerDisplay').innerText = time);

socket.on('newTurn', ({ drawerId }) => {
    isMyTurn = myId === drawerId;
    toolbar.style.display = (isMyTurn && !isSpectator) ? 'flex' : 'none';
    document.getElementById('guessInput').disabled = isMyTurn || isSpectator;
    document.getElementById('wordHintTop').innerText = isMyTurn ? "YOUR TURN TO DRAW!" : "GUESS THIS";
    document.getElementById('wordHintBottom').innerText = "WAITING...";
    
    undoStack = [];
    redoStack = [];
    canDraw = false; 
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setTool('brush'); 
    setColor('#000000');
});

socket.on('wordHint', ({ hint, length }) => {
    document.getElementById('wordHintTop').innerText = `GUESS THIS (${length} Letters)`;
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
    if (data.sys) {
        d.classList.add('sys');
        d.innerText = data.msg;
    } else {
        d.innerHTML = `<strong>${data.username}:</strong> ${data.msg}`;
    }
    chat.appendChild(d);
    chat.scrollTop = chat.scrollHeight;
});

socket.on('gamePaused', (paused) => {
    document.getElementById('pauseBtn').innerHTML = paused ? '<i class="fa-solid fa-play"></i>' : '<i class="fa-solid fa-pause"></i>';
    const overlay = document.getElementById('overlayMessage');
    overlay.innerText = "GAME PAUSED BY HOST";
    overlay.style.display = paused ? 'flex' : 'none';
});

socket.on('gameOver', ({ winner }) => {
    alert(`GAME OVER!\nWinner: ${winner.username} with ${winner.score} points!`);
    location.reload();
});

socket.on('errorMsg', (msg) => alert(msg));

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
    if(confirm("Are you sure you want to kick this player?")) {
        socket.emit('kickPlayer', { code: myCode, playerId: id, isSpectator: spec });
    }
}

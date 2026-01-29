const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, 'public')));

let rooms = {};
const defaultWords = ["Apple", "Banana", "Pizza", "Rocket", "Elephant", "Guitar", "Computer", "Mountain", "Spider", "Laptop", "Football", "Cloud", "Sword", "Dragon", "Castle", "Robot", "Cactus", "Hammer", "Bicycle", "Diamond", "Tree", "Car", "Book", "Sun", "Moon", "Star", "Flower", "River", "Bridge", "House", "Dog", "Cat", "Bird", "Fish", "Snake", "Lion", "Tiger", "Bear", "Monkey", "Horse", "Ghost", "Alien", "Witch", "Ninja", "Pirate", "Unicorn", "Dinosaur", "Zombie", "Vampire", "Mummy", "Skeleton", "Clown", "Wizard", "Fairy", "Mermaid", "Elf", "Genie", "Werewolf", "Yeti", "Bigfoot", "Kraken", "Godzilla", "King Kong"];

io.on('connection', (socket) => {
    
    // --- CREATE ROOM ---
    socket.on('createRoom', ({ username, settings, isSpectator }) => {
        const code = Math.random().toString(36).substring(2, 7).toUpperCase();
        const safeSettings = {
            maxPlayers: settings?.maxPlayers || 8,
            drawTime: settings?.drawTime || 80,
            rounds: settings?.rounds || 3,
            words: settings?.words && settings.words.length >= 3 ? settings.words : defaultWords
        };

        rooms[code] = { 
            hostId: socket.id, 
            players: [], 
            spectators: [], 
            settings: safeSettings, 
            gameState: 'lobby', 
            currentRound: 0, 
            drawerIndex: -1, 
            currentWord: "", 
            timer: 0, 
            interval: null, 
            isPaused: false 
        };

        socket.join(code);
        socket.emit('roomCreated', code);

        const p = { id: socket.id, username, avatar: '👑', score: 0, hasGuessed: false };
        if (isSpectator) {
            rooms[code].spectators.push(p);
            socket.emit('youAreSpectator');
        } else {
            rooms[code].players.push(p);
        }
        update(code);
    });

    // --- JOIN ROOM ---
    socket.on('joinRoom', ({ username, code, avatar, isSpectator }) => {
        const room = rooms[code];
        if (!room) return socket.emit('errorMsg', 'Room not found!');
        if (room.players.length >= room.settings.maxPlayers && !isSpectator) return socket.emit('errorMsg', 'Room is full!');

        const p = { id: socket.id, username, avatar, score: 0, hasGuessed: false };
        if (isSpectator) {
            room.spectators.push(p);
            socket.emit('youAreSpectator');
        } else {
            room.players.push(p);
        }

        socket.join(code);
        socket.emit('joinSuccess', { code });
        update(code);
        
        // Sync if game is running
        if(room.gameState === 'playing') {
             socket.emit('newTurn', { drawerId: room.players[room.drawerIndex]?.id, round: room.currentRound, maxRounds: room.settings.rounds });
             socket.emit('canvasUpdate', null);
        }
    });

    // --- START GAME ---
    socket.on('startGame', (code) => {
        const room = rooms[code];
        if (room && room.hostId === socket.id) {
            room.gameState = 'playing';
            nextTurn(code);
        }
    });

    // --- DRAWING SYNC ---
    socket.on('canvasUpdate', ({ code, imageData }) => { 
        // Broadcast drawing ONLY to others
        socket.to(code).emit('canvasUpdate', imageData); 
    });

    // --- REACTIONS ---
    socket.on('sendReaction', ({ code, type }) => {
        io.to(code).emit('reactionDisplay', type);
    });

    // --- GUESSING LOGIC ---
    socket.on('submitGuess', ({ code, guess }) => {
        const room = rooms[code];
        if (!room || room.gameState !== 'playing' || !room.currentWord) return;
        
        const p = room.players.find(x => x.id === socket.id);
        const drawer = room.players[room.drawerIndex];

        // LOGIC FIX: Drawer cannot guess
        if (!p || p.hasGuessed || (drawer && socket.id === drawer.id)) return;
        
        if (guess.toLowerCase() === room.currentWord.toLowerCase()) {
            p.hasGuessed = true;
            // Points based on speed
            const ratio = room.timer / room.settings.drawTime;
            const points = Math.floor(400 * ratio) + 100;
            p.score += points;
            // Bonus for drawer
            if(drawer) drawer.score += 50;
            
            io.to(code).emit('chatMsg', { sys: true, msg: `${p.username} GUESSED IT! (+${points})` });
            io.to(code).emit('correctGuess', { username: p.username });
            update(code);
            
            // If everyone guessed, end turn early
            const guessers = room.players.filter((x,i) => i !== room.drawerIndex);
            if(guessers.length > 0 && guessers.every(x => x.hasGuessed)) {
                endTurn(code);
            }
        } else { 
            // Wrong guess: Show in chat
            io.to(code).emit('chatMsg', { username: p.username, msg: guess }); 
        }
    });

    // --- WORD SELECTION ---
    socket.on('wordChosen', ({ code, word }) => {
        const room = rooms[code];
        if(!room) return;
        room.currentWord = word;
        // Send Hint (e.g. "_ _ _ _ _") to everyone
        io.to(code).emit('wordHint', { hint: word.replace(/./g,'_ '), length: word.length });
        // Tell drawer the real word
        socket.emit('yourWord', word);
        // Start Clock
        startTimer(code, room.settings.drawTime);
    });

    socket.on('togglePause', (code) => {
        const room = rooms[code];
        if(room && room.hostId === socket.id) {
            room.isPaused = !room.isPaused;
            io.to(code).emit('gamePaused', room.isPaused);
        }
    });

    socket.on('disconnect', () => {
        for(const c in rooms) {
            rooms[c].players = rooms[c].players.filter(p => p.id !== socket.id);
            rooms[c].spectators = rooms[c].spectators.filter(s => s.id !== socket.id);
            if(rooms[c].players.length === 0 && rooms[c].spectators.length === 0) delete rooms[c];
            else update(c);
        }
    });
});

// --- GAME LOOP ---
function nextTurn(code) {
    const room = rooms[code];
    if(!room) return;
    
    // Check Round Limit
    if (room.currentRound > room.settings.rounds) {
        const leaderboard = room.players.sort((a, b) => b.score - a.score);
        io.to(code).emit('gameOver', { leaderboard });
        return;
    }

    // Move to next player
    room.drawerIndex = (room.drawerIndex + 1) % room.players.length;
    if (room.drawerIndex === 0) room.currentRound++;
    
    if (room.currentRound > room.settings.rounds) {
        nextTurn(code);
        return;
    }

    // Reset Turn State
    room.players.forEach(p => p.hasGuessed = false);
    room.currentWord = "";
    update(code);
    
    const drawer = room.players[room.drawerIndex];
    if(!drawer) return; 

    // Notify clients of new turn
    io.to(code).emit('newTurn', { drawerId: drawer.id, round: room.currentRound, maxRounds: room.settings.rounds });
    io.to(code).emit('canvasUpdate', null); // Clear Canvas
    
    // Pick 3 Random Words
    const pool = (room.settings.words && room.settings.words.length >= 3) ? room.settings.words : defaultWords;
    const words = [];
    while(words.length < 3) {
        const w = pool[Math.floor(Math.random()*pool.length)];
        if(!words.includes(w)) words.push(w);
    }
    // Send words ONLY to drawer
    io.to(drawer.id).emit('chooseWord', words);
}

function startTimer(code, time) {
    const room = rooms[code];
    room.timer = time;
    if(room.interval) clearInterval(room.interval);
    room.interval = setInterval(() => {
        if(room.isPaused) return;
        room.timer--;
        io.to(code).emit('timerUpdate', room.timer);
        if(room.timer<=0) endTurn(code);
    }, 1000);
}

function endTurn(code) {
    const room = rooms[code];
    clearInterval(room.interval);
    // Reveal word
    io.to(code).emit('wordHint', { hint: room.currentWord, length: room.currentWord.length });
    io.to(code).emit('chatMsg', { sys: true, msg: `WORD WAS: ${room.currentWord}` });
    setTimeout(() => nextTurn(code), 5000);
}

function update(code) {
    const r = rooms[code];
    if(r) {
        const did = r.players[r.drawerIndex]?.id;
        io.to(code).emit('updatePlayers', { players: r.players, drawerId: did });
    }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Server Running on Port ' + PORT));

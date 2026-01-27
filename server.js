const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files from 'public' folder
app.use(express.static(path.join(__dirname, 'public')));

let rooms = {};

// Default word bank
const defaultWords = [
    "Apple", "Banana", "Pizza", "Rocket", "Elephant", "Guitar", "Computer", 
    "Mountain", "Spider", "Laptop", "Football", "Cloud", "Sword", "Dragon", 
    "Castle", "Robot", "Cactus", "Hammer", "Bicycle", "Diamond", "Tree", 
    "Car", "Book", "Sun", "Moon", "Star", "Flower", "River", "Bridge", 
    "House", "Dog", "Cat", "Bird", "Fish", "Snake", "Lion", "Tiger", 
    "Bear", "Monkey", "Horse", "Airplane", "Alarm", "Alien", "Angel", 
    "Ant", "Artist", "Astronaut", "Baby", "Balloon", "Bank"
];

io.on('connection', (socket) => {
    socket.on('createRoom', createRoomHandler(socket));
    socket.on('joinRoom', joinRoomHandler(socket));
    socket.on('startGame', startGameHandler(socket));
    socket.on('togglePause', togglePauseHandler(socket));
    // Updated handler for receiving full canvas snapshots
    socket.on('canvasUpdate', canvasUpdateHandler(socket)); 
    socket.on('submitGuess', submitGuessHandler(socket));
    socket.on('wordChosen', wordChosenHandler(socket));
    socket.on('kickPlayer', kickPlayerHandler(socket));
    socket.on('disconnect', disconnectHandler(socket));
});

// --- Handler Functions ---

function createRoomHandler(socket) {
    return ({ username, settings, isSpectator }) => {
        const code = Math.random().toString(36).substring(2, 7).toUpperCase();
        rooms[code] = {
            hostId: socket.id,
            hostIsSpectator: isSpectator,
            players: [],
            spectators: [],
            settings,
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
        
        const playerData = { id: socket.id, username, avatar: '👑', score: 0, hasGuessed: false };
        if (isSpectator) {
            rooms[code].spectators.push(playerData);
            socket.emit('youAreSpectator');
        } else {
            rooms[code].players.push(playerData);
        }
        updatePlayersAndSpectators(code);
    };
}

function joinRoomHandler(socket) {
    return ({ username, code, avatar, isSpectator }) => {
        const room = rooms[code];
        if (!room) return socket.emit('errorMsg', 'Invalid room');
        
        const playerData = { id: socket.id, username, avatar, score: 0, hasGuessed: false };

        if (isSpectator) {
            room.spectators.push(playerData);
            socket.emit('youAreSpectator');
        } else {
            if (room.players.length >= room.settings.maxPlayers) return socket.emit('errorMsg', 'Room full');
            if (room.gameState !== 'lobby') return socket.emit('errorMsg', 'Game already started');
            room.players.push(playerData);
        }

        socket.join(code);
        socket.emit('joinSuccess', { code });
        updatePlayersAndSpectators(code);
    };
}

function startGameHandler(socket) {
    return (code) => {
        const room = rooms[code];
        if (room && room.hostId === socket.id && room.gameState === 'lobby') {
            // For testing, you might want to allow 1 player, but normally 2+
            if (room.players.length < 2) return socket.emit('errorMsg', 'Need at least 2 players to start');
            room.gameState = 'playing';
            startNextTurn(code);
        }
    };
}

function togglePauseHandler(socket) {
    return (code) => {
        const room = rooms[code];
        if (room && room.hostId === socket.id && room.gameState === 'playing') {
            room.isPaused = !room.isPaused;
            if (room.isPaused) {
                if (room.interval) clearInterval(room.interval);
            } else {
                startTimer(code, room.timer, () => endTurn(code));
            }
            io.to(code).emit('gamePaused', room.isPaused);
        }
    };
}

// Updated: Receives full image data URL and broadcasts it
function canvasUpdateHandler(socket) {
    return ({ code, imageData }) => {
        const room = rooms[code];
        if (!room || room.drawerIndex === -1) return;
        // Verify the sender is the current drawer
        if (socket.id === room.players[room.drawerIndex].id) {
            socket.to(code).emit('canvasUpdate', imageData);
        }
    };
}

function submitGuessHandler(socket) {
    return ({ code, guess }) => {
        const room = rooms[code];
        if (!room || room.gameState !== 'playing' || room.isPaused || !room.currentWord) return;
        const player = room.players.find(p => p.id === socket.id);
        
        if (!player || player.hasGuessed || socket.id === room.players[room.drawerIndex].id) return;
        
        if (guess.trim().toLowerCase() === room.currentWord.toLowerCase()) {
            player.hasGuessed = true;
            // Scoring: More points for faster guesses
            const points = Math.floor((room.timer / room.settings.drawTime) * 400) + 100;
            player.score += points;
            
            // Give drawer some points too if someone guesses
            const drawer = room.players[room.drawerIndex];
            drawer.score += 50;

            io.to(code).emit('correctGuess', { username: player.username });
            io.to(code).emit('chatMsg', { sys: true, msg: `${player.username} guessed the word!` });
            updatePlayersAndSpectators(code);
            checkAllGuessed(code);
        } else {
            io.to(code).emit('chatMsg', { username: player.username, msg: guess });
        }
    };
}

function wordChosenHandler(socket) {
    return ({ code, word }) => {
        const room = rooms[code];
        if (room && socket.id === room.players[room.drawerIndex].id && !room.currentWord) {
            room.currentWord = word;
            // Generate hint: "_ _ _"
            const hint = word.split('').map(char => char === ' ' ? '  ' : '_ ').join('').trim();
            io.to(code).emit('wordHint', { hint, length: word.length });
            socket.emit('yourWord', word);
            startTimer(code, room.settings.drawTime, () => endTurn(code));
        }
    };
}

function kickPlayerHandler(socket) {
    return ({ code, playerId, isSpectator }) => {
        const room = rooms[code];
        if (room && room.hostId === socket.id) {
            if (isSpectator) {
                room.spectators = room.spectators.filter(s => s.id !== playerId);
            } else {
                room.players = room.players.filter(p => p.id !== playerId);
                if (room.drawerIndex >= room.players.length) room.drawerIndex = 0;
            }
            io.to(playerId).emit('errorMsg', 'You have been kicked by the host.');
            io.sockets.sockets.get(playerId)?.disconnect();
            updatePlayersAndSpectators(code);
        }
    };
}

function disconnectHandler(socket) {
    return () => {
        for (const code in rooms) {
            const room = rooms[code];
            if (room.hostId === socket.id) {
                io.to(code).emit('errorMsg', 'Host disconnected. Game over.');
                delete rooms[code];
            } else {
                room.players = room.players.filter(p => p.id !== socket.id);
                room.spectators = room.spectators.filter(s => s.id !== socket.id);
                updatePlayersAndSpectators(code);
                // If the current drawer disconnects, force end turn
                if (room.gameState === 'playing' && room.players[room.drawerIndex] && room.players[room.drawerIndex].id === socket.id) {
                     endTurn(code);
                }
            }
        }
    };
}

// --- Game Logic Helpers ---

function startNextTurn(code) {
    const room = rooms[code];
    if (!room) return;
    if (room.interval) clearInterval(room.interval);

    room.drawerIndex = (room.drawerIndex + 1) % room.players.length;
    if (room.drawerIndex === 0) room.currentRound++;

    if (room.currentRound > room.settings.rounds) {
        endGame(code);
        return;
    }

    room.players.forEach(p => p.hasGuessed = false);
    room.currentWord = "";
    updatePlayersAndSpectators(code);
    
    const drawer = room.players[room.drawerIndex];
    if (!drawer) return;

    const wordsPool = room.settings.words || defaultWords;
    const choices = [];
    while (choices.length < 3 && choices.length < wordsPool.length) {
        const w = wordsPool[Math.floor(Math.random() * wordsPool.length)];
        if (!choices.includes(w)) choices.push(w);
    }

    io.to(code).emit('chatMsg', { sys: true, msg: `Round ${room.currentRound}: ${drawer.username} is drawing!` });
    // Send empty canvas to start turn
    io.to(code).emit('canvasUpdate', null); 
    io.to(code).emit('newTurn', { drawerId: drawer.id });
    io.to(drawer.id).emit('chooseWord', choices);

    // Auto-select timeout
    setTimeout(() => {
        if (!room.currentWord && rooms[code] && rooms[code].currentRound === room.currentRound) {
            const word = choices[0] || "TimeOut";
            wordChosenHandler({ id: drawer.id })({ code, word });
        }
    }, 15000);
}

function startTimer(code, time, callback) {
    const room = rooms[code];
    room.timer = time;
    io.to(code).emit('timerUpdate', room.timer);
    
    room.interval = setInterval(() => {
        if (room.isPaused) return;
        room.timer--;
        io.to(code).emit('timerUpdate', room.timer);
        if (room.timer <= 0) {
            clearInterval(room.interval);
            callback();
        }
    }, 1000);
}

function endTurn(code) {
    const room = rooms[code];
    if(!room) return;
    if(room.interval) clearInterval(room.interval);
    io.to(code).emit('chatMsg', { sys: true, msg: `Time's up! The word was: ${room.currentWord}` });
    // Reveal word
    io.to(code).emit('wordHint', { hint: room.currentWord, length: room.currentWord ? room.currentWord.length : 0 }); 
    setTimeout(() => startNextTurn(code), 5000);
}

function checkAllGuessed(code) {
    const room = rooms[code];
    const guessers = room.players.filter((p, index) => index !== room.drawerIndex);
    const allGuessed = guessers.every(p => p.hasGuessed);
    if (allGuessed && guessers.length > 0) {
        endTurn(code);
    }
}

function endGame(code) {
    const room = rooms[code];
    if(!room) return;
    const winner = room.players.reduce((max, p) => p.score > max.score ? p : max, { score: -1, username: "No one" });
    io.to(code).emit('gameOver', { winner });
}

function updatePlayersAndSpectators(code) {
    const room = rooms[code];
    if(room) {
        // Send drawerID so frontend can highlight
        const drawerId = room.players[room.drawerIndex] ? room.players[room.drawerIndex].id : null;
        io.to(code).emit('updatePlayers', { players: room.players, drawerId });
        io.to(code).emit('updateSpectators', room.spectators);
    }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));

const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const WORDS = require('./words');

const PORT = process.env.PORT || 3000;
const ROUND_DURATION_MS = 60 * 1000;
const NEXT_ROUND_DELAY_MS = 4 * 1000;
const MIN_PLAYERS = 2;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// 단일 방 상태 (인메모리)
const room = {
  players: new Map(), // socketId -> { id, nickname, score }
  order: [], // 참여(출제) 순서
  hostId: null, // 방장(가장 먼저 입장한 사람)
  gameStarted: false, // 방장이 게임을 시작했는지 여부
  currentDrawerId: null,
  currentWord: null,
  roundActive: false,
  roundStartAt: null,
  roundEndsAt: null,
  roundTimer: null,
  nextRoundTimer: null,
};

function normalize(str) {
  return String(str).replace(/\s+/g, '').toLowerCase();
}

function getScoreboard() {
  return Array.from(room.players.values())
    .map((p) => ({
      id: p.id,
      nickname: p.nickname,
      score: p.score,
      isHost: p.id === room.hostId,
    }))
    .sort((a, b) => b.score - a.score);
}

function broadcastPlayerList() {
  io.emit('player-list', getScoreboard());
}

function systemMessage(text) {
  io.emit('chat', { system: text });
}

function startRound() {
  if (room.order.length < MIN_PLAYERS) return;

  clearTimeout(room.nextRoundTimer);

  let nextIndex = 0;
  if (room.currentDrawerId) {
    const idx = room.order.indexOf(room.currentDrawerId);
    nextIndex = idx === -1 ? 0 : (idx + 1) % room.order.length;
  }
  const drawerId = room.order[nextIndex];
  const drawer = room.players.get(drawerId);
  if (!drawer) return;

  room.currentDrawerId = drawerId;
  room.currentWord = WORDS[Math.floor(Math.random() * WORDS.length)];
  room.roundActive = true;
  room.roundStartAt = Date.now();
  room.roundEndsAt = room.roundStartAt + ROUND_DURATION_MS;

  io.emit('clear');
  io.emit('round-start', {
    drawerId,
    drawerName: drawer.nickname,
    wordLength: room.currentWord.length,
    endsAt: room.roundEndsAt,
  });
  io.to(drawerId).emit('word-for-drawer', { word: room.currentWord });

  room.roundTimer = setTimeout(() => endRound('timeout'), ROUND_DURATION_MS);
}

function endRound(reason, winnerName) {
  if (!room.roundActive) return;
  room.roundActive = false;
  clearTimeout(room.roundTimer);

  io.emit('round-end', {
    word: room.currentWord,
    reason,
    winnerName,
    scores: getScoreboard(),
  });

  room.currentWord = null;

  room.nextRoundTimer = setTimeout(() => {
    if (room.gameStarted && room.order.length >= MIN_PLAYERS) startRound();
  }, NEXT_ROUND_DELAY_MS);
}

io.on('connection', (socket) => {
  socket.on('join', ({ nickname } = {}) => {
    if (room.players.has(socket.id)) return;

    const name =
      String(nickname || '')
        .trim()
        .slice(0, 20) || `player-${socket.id.slice(0, 4)}`;

    room.players.set(socket.id, { id: socket.id, nickname: name, score: 0 });
    room.order.push(socket.id);

    if (!room.hostId) {
      room.hostId = socket.id;
      systemMessage(`${name}님이 방장이 되었습니다.`);
    }

    socket.emit('joined', { id: socket.id, isHost: room.hostId === socket.id });
    broadcastPlayerList();
    systemMessage(`${name}님이 입장했습니다.`);

    if (room.roundActive) {
      socket.emit('round-start', {
        drawerId: room.currentDrawerId,
        drawerName: room.players.get(room.currentDrawerId)?.nickname,
        wordLength: room.currentWord.length,
        endsAt: room.roundEndsAt,
      });
    } else {
      socket.emit('game-reset');
    }
  });

  socket.on('start-game', () => {
    if (socket.id !== room.hostId) return;
    if (room.gameStarted || room.roundActive) return;
    if (room.order.length < MIN_PLAYERS) return;

    room.gameStarted = true;
    startRound();
  });

  socket.on('draw', (data) => {
    if (socket.id !== room.currentDrawerId) return;
    socket.broadcast.emit('draw', data);
  });

  socket.on('clear', () => {
    if (socket.id !== room.currentDrawerId) return;
    socket.broadcast.emit('clear');
  });

  socket.on('guess', ({ text } = {}) => {
    if (!room.roundActive) return;
    if (socket.id === room.currentDrawerId) return;

    const player = room.players.get(socket.id);
    if (!player) return;

    const trimmed = String(text || '')
      .trim()
      .slice(0, 200);
    if (!trimmed) return;

    const isCorrect =
      !!room.currentWord && normalize(trimmed) === normalize(room.currentWord);

    if (isCorrect) {
      player.score += 1;

      io.emit('chat', { system: `${player.nickname}님 정답!` });
      broadcastPlayerList();
      endRound('guessed', player.nickname);
    } else {
      io.emit('chat', { nickname: player.nickname, text: trimmed });
    }
  });

  socket.on('skip', () => {
    if (!room.roundActive) return;
    if (socket.id !== room.currentDrawerId) return;
    endRound('skip');
  });

  socket.on('disconnect', () => {
    const player = room.players.get(socket.id);
    if (!player) return;

    room.players.delete(socket.id);
    room.order = room.order.filter((id) => id !== socket.id);

    if (room.hostId === socket.id) {
      room.hostId = room.order[0] || null;
      const newHost = room.hostId ? room.players.get(room.hostId) : null;
      if (newHost) systemMessage(`${newHost.nickname}님이 방장이 되었습니다.`);
    }

    systemMessage(`${player.nickname}님이 퇴장했습니다.`);
    broadcastPlayerList();

    if (room.currentDrawerId === socket.id && room.roundActive) {
      endRound('drawer-left');
    }

    if (room.order.length < MIN_PLAYERS) {
      clearTimeout(room.roundTimer);
      clearTimeout(room.nextRoundTimer);
      room.roundActive = false;
      room.currentWord = null;
      room.gameStarted = false;
      io.emit('game-reset');
    }
  });
});

server.listen(PORT, () => {
  console.log(`캐치마인드 서버 실행 중: http://localhost:${PORT}`);
});

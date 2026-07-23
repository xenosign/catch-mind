const socket = io();

// ---- DOM ----
const joinOverlay = document.getElementById("join-overlay");
const joinForm = document.getElementById("join-form");
const nicknameInput = document.getElementById("nickname-input");
const gameEl = document.getElementById("game");

const playerCountEl = document.getElementById("player-count");
const drawerInfoEl = document.getElementById("drawer-info");
const wordLabelEl = document.getElementById("word-label");
const wordHintEl = document.getElementById("word-hint");
const timerEl = document.getElementById("timer");

const toolbarEl = document.getElementById("toolbar");
const clearBtn = document.getElementById("clear-btn");
const skipBtn = document.getElementById("skip-btn");
const startBtn = document.getElementById("start-btn");
const colorButtons = Array.from(document.querySelectorAll(".color-btn"));
const sizeButtons = Array.from(document.querySelectorAll(".size-btn"));

const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const correctOverlayEl = document.getElementById("correct-overlay");

const sidebarCountEl = document.getElementById("sidebar-count");
const playerListEl = document.getElementById("player-list");

const chatLogEl = document.getElementById("chat-log");
const guessForm = document.getElementById("guess-form");
const guessInput = document.getElementById("guess-input");

// ---- 상태 ----
let myId = null;
let isHost = false;
let gameStarted = false;
let playerCount = 0;
let currentDrawerId = null;
let isDrawer = false;
let currentColor = "#000000";
let currentSize = 6;
let timerInterval = null;

// ---- 효과음 ----
let audioCtx = null;

function ensureAudioCtx() {
  if (!audioCtx) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AudioCtx();
  }
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

function playTone(freq, duration, delay = 0, gainValue = 0.2) {
  const ctxA = ensureAudioCtx();
  const osc = ctxA.createOscillator();
  const gain = ctxA.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  osc.connect(gain);
  gain.connect(ctxA.destination);

  const startTime = ctxA.currentTime + delay;
  gain.gain.setValueAtTime(gainValue, startTime);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
  osc.start(startTime);
  osc.stop(startTime + duration);
}

function playNewWordSound() {
  playTone(440, 0.12);
  playTone(660, 0.15, 0.12);
}

function playCorrectSound() {
  playTone(523.25, 0.12);
  playTone(659.25, 0.12, 0.12);
  playTone(783.99, 0.22, 0.24);
}

// ---- 입장 ----
joinForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const nickname = nicknameInput.value.trim();
  if (!nickname) return;
  ensureAudioCtx();
  socket.emit("join", { nickname });
  joinOverlay.classList.add("hidden");
  gameEl.classList.remove("hidden");
});

socket.on("joined", ({ id, isHost: hostFlag }) => {
  myId = id;
  isHost = !!hostFlag;
  updateWaitingUI();
});

// ---- 참가자 목록 ----
socket.on("player-list", (players) => {
  playerCount = players.length;
  playerCountEl.textContent = `${players.length}명 접속`;
  sidebarCountEl.textContent = players.length;
  playerListEl.innerHTML = "";
  players.forEach((p) => {
    const li = document.createElement("li");
    if (p.id === currentDrawerId) li.classList.add("drawer");
    const nameSpan = document.createElement("span");
    const prefix = `${p.isHost ? "👑 " : ""}${p.id === currentDrawerId ? "🖊 " : ""}`;
    nameSpan.textContent = `${prefix}${p.nickname}`;
    const scoreSpan = document.createElement("span");
    scoreSpan.textContent = p.score;
    li.appendChild(nameSpan);
    li.appendChild(scoreSpan);
    playerListEl.appendChild(li);
  });
  updateWaitingUI();
});

// ---- 게임 시작 대기 ----
const MIN_PLAYERS = 2;

function updateWaitingUI() {
  if (gameStarted || !isHost) {
    startBtn.classList.add("hidden");
  } else {
    startBtn.classList.remove("hidden");
    startBtn.disabled = playerCount < MIN_PLAYERS;
  }

  if (gameStarted) return;

  if (isHost) {
    drawerInfoEl.textContent =
      playerCount >= MIN_PLAYERS
        ? "게임 시작 버튼을 눌러주세요"
        : `참가자를 기다리는 중... (최소 ${MIN_PLAYERS}명)`;
  } else {
    drawerInfoEl.textContent = "방장이 게임을 시작하기를 기다리는 중...";
  }
}

startBtn.addEventListener("click", () => {
  if (startBtn.disabled) return;
  socket.emit("start-game");
});

socket.on("game-reset", () => {
  gameStarted = false;
  currentDrawerId = null;
  isDrawer = false;
  wordLabelEl.textContent = "문제:";
  wordHintEl.textContent = "";
  timerEl.textContent = "";
  toolbarEl.classList.add("hidden");
  canvas.style.pointerEvents = "none";
  guessInput.disabled = true;
  stopTimer();
  updateWaitingUI();
});

// ---- 라운드 진행 ----
socket.on("round-start", ({ drawerId, drawerName, wordLength, endsAt, roundNumber }) => {
  clearTimeout(correctOverlayTimer);
  correctOverlayEl.classList.remove("show");
  correctOverlayEl.classList.add("hidden");

  gameStarted = true;
  startBtn.classList.add("hidden");
  currentDrawerId = drawerId;
  isDrawer = drawerId === myId;

  drawerInfoEl.textContent = `${drawerName}님이 그리는 중`;
  wordLabelEl.textContent = `문제 ${roundNumber}:`;
  wordHintEl.textContent = "●".repeat(wordLength);

  toolbarEl.classList.toggle("hidden", !isDrawer);
  canvas.style.pointerEvents = isDrawer ? "auto" : "none";
  guessInput.disabled = isDrawer;
  guessInput.placeholder = isDrawer ? "그림을 그리는 중입니다" : "정답을 입력하세요";

  playNewWordSound();
  startTimer(endsAt);
});

socket.on("word-for-drawer", ({ word }) => {
  if (isDrawer) wordHintEl.textContent = word;
});

socket.on("round-end", ({ word, reason, winnerName }) => {
  stopTimer();
  wordHintEl.textContent = word;
  drawerInfoEl.textContent = "다음 라운드 준비 중...";
  toolbarEl.classList.add("hidden");
  canvas.style.pointerEvents = "none";
  guessInput.disabled = true;

  let reasonText = "";
  if (reason === "timeout") reasonText = "시간 종료!";
  else if (reason === "drawer-left") reasonText = "출제자가 나갔습니다.";
  else if (reason === "skip") reasonText = "출제자가 패스했습니다.";
  else if (reason === "guessed") {
    playCorrectSound();
    if (winnerName) showCorrectOverlay(`${winnerName}님 정답!`);
  }
  appendChat({ system: `정답은 "${word}" 였습니다. ${reasonText}` });
});

let correctOverlayTimer = null;
function showCorrectOverlay(text) {
  correctOverlayEl.textContent = text;
  correctOverlayEl.classList.remove("hidden");
  requestAnimationFrame(() => correctOverlayEl.classList.add("show"));

  clearTimeout(correctOverlayTimer);
  correctOverlayTimer = setTimeout(() => {
    correctOverlayEl.classList.remove("show");
    setTimeout(() => correctOverlayEl.classList.add("hidden"), 200);
  }, 2000);
}

function startTimer(endsAt) {
  stopTimer();
  const update = () => {
    const remaining = Math.max(0, Math.round((endsAt - Date.now()) / 1000));
    timerEl.textContent = `${remaining}초`;
    if (remaining <= 0) stopTimer();
  };
  update();
  timerInterval = setInterval(update, 500);
}

function stopTimer() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = null;
}

// ---- 채팅 ----
socket.on("chat", (msg) => {
  appendChat(msg);
});

function appendChat({ system, nickname, text }) {
  const line = document.createElement("div");
  if (system) {
    line.className = "system";
    line.textContent = system;
  } else {
    const nameSpan = document.createElement("span");
    nameSpan.className = "nickname";
    nameSpan.textContent = nickname + ":";
    line.appendChild(nameSpan);
    line.appendChild(document.createTextNode(text));
  }
  chatLogEl.appendChild(line);
  chatLogEl.scrollTop = chatLogEl.scrollHeight;
}

guessForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = guessInput.value.trim();
  if (!text || isDrawer) return;
  socket.emit("guess", { text });
  guessInput.value = "";
});

// ---- 캔버스 그리기 ----
function getCanvasPoint(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((clientX - rect.left) / rect.width) * canvas.width,
    y: ((clientY - rect.top) / rect.height) * canvas.height,
  };
}

function drawSegment(x0, y0, x1, y1, color, size) {
  ctx.strokeStyle = color;
  ctx.lineWidth = size;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

let drawing = false;
let lastPoint = null;

function pointerDown(clientX, clientY) {
  if (!isDrawer) return;
  drawing = true;
  const p = getCanvasPoint(clientX, clientY);
  lastPoint = p;
  socket.emit("draw", { type: "start", x: p.x, y: p.y, color: currentColor, size: currentSize });
}

function pointerMove(clientX, clientY) {
  if (!isDrawer || !drawing) return;
  const p = getCanvasPoint(clientX, clientY);
  drawSegment(lastPoint.x, lastPoint.y, p.x, p.y, currentColor, currentSize);
  socket.emit("draw", { type: "move", x: p.x, y: p.y, color: currentColor, size: currentSize });
  lastPoint = p;
}

function pointerUp() {
  if (!isDrawer) return;
  drawing = false;
  lastPoint = null;
  socket.emit("draw", { type: "end" });
}

canvas.addEventListener("mousedown", (e) => pointerDown(e.clientX, e.clientY));
canvas.addEventListener("mousemove", (e) => pointerMove(e.clientX, e.clientY));
window.addEventListener("mouseup", pointerUp);

canvas.addEventListener("touchstart", (e) => {
  const t = e.touches[0];
  pointerDown(t.clientX, t.clientY);
  e.preventDefault();
}, { passive: false });

canvas.addEventListener("touchmove", (e) => {
  const t = e.touches[0];
  pointerMove(t.clientX, t.clientY);
  e.preventDefault();
}, { passive: false });

canvas.addEventListener("touchend", (e) => {
  pointerUp();
  e.preventDefault();
}, { passive: false });

// 원격(다른 사람) 드로잉 재생
let remoteLastPoint = null;

socket.on("draw", (data) => {
  if (data.type === "start") {
    remoteLastPoint = { x: data.x, y: data.y };
  } else if (data.type === "move") {
    if (remoteLastPoint) {
      drawSegment(remoteLastPoint.x, remoteLastPoint.y, data.x, data.y, data.color, data.size);
    }
    remoteLastPoint = { x: data.x, y: data.y };
  } else if (data.type === "end") {
    remoteLastPoint = null;
  }
});

socket.on("clear", () => {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
});

// ---- 툴바 ----
colorButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    currentColor = btn.dataset.color;
    colorButtons.forEach((b) => b.classList.remove("selected"));
    btn.classList.add("selected");
  });
});
colorButtons[0].classList.add("selected");

sizeButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    currentSize = Number(btn.dataset.size);
    sizeButtons.forEach((b) => b.classList.remove("selected"));
    btn.classList.add("selected");
  });
});
sizeButtons[1].classList.add("selected");
currentSize = Number(sizeButtons[1].dataset.size);

clearBtn.addEventListener("click", () => {
  if (!isDrawer) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  socket.emit("clear");
});

skipBtn.addEventListener("click", () => {
  if (!isDrawer) return;
  socket.emit("skip");
});

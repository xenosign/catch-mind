const socket = io();

// ---- DOM ----
const joinOverlay = document.getElementById("join-overlay");
const joinForm = document.getElementById("join-form");
const nicknameInput = document.getElementById("nickname-input");
const gameEl = document.getElementById("game");

const playerCountEl = document.getElementById("player-count");
const drawerInfoEl = document.getElementById("drawer-info");
const wordHintEl = document.getElementById("word-hint");
const timerEl = document.getElementById("timer");

const toolbarEl = document.getElementById("toolbar");
const clearBtn = document.getElementById("clear-btn");
const colorButtons = Array.from(document.querySelectorAll(".color-btn"));
const sizeButtons = Array.from(document.querySelectorAll(".size-btn"));

const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

const sidebarCountEl = document.getElementById("sidebar-count");
const playerListEl = document.getElementById("player-list");

const chatLogEl = document.getElementById("chat-log");
const guessForm = document.getElementById("guess-form");
const guessInput = document.getElementById("guess-input");

// ---- 상태 ----
let myId = null;
let currentDrawerId = null;
let isDrawer = false;
let currentColor = "#000000";
let currentSize = 6;
let timerInterval = null;

// ---- 입장 ----
joinForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const nickname = nicknameInput.value.trim();
  if (!nickname) return;
  socket.emit("join", { nickname });
  joinOverlay.classList.add("hidden");
  gameEl.classList.remove("hidden");
});

socket.on("joined", ({ id }) => {
  myId = id;
});

// ---- 참가자 목록 ----
socket.on("player-list", (players) => {
  playerCountEl.textContent = `${players.length}명 접속`;
  sidebarCountEl.textContent = players.length;
  playerListEl.innerHTML = "";
  players.forEach((p) => {
    const li = document.createElement("li");
    if (p.id === currentDrawerId) li.classList.add("drawer");
    const nameSpan = document.createElement("span");
    nameSpan.textContent = p.id === currentDrawerId ? `🖊 ${p.nickname}` : p.nickname;
    const scoreSpan = document.createElement("span");
    scoreSpan.textContent = p.score;
    li.appendChild(nameSpan);
    li.appendChild(scoreSpan);
    playerListEl.appendChild(li);
  });
});

// ---- 라운드 진행 ----
socket.on("round-start", ({ drawerId, drawerName, wordLength, endsAt }) => {
  currentDrawerId = drawerId;
  isDrawer = drawerId === myId;

  drawerInfoEl.textContent = `${drawerName}님이 그리는 중`;
  wordHintEl.textContent = "_ ".repeat(wordLength).trim();

  toolbarEl.classList.toggle("hidden", !isDrawer);
  canvas.style.pointerEvents = isDrawer ? "auto" : "none";
  guessInput.disabled = isDrawer;
  guessInput.placeholder = isDrawer ? "그림을 그리는 중입니다" : "정답을 입력하세요";

  startTimer(endsAt);
});

socket.on("word-for-drawer", ({ word }) => {
  if (isDrawer) wordHintEl.textContent = word;
});

socket.on("round-end", ({ word, reason }) => {
  stopTimer();
  wordHintEl.textContent = word;
  drawerInfoEl.textContent = "다음 라운드 준비 중...";
  toolbarEl.classList.add("hidden");
  canvas.style.pointerEvents = "none";
  guessInput.disabled = true;

  let reasonText = "";
  if (reason === "timeout") reasonText = "시간 종료!";
  else if (reason === "drawer-left") reasonText = "출제자가 나갔습니다.";
  appendChat({ system: `정답은 "${word}" 였습니다. ${reasonText}` });
});

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

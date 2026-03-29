const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");
const next = require("next");
const { Server } = require("socket.io");

const {
  buildInitialGeneratedSongState,
  generateRoundSongAssets
} = require("./lib/ai/generateRoundSong");
const songLibrary = require("./lib/song-library");
const {
  renderTemplate,
  renderOutputTemplate
} = require("./lib/template-utils");

const dev = process.env.NODE_ENV !== "production";
const host = "0.0.0.0";
const port = Number(process.env.PORT) || 3000;

const TUTORIAL_DURATION_MS = 15_000;
const ROUND_INTRO_DURATION_MS = 2_500;
const WRITING_DURATION_MS = 45_000;
const STEP_DURATION_MS = 30_000;
const TIMES_UP_DURATION_MS = 2_000;
const REVEAL_LINE_INTERVAL_MS = 1_800;
const VOTE_DURATION_MS = 20_000;
const ROUND_RESULT_DURATION_MS = 3_000;
const DEFAULT_ROUND_SONG_DURATION_SEC = 35;

let masterSocketId = null;
let nextJoinOrder = 1;
let phaseTimer = null;
let revealTimer = null;
let voteTimer = null;

const stepTimers = new Map();
const displaySocketIds = new Set();
const players = new Map();
const gameState = {
  phase: "lobby",
  phaseDeadlineAt: null,
  roundId: null,
  roundNumber: 0,
  currentSong: null,
  imposterPlayerId: null,
  imposterDisplayName: "",
  playerAssignments: {},
  unitStates: {},
  votes: {},
  winner: null,
  roundOutcome: null,
  currentRevealLineIndex: 0,
  revealStartedAt: null,
  generatedSong: buildInitialGeneratedSongState()
};

function isPrivateIpv4Address(address) {
  return (
    /^192\.168\./.test(address) ||
    /^10\./.test(address) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(address)
  );
}

function getIpv4AddressScore(address) {
  if (!address) {
    return -1000;
  }

  if (/^192\.168\./.test(address)) {
    return 140;
  }

  if (/^10\./.test(address)) {
    return 100;
  }

  if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) {
    return 50;
  }

  if (/^169\.254\./.test(address)) {
    return -800;
  }

  return -120;
}

function getInterfaceNameScore(interfaceName) {
  const lowerName = String(interfaceName || "").toLowerCase();
  let score = 0;

  if (/(wi-?fi|wifi|wlan|wireless)/.test(lowerName)) {
    score += 320;
  }

  if (/\bethernet\b/.test(lowerName)) {
    score += 40;
  }

  if (
    /(vethernet|default switch|virtualbox|vmware|hyper-v|hyperv|docker|wsl|tailscale|zerotier|bluetooth|loopback|hamachi|vpn|tap|tun|local area connection\*)/.test(
      lowerName
    )
  ) {
    score -= 700;
  }

  return score;
}

function scoreLanCandidate(candidate) {
  let score = 0;

  score += getIpv4AddressScore(candidate.address);
  score += getInterfaceNameScore(candidate.name);

  if (candidate.hasGateway) {
    score += 260;
  } else {
    score -= 120;
  }

  if (!isPrivateIpv4Address(candidate.address)) {
    score -= 220;
  }

  if (/\.1$/.test(candidate.address) && !candidate.hasGateway) {
    score -= 80;
  }

  return score;
}

function parseWindowsIpconfigCandidates(output) {
  const sections = String(output || "").split(/\r?\n\r?\n+/);
  const candidates = [];

  for (const section of sections) {
    const lines = section.split(/\r?\n/).filter((line) => line.trim());

    if (lines.length === 0) {
      continue;
    }

    const header = lines[0].trim().replace(/:$/, "");
    let disconnected = false;
    let ipv4Address = null;
    let hasGateway = false;
    let waitingForGatewayContinuation = false;

    for (const line of lines.slice(1)) {
      const trimmedLine = line.trim();

      if (/Media State/i.test(trimmedLine) && /disconnected/i.test(trimmedLine)) {
        disconnected = true;
      }

      const ipv4Match = line.match(
        /(IPv4 Address|Autoconfiguration IPv4 Address)[^:]*:\s*([0-9.]+)/i
      );

      if (ipv4Match) {
        ipv4Address = ipv4Match[2];
      }

      if (/Default Gateway/i.test(line)) {
        const directGatewayMatch = line.match(/([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)/);

        if (directGatewayMatch) {
          hasGateway = true;
          waitingForGatewayContinuation = false;
        } else {
          waitingForGatewayContinuation = true;
        }

        continue;
      }

      if (waitingForGatewayContinuation) {
        const continuedGatewayMatch = line.match(/([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)/);

        if (continuedGatewayMatch) {
          hasGateway = true;
        }

        waitingForGatewayContinuation = false;
      }
    }

    if (ipv4Address && !disconnected) {
      candidates.push({
        name: header,
        address: ipv4Address,
        hasGateway
      });
    }
  }

  return candidates;
}

function parseWindowsRouteCandidates(output) {
  const lines = String(output || "").split(/\r?\n/);
  const candidates = [];
  let inActiveRoutes = false;

  for (const line of lines) {
    const trimmedLine = line.trim();

    if (trimmedLine === "Active Routes:") {
      inActiveRoutes = true;
      continue;
    }

    if (!inActiveRoutes) {
      continue;
    }

    if (!trimmedLine || /^=+/.test(trimmedLine) || /^Persistent Routes:/i.test(trimmedLine)) {
      if (/^Persistent Routes:/i.test(trimmedLine)) {
        break;
      }

      continue;
    }

    const columns = trimmedLine.split(/\s+/);

    if (columns.length < 5) {
      continue;
    }

    if (columns[0] !== "0.0.0.0" || columns[1] !== "0.0.0.0") {
      continue;
    }

    const gateway = columns[2];
    const interfaceAddress = columns[3];
    const metric = Number.parseInt(columns[4], 10);

    if (!isPrivateIpv4Address(interfaceAddress)) {
      continue;
    }

    candidates.push({
      name: "default-route",
      address: interfaceAddress,
      hasGateway: gateway !== "On-link",
      metric: Number.isNaN(metric) ? Number.MAX_SAFE_INTEGER : metric
    });
  }

  return candidates;
}

function getWindowsDefaultRouteAddress() {
  try {
    const output = execSync("route print -4", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    const candidates = parseWindowsRouteCandidates(output);

    if (candidates.length === 0) {
      return null;
    }

    return candidates.sort((left, right) => {
      if (left.metric !== right.metric) {
        return left.metric - right.metric;
      }

      return scoreLanCandidate(right) - scoreLanCandidate(left);
    })[0].address;
  } catch (error) {
    return null;
  }
}

function getWindowsPreferredIpAddress() {
  try {
    const output = execSync("ipconfig", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    const candidates = parseWindowsIpconfigCandidates(output);

    if (candidates.length === 0) {
      return null;
    }

    return candidates.sort((left, right) => {
      return scoreLanCandidate(right) - scoreLanCandidate(left);
    })[0].address;
  } catch (error) {
    return null;
  }
}

function getFallbackLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  const candidates = [];

  for (const [interfaceName, networkEntries] of Object.entries(interfaces)) {
    for (const networkEntry of networkEntries || []) {
      const family =
        typeof networkEntry.family === "string"
          ? networkEntry.family
          : String(networkEntry.family);

      if (family !== "IPv4" || networkEntry.internal) {
        continue;
      }

      candidates.push({
        name: interfaceName,
        address: networkEntry.address,
        hasGateway: false
      });
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  return candidates.sort((left, right) => {
    return scoreLanCandidate(right) - scoreLanCandidate(left);
  })[0].address;
}

function getLocalIpAddress() {
  if (process.platform === "win32") {
    const defaultRouteAddress = getWindowsDefaultRouteAddress();

    if (defaultRouteAddress) {
      return defaultRouteAddress;
    }

    const preferredWindowsAddress = getWindowsPreferredIpAddress();

    if (preferredWindowsAddress) {
      return preferredWindowsAddress;
    }
  }

  return getFallbackLocalIpAddress();
}

function resolveGeneratedAudioDir() {
  return path.resolve(
    process.cwd(),
    process.env.GENERATED_AUDIO_DIR || "./data/generated-audio"
  );
}

function getMimeTypeFromFilePath(filePath) {
  const extension = path.extname(filePath).toLowerCase();

  if (extension === ".wav") {
    return "audio/wav";
  }

  if (extension === ".mp3") {
    return "audio/mpeg";
  }

  if (extension === ".json") {
    return "application/json";
  }

  return "application/octet-stream";
}

function serveGeneratedAudioRequest(req, res) {
  if (!req.url || !req.url.startsWith("/generated-audio/")) {
    return false;
  }

  const baseDirectory = resolveGeneratedAudioDir();
  const pathname = decodeURIComponent(req.url.split("?")[0]);
  const relativePath = pathname.replace(/^\/generated-audio\//, "");
  const requestedPath = path.resolve(baseDirectory, relativePath);
  const safeBase = baseDirectory.toLowerCase();
  const safePath = requestedPath.toLowerCase();
  const safeBasePrefix = `${safeBase}${path.sep}`;

  if (safePath !== safeBase && !safePath.startsWith(safeBasePrefix)) {
    res.statusCode = 403;
    res.end("Forbidden");
    return true;
  }

  if (!fs.existsSync(requestedPath) || !fs.statSync(requestedPath).isFile()) {
    res.statusCode = 404;
    res.end("Not found");
    return true;
  }

  res.statusCode = 200;
  res.setHeader("Content-Type", getMimeTypeFromFilePath(requestedPath));
  fs.createReadStream(requestedPath).pipe(res);
  return true;
}

const localIpAddress = getLocalIpAddress();

function clearPhaseTimer() {
  if (phaseTimer) {
    clearTimeout(phaseTimer);
    phaseTimer = null;
  }
}

function clearRevealTimer() {
  if (revealTimer) {
    clearTimeout(revealTimer);
    revealTimer = null;
  }
}

function clearVoteTimer() {
  if (voteTimer) {
    clearTimeout(voteTimer);
    voteTimer = null;
  }
}

function clearStepTimer(unitId) {
  const timer = stepTimers.get(unitId);

  if (timer) {
    clearTimeout(timer);
    stepTimers.delete(unitId);
  }
}

function clearAllStepTimers() {
  for (const unitId of stepTimers.keys()) {
    clearStepTimer(unitId);
  }
}

function clearAllGameTimers() {
  clearPhaseTimer();
  clearRevealTimer();
  clearVoteTimer();
  clearAllStepTimers();
}

function resetGameState() {
  clearAllGameTimers();
  gameState.phase = "lobby";
  gameState.phaseDeadlineAt = null;
  gameState.roundId = null;
  gameState.roundNumber = 0;
  gameState.currentSong = null;
  gameState.imposterPlayerId = null;
  gameState.imposterDisplayName = "";
  gameState.playerAssignments = {};
  gameState.unitStates = {};
  gameState.votes = {};
  gameState.winner = null;
  gameState.roundOutcome = null;
  gameState.currentRevealLineIndex = 0;
  gameState.revealStartedAt = null;
  gameState.generatedSong = buildInitialGeneratedSongState();
}

function getOrderedParticipants() {
  return Array.from(players.values()).sort((a, b) => a.joinOrder - b.joinOrder);
}

function getRegisteredPlayers() {
  return getOrderedParticipants().filter((player) => player.registered);
}

function getAlivePlayers() {
  return getRegisteredPlayers().filter((player) => player.alive);
}

function getPlayerFromSocket(socket) {
  return players.get(socket.data.playerId) || null;
}

function getMasterPlayer() {
  return (
    getOrderedParticipants().find((player) => player.socketId === masterSocketId) || null
  );
}

function getDisplayName(player) {
  if (!player) {
    return "Disconnected player";
  }

  return player.name || `Player ${player.joinOrder}`;
}

function pickRandom(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function getOrderedPromptUnits(song) {
  return [...(song?.promptUnits || [])].sort((a, b) => a.order - b.order);
}

function getOrderedUnitStates() {
  return Object.values(gameState.unitStates).sort((a, b) => a.order - b.order);
}

function isPlayerAssignedThisRound(playerId) {
  return Boolean(gameState.playerAssignments[playerId]);
}

function getAssignedAlivePlayers() {
  return getAlivePlayers().filter((player) =>
    isPlayerAssignedThisRound(player.playerId)
  );
}

function countAliveVotes() {
  return getAlivePlayers().filter(
    (player) => typeof gameState.votes[player.playerId] === "string"
  ).length;
}

function haveAllAliveVoted() {
  const alivePlayers = getAlivePlayers();

  return (
    alivePlayers.length > 0 &&
    alivePlayers.every(
      (player) => typeof gameState.votes[player.playerId] === "string"
    )
  );
}

function countCompletedUnits() {
  return getOrderedUnitStates().filter((unitState) => unitState.completed).length;
}

function allUnitsComplete() {
  const unitStates = getOrderedUnitStates();

  return unitStates.length > 0 && unitStates.every((unitState) => unitState.completed);
}

function assignMasterToPlayer(player) {
  masterSocketId = player?.socketId || null;

  for (const participant of players.values()) {
    participant.connectionRole =
      player && participant.playerId === player.playerId ? "master" : "slave";
  }
}

function assignFallbackMasterInLobbyOrGameOver() {
  if (masterSocketId || (gameState.phase !== "lobby" && gameState.phase !== "game_over")) {
    return;
  }

  const fallbackPlayer = getRegisteredPlayers()[0] || null;

  if (fallbackPlayer) {
    assignMasterToPlayer(fallbackPlayer);
  }
}

function getCurrentImposterName() {
  return gameState.imposterDisplayName || "Disconnected player";
}

function getCurrentStepDefinition(unitState) {
  if (!unitState || unitState.completed) {
    return null;
  }

  return unitState.steps[unitState.currentStepIndex] || null;
}

function sanitizeResponse(value, stepDefinition) {
  const constraints = stepDefinition?.constraints || {};
  let nextValue = String(value || "")
    .replace(/\s+/g, " ")
    .trim();

  if (!nextValue) {
    return "";
  }

  if (typeof constraints.maxWords === "number" && constraints.maxWords > 0) {
    nextValue = nextValue
      .split(" ")
      .filter(Boolean)
      .slice(0, constraints.maxWords)
      .join(" ");
  }

  if (typeof constraints.maxChars === "number" && constraints.maxChars > 0) {
    nextValue = nextValue.slice(0, constraints.maxChars).trim();
  }

  return nextValue;
}

function resolveBindings(stepDefinition, currentPlayerId) {
  const resolvedBindings = {};
  const bindingDefinitions = stepDefinition.bindings || [];

  for (const bindingDefinition of bindingDefinitions) {
    if (bindingDefinition?.source?.kind === "random_other_alive_player_name") {
      const alivePlayers = getAlivePlayers();
      const candidatePlayers = alivePlayers.filter(
        (player) => player.playerId !== currentPlayerId
      );
      const chosenPlayer =
        candidatePlayers.length > 0
          ? pickRandom(candidatePlayers)
          : currentPlayerId
            ? null
            : alivePlayers[0] || null;

      resolvedBindings[bindingDefinition.key] = chosenPlayer
        ? getDisplayName(chosenPlayer)
        : "that one legend";
      continue;
    }

    resolvedBindings[bindingDefinition.key] = "";
  }

  return resolvedBindings;
}

function prepareStep(unitState, stepDefinition) {
  if (unitState.stepMetaById[stepDefinition.id]) {
    return unitState.stepMetaById[stepDefinition.id];
  }

  const savedBindings =
    unitState.bindingsByStepId[stepDefinition.id] ||
    resolveBindings(stepDefinition, unitState.assignedPlayerId);

  unitState.bindingsByStepId[stepDefinition.id] = savedBindings;

  const roleConfig = stepDefinition[unitState.role] || stepDefinition.lyricist;
  const defaultResponse =
    sanitizeResponse(
      renderTemplate(roleConfig.defaultResponseTemplate, savedBindings),
      stepDefinition
    ) || "...";

  const renderedStep = {
    stepId: stepDefinition.id,
    promptText: renderTemplate(roleConfig.promptTemplate, savedBindings),
    sharedText: renderTemplate(stepDefinition.sharedTextTemplate, savedBindings),
    defaultBotInstruction: renderTemplate(
      roleConfig.defaultBotInstructionTemplate,
      savedBindings
    ),
    defaultResponse,
    defaultTag: roleConfig.defaultTag || null,
    bindings: savedBindings,
    usedDefault: false,
    fallbackReason: null
  };

  unitState.stepMetaById[stepDefinition.id] = renderedStep;
  return renderedStep;
}

function completeUnit(unitState) {
  clearStepTimer(unitState.unitId);
  unitState.deadlineAt = null;
  unitState.completed = true;

  const outputValues = {};

  for (const stepDefinition of unitState.steps) {
    outputValues[stepDefinition.id] =
      unitState.responsesByStepId[stepDefinition.id] || "";
  }

  unitState.finalLine = renderOutputTemplate(unitState.outputTemplate, outputValues);
}

function fillRemainingUnitWithDefaults(unitState, reason) {
  if (!unitState || unitState.completed) {
    return;
  }

  clearStepTimer(unitState.unitId);

  for (
    let stepIndex = unitState.currentStepIndex;
    stepIndex < unitState.steps.length;
    stepIndex += 1
  ) {
    unitState.currentStepIndex = stepIndex;

    const stepDefinition = unitState.steps[stepIndex];
    const stepMeta = prepareStep(unitState, stepDefinition);

    unitState.responsesByStepId[stepDefinition.id] = stepMeta.defaultResponse;
    unitState.stepMetaById[stepDefinition.id] = {
      ...stepMeta,
      usedDefault: true,
      fallbackReason: reason
    };
  }

  unitState.currentStepIndex = unitState.steps.length;
  completeUnit(unitState);
}

function getRevealLines() {
  return getOrderedUnitStates()
    .map((unitState) => ({
      unitId: unitState.unitId,
      section: unitState.section,
      ownerLabel: unitState.assignedPlayerName || "Auto fill",
      text: unitState.finalLine || ""
    }))
    .filter((line) => line.text);
}

function getGeneratedSongSnapshot() {
  return {
    status: gameState.generatedSong.status,
    audioUrl: gameState.generatedSong.audioUrl,
    mimeType: gameState.generatedSong.mimeType,
    lyricsLines: gameState.generatedSong.lyricsLines,
    lineTimings: gameState.generatedSong.lineTimings,
    wordTimings: gameState.generatedSong.wordTimings,
    errorMessage: gameState.generatedSong.errorMessage,
    musicProvider: gameState.generatedSong.musicProvider,
    alignmentProvider: gameState.generatedSong.alignmentProvider,
    promptUsed: gameState.generatedSong.promptUsed,
    roundId: gameState.generatedSong.roundId
  };
}

function getRoundOutcomeSnapshot() {
  if (!gameState.roundOutcome) {
    return null;
  }

  return {
    votedPlayerName: gameState.roundOutcome.votedPlayerName,
    wasCorrect: gameState.roundOutcome.wasCorrect,
    eliminatedPlayerName: gameState.roundOutcome.eliminatedPlayerName,
    imposterName: gameState.roundOutcome.imposterName
  };
}

function buildCurrentUnitSnapshot(player) {
  const unitId = gameState.playerAssignments[player.playerId];

  if (!unitId) {
    return null;
  }

  const unitState = gameState.unitStates[unitId];

  if (!unitState) {
    return null;
  }

  const currentStepDefinition = getCurrentStepDefinition(unitState);
  const currentStepMeta =
    currentStepDefinition && !unitState.completed
      ? prepareStep(unitState, currentStepDefinition)
      : null;

  return {
    unitId: unitState.unitId,
    section: unitState.section,
    order: unitState.order,
    completed: unitState.completed,
    completedStepCount: unitState.steps.filter(
      (stepDefinition) =>
        typeof unitState.responsesByStepId[stepDefinition.id] === "string"
    ).length,
    totalSteps: unitState.steps.length,
    currentStep:
      currentStepDefinition && currentStepMeta
        ? {
            stepId: currentStepDefinition.id,
            order: currentStepDefinition.order,
            kind: currentStepDefinition.kind,
            promptText: currentStepMeta.promptText,
            sharedText: currentStepMeta.sharedText,
            deadlineAt: unitState.deadlineAt,
            constraints: currentStepDefinition.constraints || null
          }
        : null
  };
}

function buildSnapshot(socket) {
  const player =
    socket.data.clientType === "participant"
      ? players.get(socket.data.playerId) || null
      : null;
  const registeredPlayers = getRegisteredPlayers();
  const alivePlayers = getAlivePlayers();
  const currentSong = gameState.currentSong;
  const unitId = player ? gameState.playerAssignments[player.playerId] : null;
  const assignedUnit = unitId ? gameState.unitStates[unitId] : null;
  const voteTargets = getAssignedAlivePlayers();
  const masterPlayer = getMasterPlayer();

  return {
    clientType: socket.data.clientType,
    self: player
      ? {
          playerId: player.playerId,
          name: player.name,
          displayName: getDisplayName(player),
          registered: player.registered,
          connectionRole: player.connectionRole,
          alive: player.alive,
          isAssignedThisRound: Boolean(unitId),
          roleTheme:
            gameState.phase === "writing" && assignedUnit && currentSong
              ? currentSong.roleThemes[assignedUnit.role] || null
              : null,
          hasVoted: typeof gameState.votes[player.playerId] === "string",
          votedForPlayerId: gameState.votes[player.playerId] || null,
          currentUnit:
            gameState.phase === "writing" && player.alive
              ? buildCurrentUnitSnapshot(player)
              : null
        }
      : null,
    players: registeredPlayers.map((currentPlayer) => ({
      playerId: currentPlayer.playerId,
      name: getDisplayName(currentPlayer),
      alive: currentPlayer.alive,
      connectionRole: currentPlayer.connectionRole,
      isAssignedThisRound: isPlayerAssignedThisRound(currentPlayer.playerId)
    })),
    game: {
      phase: gameState.phase,
      phaseDeadlineAt: gameState.phaseDeadlineAt,
      roundId: gameState.roundId,
      roundNumber: gameState.roundNumber,
      songId: currentSong?.id || null,
      songTitle: currentSong?.title || null,
      publicTheme: currentSong?.publicTheme || null,
      localIpAddress,
      localGameUrl: localIpAddress ? `http://${localIpAddress}:${port}/game` : null,
      totalPlayers: registeredPlayers.length,
      totalAlivePlayers: alivePlayers.length,
      totalPromptUnits: getOrderedUnitStates().length,
      completedUnitCount: countCompletedUnits(),
      voteCount: countAliveVotes(),
      currentRevealLineIndex: gameState.currentRevealLineIndex,
      voteTargets:
        gameState.phase === "voting"
          ? voteTargets.map((voteTarget) => ({
              playerId: voteTarget.playerId,
              name: getDisplayName(voteTarget)
            }))
          : [],
      generatedSong: getGeneratedSongSnapshot(),
      revealLines:
        gameState.phase === "lyric_reveal" ||
        gameState.phase === "voting" ||
        gameState.phase === "round_result" ||
        gameState.phase === "game_over"
          ? getRevealLines()
          : [],
      roundOutcome:
        gameState.phase === "round_result" || gameState.phase === "game_over"
          ? getRoundOutcomeSnapshot()
          : null,
      winner: gameState.winner,
      imposterName:
        gameState.phase === "round_result" || gameState.phase === "game_over"
          ? getCurrentImposterName()
          : null,
      masterPlayerName:
        masterPlayer && masterPlayer.registered ? getDisplayName(masterPlayer) : null,
      displayCount: displaySocketIds.size
    }
  };
}

function broadcastState(io) {
  for (const socket of io.sockets.sockets.values()) {
    socket.emit("state", buildSnapshot(socket));
  }
}

function beginGameOver(io) {
  clearPhaseTimer();
  clearRevealTimer();
  clearVoteTimer();
  clearAllStepTimers();

  gameState.phase = "game_over";
  gameState.phaseDeadlineAt = null;
  gameState.currentRevealLineIndex = 0;
  gameState.revealStartedAt = null;
  broadcastState(io);
}

function beginRoundIntro(io) {
  clearPhaseTimer();
  clearRevealTimer();
  clearVoteTimer();
  clearAllStepTimers();

  if (!initializeRoundState()) {
    beginGameOver(io);
    return;
  }

  gameState.phase = "round_intro";
  gameState.phaseDeadlineAt = Date.now() + ROUND_INTRO_DURATION_MS;
  gameState.currentRevealLineIndex = 0;
  gameState.revealStartedAt = null;
  phaseTimer = setTimeout(() => beginWriting(io), ROUND_INTRO_DURATION_MS);

  broadcastState(io);
}

function startRoundResult(io) {
  clearPhaseTimer();
  clearRevealTimer();
  clearVoteTimer();
  clearAllStepTimers();

  gameState.phase = "round_result";
  gameState.phaseDeadlineAt = Date.now() + ROUND_RESULT_DURATION_MS;
  gameState.revealStartedAt = null;

  phaseTimer = setTimeout(() => {
    if (gameState.winner) {
      beginGameOver(io);
      return;
    }

    beginRoundIntro(io);
  }, ROUND_RESULT_DURATION_MS);

  broadcastState(io);
}

function resolveVoting(io) {
  if (gameState.phase !== "voting") {
    return;
  }

  clearVoteTimer();
  gameState.phaseDeadlineAt = null;

  const alivePlayers = getAlivePlayers();
  const voteTargets = getAssignedAlivePlayers();

  if (alivePlayers.length < 2) {
    gameState.winner = alivePlayers.some(
      (player) => player.playerId === gameState.imposterPlayerId
    )
      ? "imposter"
      : "lyricists";
    startRoundResult(io);
    return;
  }

  if (voteTargets.length === 0) {
    gameState.winner = "lyricists";
    startRoundResult(io);
    return;
  }

  const voteCounts = {};

  for (const player of voteTargets) {
    voteCounts[player.playerId] = 0;
  }

  for (const voter of alivePlayers) {
    const targetPlayerId = gameState.votes[voter.playerId];

    if (targetPlayerId && targetPlayerId in voteCounts) {
      voteCounts[targetPlayerId] += 1;
    }
  }

  let highestVotes = -1;
  let selectedPlayer = voteTargets[0];

  for (const player of voteTargets) {
    const currentVotes = voteCounts[player.playerId];

    if (currentVotes > highestVotes) {
      highestVotes = currentVotes;
      selectedPlayer = player;
    }
  }

  const wasCorrect = selectedPlayer.playerId === gameState.imposterPlayerId;

  gameState.roundOutcome = {
    votedPlayerName: getDisplayName(selectedPlayer),
    wasCorrect,
    eliminatedPlayerName: wasCorrect ? null : getDisplayName(selectedPlayer),
    imposterName: getCurrentImposterName()
  };

  if (wasCorrect) {
    gameState.winner = "lyricists";
    startRoundResult(io);
    return;
  }

  selectedPlayer.alive = false;

  const remainingAlivePlayers = getAlivePlayers();
  const imposterStillAlive = remainingAlivePlayers.some(
    (player) => player.playerId === gameState.imposterPlayerId
  );

  if (remainingAlivePlayers.length <= 2 && imposterStillAlive) {
    gameState.winner = "imposter";
  } else {
    gameState.winner = null;
  }

  startRoundResult(io);
}

function beginVoting(io) {
  clearRevealTimer();
  clearPhaseTimer();

  if (gameState.phase !== "lyric_reveal") {
    return;
  }

  gameState.phase = "voting";
  gameState.phaseDeadlineAt = Date.now() + VOTE_DURATION_MS;
  gameState.revealStartedAt = null;
  gameState.votes = {};

  voteTimer = setTimeout(() => resolveVoting(io), VOTE_DURATION_MS);
  broadcastState(io);
}

function getRevealDurationMsFromGeneratedSong() {
  const lineTimings = gameState.generatedSong.lineTimings || [];

  if (lineTimings.length === 0) {
    return 0;
  }

  return Math.max(
    REVEAL_LINE_INTERVAL_MS * lineTimings.length,
    ...lineTimings.map((line) => Number(line.endMs || 0))
  );
}

function scheduleGeneratedRevealUpdates(io, lineTimings, revealStartedAt, nextIndex = 1) {
  if (gameState.phase !== "lyric_reveal" || nextIndex >= lineTimings.length) {
    return;
  }

  const elapsedMs = Date.now() - revealStartedAt;
  const delayMs = Math.max(0, Number(lineTimings[nextIndex].startMs || 0) - elapsedMs);

  revealTimer = setTimeout(() => {
    if (
      gameState.phase !== "lyric_reveal" ||
      gameState.revealStartedAt !== revealStartedAt
    ) {
      return;
    }

    gameState.currentRevealLineIndex = nextIndex;
    broadcastState(io);
    scheduleGeneratedRevealUpdates(io, lineTimings, revealStartedAt, nextIndex + 1);
  }, delayMs);
}

function advanceLyricReveal(io) {
  if (gameState.phase !== "lyric_reveal") {
    return;
  }

  const revealLines = getRevealLines();

  if (revealLines.length === 0) {
    beginVoting(io);
    return;
  }

  if (gameState.currentRevealLineIndex >= revealLines.length - 1) {
    beginVoting(io);
    return;
  }

  gameState.currentRevealLineIndex += 1;
  broadcastState(io);

  revealTimer = setTimeout(() => advanceLyricReveal(io), REVEAL_LINE_INTERVAL_MS);
}

function beginLyricReveal(io) {
  clearPhaseTimer();
  clearRevealTimer();

  if (
    gameState.phase !== "times_up" &&
    gameState.phase !== "ai_song_generating"
  ) {
    return;
  }

  const revealLines = getRevealLines();

  gameState.phase = "lyric_reveal";
  gameState.currentRevealLineIndex = 0;
  gameState.revealStartedAt = Date.now();

  if (revealLines.length === 0) {
    gameState.phaseDeadlineAt = null;
    broadcastState(io);
    beginVoting(io);
    return;
  }

  const generatedRevealDurationMs =
    gameState.generatedSong.status === "ready"
      ? getRevealDurationMsFromGeneratedSong()
      : 0;

  if (
    generatedRevealDurationMs > 0 &&
    gameState.generatedSong.lineTimings.length === revealLines.length
  ) {
    gameState.phaseDeadlineAt = Date.now() + generatedRevealDurationMs;
    broadcastState(io);

    scheduleGeneratedRevealUpdates(
      io,
      gameState.generatedSong.lineTimings,
      gameState.revealStartedAt
    );
    phaseTimer = setTimeout(() => beginVoting(io), generatedRevealDurationMs);
    return;
  }

  gameState.phaseDeadlineAt = Date.now() + REVEAL_LINE_INTERVAL_MS * revealLines.length;
  broadcastState(io);
  revealTimer = setTimeout(() => advanceLyricReveal(io), REVEAL_LINE_INTERVAL_MS);
}

async function beginAiSongGenerating(io) {
  clearPhaseTimer();

  if (gameState.phase !== "times_up") {
    return;
  }

  const activeRoundId = gameState.roundId;

  gameState.phase = "ai_song_generating";
  gameState.phaseDeadlineAt = null;
  gameState.currentRevealLineIndex = 0;
  gameState.revealStartedAt = null;
  gameState.generatedSong = {
    ...buildInitialGeneratedSongState(getRevealLines().map((line) => line.text)),
    status: "generating",
    roundId: activeRoundId
  };
  broadcastState(io);

  const generatedSong = await generateRoundSongAssets({
    roundId: activeRoundId,
    roundNumber: gameState.roundNumber,
    title: gameState.currentSong?.title || "LAN Lyric Imposter",
    stylePrompt:
      gameState.currentSong?.publicTheme ||
      "Catchy short party-pop with sung vocals and clear hooks.",
    revealLines: getRevealLines(),
    durationSec: DEFAULT_ROUND_SONG_DURATION_SEC,
    generatedSong: gameState.generatedSong
  });

  if (gameState.roundId !== activeRoundId || gameState.phase !== "ai_song_generating") {
    return;
  }

  gameState.generatedSong = generatedSong;
  broadcastState(io);
  beginLyricReveal(io);
}

function finishWriting(io, reason) {
  if (gameState.phase !== "writing") {
    return;
  }

  clearPhaseTimer();
  clearAllStepTimers();

  if (reason === "global_timeout") {
    for (const unitState of getOrderedUnitStates()) {
      if (!unitState.completed) {
        fillRemainingUnitWithDefaults(unitState, "timeout");
      }
    }
  }

  gameState.phase = "times_up";
  gameState.phaseDeadlineAt = Date.now() + TIMES_UP_DURATION_MS;
  gameState.revealStartedAt = null;
  phaseTimer = setTimeout(() => {
    beginAiSongGenerating(io).catch((error) => {
      console.error("AI song generation orchestration failed:", error);

      if (gameState.phase === "times_up") {
        gameState.generatedSong = {
          ...buildInitialGeneratedSongState(getRevealLines().map((line) => line.text)),
          status: "error",
          errorMessage: error.message || "AI generation failed."
        };
        beginLyricReveal(io);
      }
    });
  }, TIMES_UP_DURATION_MS);

  broadcastState(io);
}

function startStepForUnit(io, unitState, shouldBroadcast = true) {
  if (
    gameState.phase !== "writing" ||
    !unitState ||
    unitState.completed ||
    !unitState.assignedPlayerId
  ) {
    return;
  }

  const stepDefinition = getCurrentStepDefinition(unitState);

  if (!stepDefinition) {
    completeUnit(unitState);

    if (shouldBroadcast) {
      broadcastState(io);
    }

    return;
  }

  prepareStep(unitState, stepDefinition);

  const now = Date.now();
  const nextStepDeadline = now + STEP_DURATION_MS;
  const cappedDeadline = gameState.phaseDeadlineAt
    ? Math.min(nextStepDeadline, gameState.phaseDeadlineAt)
    : nextStepDeadline;
  const timeoutMs = Math.max(0, cappedDeadline - now);

  unitState.deadlineAt = cappedDeadline;
  clearStepTimer(unitState.unitId);

  if (timeoutMs === 0) {
    applyDefaultForCurrentStep(io, unitState.unitId, "timeout");
    return;
  }

  const scheduledStepId = stepDefinition.id;
  const timer = setTimeout(() => {
    const latestUnitState = gameState.unitStates[unitState.unitId];

    if (!latestUnitState || gameState.phase !== "writing" || latestUnitState.completed) {
      return;
    }

    const activeStep = getCurrentStepDefinition(latestUnitState);

    if (!activeStep || activeStep.id !== scheduledStepId) {
      return;
    }

    applyDefaultForCurrentStep(io, latestUnitState.unitId, "timeout");
  }, timeoutMs);

  stepTimers.set(unitState.unitId, timer);

  if (shouldBroadcast) {
    broadcastState(io);
  }
}

function saveResponseForCurrentStep(io, unitState, responseText, options = {}) {
  const stepDefinition = getCurrentStepDefinition(unitState);

  if (!stepDefinition) {
    return;
  }

  const stepMeta = prepareStep(unitState, stepDefinition);
  const sanitizedResponse =
    sanitizeResponse(responseText, stepDefinition) || stepMeta.defaultResponse;

  unitState.responsesByStepId[stepDefinition.id] = sanitizedResponse;
  unitState.stepMetaById[stepDefinition.id] = {
    ...stepMeta,
    usedDefault: Boolean(options.usedDefault),
    fallbackReason: options.fallbackReason || null
  };
  unitState.deadlineAt = null;

  clearStepTimer(unitState.unitId);

  if (unitState.currentStepIndex >= unitState.steps.length - 1) {
    unitState.currentStepIndex = unitState.steps.length;
    completeUnit(unitState);

    if (allUnitsComplete()) {
      finishWriting(io, "complete");
      return;
    }

    broadcastState(io);
    return;
  }

  unitState.currentStepIndex += 1;
  startStepForUnit(io, unitState);
}

function applyDefaultForCurrentStep(io, unitId, reason) {
  const unitState = gameState.unitStates[unitId];

  if (!unitState || unitState.completed) {
    return;
  }

  const stepDefinition = getCurrentStepDefinition(unitState);

  if (!stepDefinition) {
    return;
  }

  const stepMeta = prepareStep(unitState, stepDefinition);

  saveResponseForCurrentStep(io, unitState, stepMeta.defaultResponse, {
    usedDefault: true,
    fallbackReason: reason
  });
}

function initializeRoundState() {
  const alivePlayers = getAlivePlayers();

  if (alivePlayers.length < 2) {
    return false;
  }

  const currentSong = pickRandom(songLibrary.songs);
  const promptUnits = getOrderedPromptUnits(currentSong);
  const assignedPlayers = alivePlayers.slice(0, promptUnits.length);

  if (assignedPlayers.length < 2 || promptUnits.length === 0) {
    return false;
  }

  const imposter = pickRandom(assignedPlayers);
  const nextRoundNumber = gameState.roundNumber + 1;

  gameState.roundNumber = nextRoundNumber;
  gameState.roundId = `round-${nextRoundNumber}-${Date.now().toString(36)}`;
  gameState.currentSong = currentSong;
  gameState.imposterPlayerId = imposter.playerId;
  gameState.imposterDisplayName = getDisplayName(imposter);
  gameState.playerAssignments = {};
  gameState.unitStates = {};
  gameState.votes = {};
  gameState.roundOutcome = null;
  gameState.currentRevealLineIndex = 0;
  gameState.revealStartedAt = null;
  gameState.generatedSong = buildInitialGeneratedSongState();

  for (let index = 0; index < promptUnits.length; index += 1) {
    const promptUnit = promptUnits[index];
    const assignedPlayer = assignedPlayers[index] || null;
    const role =
      assignedPlayer && assignedPlayer.playerId === imposter.playerId
        ? "imposter"
        : "lyricist";

    gameState.unitStates[promptUnit.id] = {
      unitId: promptUnit.id,
      order: promptUnit.order,
      section: promptUnit.section,
      outputTemplate: promptUnit.outputTemplate,
      steps: [...promptUnit.steps].sort((a, b) => a.order - b.order),
      assignedPlayerId: assignedPlayer?.playerId || null,
      assignedPlayerName: assignedPlayer ? getDisplayName(assignedPlayer) : "Auto fill",
      role: assignedPlayer ? role : "lyricist",
      currentStepIndex: 0,
      completed: false,
      finalLine: null,
      deadlineAt: null,
      responsesByStepId: {},
      bindingsByStepId: {},
      stepMetaById: {}
    };

    if (assignedPlayer) {
      gameState.playerAssignments[assignedPlayer.playerId] = promptUnit.id;
    }
  }

  for (const unitState of getOrderedUnitStates()) {
    if (!unitState.assignedPlayerId) {
      fillRemainingUnitWithDefaults(unitState, "unassigned_unit");
    }
  }

  return true;
}

function beginWriting(io) {
  clearPhaseTimer();

  if (gameState.phase !== "round_intro") {
    return;
  }

  gameState.phase = "writing";
  gameState.phaseDeadlineAt = Date.now() + WRITING_DURATION_MS;

  phaseTimer = setTimeout(() => finishWriting(io, "global_timeout"), WRITING_DURATION_MS);

  for (const unitState of getOrderedUnitStates()) {
    if (unitState.assignedPlayerId && !unitState.completed) {
      startStepForUnit(io, unitState, false);
    }
  }

  if (allUnitsComplete()) {
    finishWriting(io, "complete");
    return;
  }

  broadcastState(io);
}

function beginTutorial(io) {
  clearPhaseTimer();
  clearRevealTimer();
  clearVoteTimer();
  clearAllStepTimers();

  gameState.phase = "tutorial";
  gameState.phaseDeadlineAt = Date.now() + TUTORIAL_DURATION_MS;
  gameState.roundId = null;
  gameState.roundNumber = 0;
  gameState.currentSong = null;
  gameState.imposterPlayerId = null;
  gameState.imposterDisplayName = "";
  gameState.playerAssignments = {};
  gameState.unitStates = {};
  gameState.votes = {};
  gameState.roundOutcome = null;
  gameState.winner = null;
  gameState.currentRevealLineIndex = 0;
  gameState.revealStartedAt = null;
  gameState.generatedSong = buildInitialGeneratedSongState();

  phaseTimer = setTimeout(() => beginRoundIntro(io), TUTORIAL_DURATION_MS);
  broadcastState(io);
}

function startSamePlayersSession(io) {
  clearAllGameTimers();

  for (const player of players.values()) {
    if (player.registered) {
      player.alive = true;
    }
  }

  resetGameState();

  if (getRegisteredPlayers().length < 2) {
    broadcastState(io);
    return;
  }

  if (!getMasterPlayer()) {
    const fallbackMaster = getRegisteredPlayers()[0] || null;

    if (fallbackMaster) {
      assignMasterToPlayer(fallbackMaster);
    }
  }

  beginTutorial(io);
}

function restartWithNewPlayers(io) {
  clearAllGameTimers();
  resetGameState();

  for (const player of players.values()) {
    player.name = "";
    player.registered = false;
    player.alive = true;
    player.connectionRole = "slave";
  }

  masterSocketId = null;
  broadcastState(io);
}

function handleParticipantDeparture(io, departingPlayer, disconnectedSocketId) {
  const assignedUnitId = gameState.playerAssignments[departingPlayer.playerId] || null;
  const assignedUnitState = assignedUnitId
    ? gameState.unitStates[assignedUnitId] || null
    : null;

  delete gameState.votes[departingPlayer.playerId];
  delete gameState.playerAssignments[departingPlayer.playerId];

  if (assignedUnitState) {
    assignedUnitState.assignedPlayerId = null;
    clearStepTimer(assignedUnitState.unitId);
  }

  players.delete(departingPlayer.playerId);

  if (disconnectedSocketId === masterSocketId) {
    masterSocketId = null;
    assignFallbackMasterInLobbyOrGameOver();
  }

  if (players.size === 0) {
    masterSocketId = null;
    resetGameState();
    broadcastState(io);
    return;
  }

  if (
    (gameState.phase === "tutorial" || gameState.phase === "round_intro") &&
    getRegisteredPlayers().length < 2
  ) {
    resetGameState();
    broadcastState(io);
    return;
  }

  if (gameState.phase === "lobby" || gameState.phase === "game_over") {
    broadcastState(io);
    return;
  }

  if (departingPlayer.playerId === gameState.imposterPlayerId) {
    gameState.winner = "lyricists";
    beginGameOver(io);
    return;
  }

  if (gameState.phase === "writing" && assignedUnitState && !assignedUnitState.completed) {
    fillRemainingUnitWithDefaults(assignedUnitState, "missing_assigned_player");
  }

  const alivePlayers = getAlivePlayers();
  const imposterStillAlive = alivePlayers.some(
    (player) => player.playerId === gameState.imposterPlayerId
  );

  if (alivePlayers.length < 2) {
    gameState.winner = imposterStillAlive ? "imposter" : "lyricists";
    beginGameOver(io);
    return;
  }

  if (gameState.phase === "writing" && allUnitsComplete()) {
    finishWriting(io, "complete");
    return;
  }

  if (gameState.phase === "voting" && haveAllAliveVoted()) {
    resolveVoting(io);
    return;
  }

  broadcastState(io);
}

const app = next({ dev, hostname: host, port });
const handle = app.getRequestHandler();

app
  .prepare()
  .then(() => {
    const server = http.createServer((req, res) => {
      if (serveGeneratedAudioRequest(req, res)) {
        return;
      }

      handle(req, res);
    });
    const io = new Server(server, {
      path: "/game-socket"
    });

    io.on("connection", (socket) => {
      const clientType =
        socket.handshake.auth?.clientType === "display" ? "display" : "participant";

      socket.data.clientType = clientType;

      if (clientType === "display") {
        displaySocketIds.add(socket.id);
        broadcastState(io);

        socket.on("restart_same_players", () => {
          if (gameState.phase !== "game_over") {
            return;
          }

          startSamePlayersSession(io);
        });

        socket.on("restart_new_players", () => {
          if (gameState.phase !== "game_over") {
            return;
          }

          restartWithNewPlayers(io);
        });

        socket.on("disconnect", () => {
          displaySocketIds.delete(socket.id);
          broadcastState(io);
        });

        return;
      }

      const rawPlayerId =
        typeof socket.handshake.auth?.playerId === "string"
          ? socket.handshake.auth.playerId.trim()
          : "";

      let playerId = rawPlayerId || `player-${Math.random().toString(36).slice(2, 10)}`;

      while (players.has(playerId)) {
        playerId = `player-${Math.random().toString(36).slice(2, 10)}`;
      }

      const connectionRole = masterSocketId ? "slave" : "master";

      if (connectionRole === "master") {
        masterSocketId = socket.id;
      }

      const player = {
        playerId,
        name: "",
        registered: false,
        connectionRole,
        alive: gameState.phase === "lobby",
        socketId: socket.id,
        joinOrder: nextJoinOrder++
      };

      players.set(playerId, player);
      socket.data.playerId = playerId;

      socket.emit("role", { role: connectionRole, playerId, clientType });
      broadcastState(io);

      socket.on("set_name", (name) => {
        const currentPlayer = getPlayerFromSocket(socket);

        if (!currentPlayer || typeof name !== "string") {
          return;
        }

        const trimmedName = name.trim();

        if (!trimmedName) {
          return;
        }

        currentPlayer.name = trimmedName;

        if (!currentPlayer.registered) {
          currentPlayer.registered = true;
          currentPlayer.alive = gameState.phase === "lobby" || gameState.phase === "game_over";
        }

        if (!masterSocketId) {
          assignMasterToPlayer(currentPlayer);
        }

        if (currentPlayer.playerId === gameState.imposterPlayerId) {
          gameState.imposterDisplayName = trimmedName;
        }

        const assignedUnitId = gameState.playerAssignments[currentPlayer.playerId];
        const assignedUnitState = assignedUnitId
          ? gameState.unitStates[assignedUnitId] || null
          : null;

        if (assignedUnitState) {
          assignedUnitState.assignedPlayerName = trimmedName;
        }

        broadcastState(io);
      });

      socket.on("start_game", () => {
        const currentPlayer = getPlayerFromSocket(socket);

        if (
          !currentPlayer ||
          !currentPlayer.registered ||
          currentPlayer.connectionRole !== "master" ||
          gameState.phase !== "lobby" ||
          getRegisteredPlayers().length < 2
        ) {
          return;
        }

        for (const playerEntry of players.values()) {
          if (playerEntry.registered) {
            playerEntry.alive = true;
          }
        }

        resetGameState();
        beginTutorial(io);
      });

      socket.on("skip_tutorial", () => {
        const currentPlayer = getPlayerFromSocket(socket);

        if (
          !currentPlayer ||
          currentPlayer.connectionRole !== "master" ||
          gameState.phase !== "tutorial"
        ) {
          return;
        }

        beginRoundIntro(io);
      });

      socket.on("submit_lyric", (line) => {
        const currentPlayer = getPlayerFromSocket(socket);

        if (
          !currentPlayer ||
          !currentPlayer.registered ||
          gameState.phase !== "writing" ||
          !currentPlayer.alive ||
          typeof line !== "string"
        ) {
          return;
        }

        const assignedUnitId = gameState.playerAssignments[currentPlayer.playerId];
        const unitState = assignedUnitId
          ? gameState.unitStates[assignedUnitId] || null
          : null;

        if (!unitState || unitState.completed) {
          return;
        }

        const stepDefinition = getCurrentStepDefinition(unitState);

        if (
          !stepDefinition ||
          typeof unitState.responsesByStepId[stepDefinition.id] === "string"
        ) {
          return;
        }

        const sanitizedLine = sanitizeResponse(line, stepDefinition);

        if (!sanitizedLine) {
          return;
        }

        saveResponseForCurrentStep(io, unitState, sanitizedLine, {
          usedDefault: false,
          fallbackReason: null
        });
      });

      socket.on("skip_step", () => {
        const currentPlayer = getPlayerFromSocket(socket);

        if (
          !currentPlayer ||
          !currentPlayer.registered ||
          gameState.phase !== "writing" ||
          !currentPlayer.alive
        ) {
          return;
        }

        const assignedUnitId = gameState.playerAssignments[currentPlayer.playerId];
        const unitState = assignedUnitId
          ? gameState.unitStates[assignedUnitId] || null
          : null;

        if (!unitState || unitState.completed) {
          return;
        }

        applyDefaultForCurrentStep(io, unitState.unitId, "skip");
      });

      socket.on("cast_vote", (targetPlayerId) => {
        const currentPlayer = getPlayerFromSocket(socket);

        if (
          !currentPlayer ||
          !currentPlayer.registered ||
          gameState.phase !== "voting" ||
          !currentPlayer.alive ||
          typeof gameState.votes[currentPlayer.playerId] === "string" ||
          typeof targetPlayerId !== "string"
        ) {
          return;
        }

        const targetPlayer = players.get(targetPlayerId);

        if (
          !targetPlayer ||
          !targetPlayer.registered ||
          !targetPlayer.alive ||
          !isPlayerAssignedThisRound(targetPlayerId)
        ) {
          return;
        }

        gameState.votes[currentPlayer.playerId] = targetPlayerId;

        if (haveAllAliveVoted()) {
          resolveVoting(io);
          return;
        }

        broadcastState(io);
      });

      socket.on("disconnect", () => {
        const departingPlayer = getPlayerFromSocket(socket);

        if (!departingPlayer) {
          return;
        }

        handleParticipantDeparture(io, departingPlayer, socket.id);
      });
    });

    server.listen(port, host, () => {
      console.log(`Server running at http://localhost:${port}/game`);
    });
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

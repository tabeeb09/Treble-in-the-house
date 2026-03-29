"use client";

import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";

const PLAYER_ID_KEY = "lan-lyric-party-player-id";

const pageStyle = {
  minHeight: "100vh",
  padding: "24px 16px"
};

const panelStyle = {
  maxWidth: "760px",
  margin: "0 auto",
  padding: "16px",
  backgroundColor: "#fff",
  border: "1px solid #ddd",
  borderRadius: "8px"
};

const sectionStyle = {
  marginTop: "20px",
  paddingTop: "16px",
  borderTop: "1px solid #eee"
};

const statusStyle = {
  display: "grid",
  gap: "6px",
  fontSize: "14px"
};

const inputStyle = {
  width: "100%",
  padding: "10px",
  fontSize: "16px",
  boxSizing: "border-box",
  marginTop: "8px"
};

const buttonStyle = {
  padding: "10px 16px",
  fontSize: "16px",
  cursor: "pointer",
  marginTop: "12px",
  marginRight: "8px"
};

const listStyle = {
  display: "grid",
  gap: "8px",
  marginTop: "12px"
};

const itemStyle = {
  padding: "10px",
  backgroundColor: "#f3f3f3",
  borderRadius: "6px"
};

const subtleTextStyle = {
  color: "#555",
  fontSize: "14px"
};

function createPlayerId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `player-${Math.random().toString(36).slice(2, 10)}`;
}

function getPhaseLabel(phase) {
  switch (phase) {
    case "lobby":
      return "Lobby";
    case "tutorial":
      return "Tutorial";
    case "round_intro":
      return "Round Intro";
    case "writing":
      return "Writing";
    case "times_up":
      return "Time's Up";
    case "ai_song_generating":
      return "Generating Song";
    case "lyric_reveal":
      return "Lyric Reveal";
    case "voting":
      return "Voting";
    case "round_result":
      return "Round Result";
    case "game_over":
      return "Game Over";
    default:
      return "Waiting";
  }
}

function renderWinnerLabel(winner) {
  if (winner === "lyricists") {
    return "Lyricists win";
  }

  if (winner === "imposter") {
    return "Lyricists lose";
  }

  return "No winner yet";
}

export default function GamePage() {
  const socketRef = useRef(null);
  const [playerId, setPlayerId] = useState(null);
  const [connected, setConnected] = useState(false);
  const [snapshot, setSnapshot] = useState(null);
  const [nameDraft, setNameDraft] = useState("");
  const [lyricDraft, setLyricDraft] = useState("");
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const storedPlayerId = window.localStorage.getItem(PLAYER_ID_KEY);
    const nextPlayerId = storedPlayerId || createPlayerId();

    window.localStorage.setItem(PLAYER_ID_KEY, nextPlayerId);
    setPlayerId(nextPlayerId);
  }, []);

  useEffect(() => {
    if (!playerId) {
      return undefined;
    }

    const socket = io({
      path: "/game-socket",
      auth: { playerId, clientType: "participant" },
      reconnection: false
    });

    socketRef.current = socket;
    setConnected(socket.connected);

    socket.on("connect", () => {
      setConnected(true);
    });

    socket.on("disconnect", () => {
      setConnected(false);
    });

    socket.on("role", (payload) => {
      if (payload?.playerId) {
        window.localStorage.setItem(PLAYER_ID_KEY, payload.playerId);
      }
    });

    socket.on("state", (nextSnapshot) => {
      setSnapshot(nextSnapshot);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [playerId]);

  useEffect(() => {
    if (snapshot?.self) {
      setNameDraft(snapshot.self.name || "");
    }
  }, [snapshot?.self]);

  const self = snapshot?.self || null;
  const players = snapshot?.players || [];
  const game = snapshot?.game || {
    phase: "lobby",
    phaseDeadlineAt: null,
    roundNumber: 0,
    songTitle: null,
    publicTheme: null,
    localIpAddress: null,
    localGameUrl: null,
    totalPlayers: 0,
    totalAlivePlayers: 0,
    totalPromptUnits: 0,
    completedUnitCount: 0,
    voteCount: 0,
    currentRevealLineIndex: 0,
    voteTargets: [],
    revealLines: [],
    generatedSong: {
      status: "idle",
      audioUrl: null,
      mimeType: null,
      lyricsLines: [],
      lineTimings: [],
      wordTimings: [],
      errorMessage: null
    },
    roundOutcome: null,
    winner: null,
    imposterName: null,
    masterPlayerName: null
  };

  const currentUnit = self?.currentUnit || null;
  const currentStep = currentUnit?.currentStep || null;
  const stepToken = currentStep
    ? `${currentUnit.unitId}:${currentStep.stepId}:${currentStep.order}`
    : "none";
  const activeDeadline =
    game.phase === "writing"
      ? currentStep?.deadlineAt || game.phaseDeadlineAt
      : game.phaseDeadlineAt;

  useEffect(() => {
    if (game.phase !== "writing") {
      setLyricDraft("");
      return;
    }

    if (!currentStep || currentUnit?.completed) {
      setLyricDraft("");
    }
  }, [game.phase, stepToken, currentUnit?.completed]);

  useEffect(() => {
    if (!activeDeadline) {
      return undefined;
    }

    const interval = setInterval(() => {
      setNow(Date.now());
    }, 500);

    return () => clearInterval(interval);
  }, [activeDeadline]);

  const secondsLeft = activeDeadline
    ? Math.max(0, Math.ceil((activeDeadline - now) / 1000))
    : 0;

  const isMaster = self?.connectionRole === "master";
  const canStartGame =
    isMaster && self?.registered && game.phase === "lobby" && game.totalPlayers >= 2;
  const canSkipTutorial = isMaster && game.phase === "tutorial";

  function emit(eventName, payload) {
    if (!socketRef.current) {
      return;
    }

    socketRef.current.emit(eventName, payload);
  }

  function handleNameSubmit(event) {
    event.preventDefault();

    if (!nameDraft.trim()) {
      return;
    }

    emit("set_name", nameDraft);
  }

  function handleLyricSubmit(event) {
    event.preventDefault();

    if (!self?.alive || !currentStep || !lyricDraft.trim()) {
      return;
    }

    emit("submit_lyric", lyricDraft);
  }

  return (
    <main style={pageStyle}>
      <section style={panelStyle}>
        <h1 style={{ marginTop: 0 }}>LAN Lyric Imposter</h1>

        <div style={statusStyle}>
          <div>Status: {connected ? "Connected" : "Disconnected"}</div>
          <div>Connection role: {self ? self.connectionRole : "Waiting"}</div>
          <div>Phase: {getPhaseLabel(game.phase)}</div>
          <div>Round: {game.roundNumber || 0}</div>
          <div>
            You:{" "}
            {self
              ? self.registered
                ? `${self.displayName} (${self.alive ? "alive" : "dead"})`
                : "Join the roster"
              : "Waiting"}
          </div>
          {game.songTitle && <div>Song: {game.songTitle}</div>}
          {isMaster && game.localIpAddress && (
            <>
              <div>Backend LAN IP: {game.localIpAddress}</div>
              <div>Phone join URL: {game.localGameUrl}</div>
            </>
          )}
        </div>

        {!self?.registered && (
          <div style={sectionStyle}>
            <h2 style={{ marginTop: 0, fontSize: "20px" }}>Join Game</h2>
            <form onSubmit={handleNameSubmit}>
              <input
                type="text"
                value={nameDraft}
                onChange={(event) => setNameDraft(event.target.value)}
                placeholder="Enter a display name"
                style={inputStyle}
              />
              <button type="submit" style={buttonStyle}>
                Save Name
              </button>
            </form>
          </div>
        )}

        <div style={sectionStyle}>
          <h2 style={{ marginTop: 0, fontSize: "20px" }}>Players</h2>
          {game.masterPlayerName && (
            <p style={subtleTextStyle}>Master: {game.masterPlayerName}</p>
          )}
          <div style={listStyle}>
            {players.map((player) => (
              <div key={player.playerId} style={itemStyle}>
                <strong>{player.name}</strong>
                {player.playerId === self?.playerId ? " (You)" : ""}
                <div style={subtleTextStyle}>
                  {player.alive ? "Alive" : "Dead"} | {player.connectionRole}
                  {game.phase !== "lobby"
                    ? ` | ${player.isAssignedThisRound ? "Assigned" : "Audience"}`
                    : ""}
                </div>
              </div>
            ))}
          </div>
          {players.length === 0 && (
            <p style={{ marginBottom: 0 }}>No named players have joined yet.</p>
          )}
        </div>

        {game.songTitle && (
          <div style={sectionStyle}>
            <h2 style={{ marginTop: 0, fontSize: "20px" }}>Current Song</h2>
            <p>
              <strong>{game.songTitle}</strong>
            </p>
            {game.publicTheme && <p>{game.publicTheme}</p>}
            {self?.roleTheme && (
              <p>
                <strong>Your theme:</strong> {self.roleTheme}
              </p>
            )}
          </div>
        )}

        {game.phase === "lobby" && (
          <div style={sectionStyle}>
            <h2 style={{ marginTop: 0, fontSize: "20px" }}>Lobby</h2>
            <p>Join on your phones, then wait for the master to start the game.</p>
            {isMaster && (
              <button
                type="button"
                onClick={() => emit("start_game")}
                disabled={!canStartGame}
                style={buttonStyle}
              >
                Start Game
              </button>
            )}
          </div>
        )}

        {game.phase === "tutorial" && (
          <div style={sectionStyle}>
            <h2 style={{ marginTop: 0, fontSize: "20px" }}>How To Play</h2>
            <p>One player is the imposter.</p>
            <p>Write lyric lines on your phone.</p>
            <p>Then vote for the imposter.</p>
            <p style={subtleTextStyle}>Continuing in {secondsLeft}s</p>
            {canSkipTutorial && (
              <button
                type="button"
                onClick={() => emit("skip_tutorial")}
                style={buttonStyle}
              >
                Skip Tutorial
              </button>
            )}
          </div>
        )}

        {game.phase === "round_intro" && (
          <div style={sectionStyle}>
            <h2 style={{ marginTop: 0, fontSize: "20px" }}>Round {game.roundNumber}</h2>
            <p>The next round is starting.</p>
            <p style={subtleTextStyle}>Beginning in {secondsLeft}s</p>
          </div>
        )}

        {game.phase === "writing" && (
          <div style={sectionStyle}>
            <h2 style={{ marginTop: 0, fontSize: "20px" }}>Writing Phase</h2>
            <p style={subtleTextStyle}>
              Units complete: {game.completedUnitCount} / {game.totalPromptUnits}
            </p>

            {!self?.registered && (
              <p style={{ marginBottom: 0 }}>
                Join the roster to be included in a future game.
              </p>
            )}

            {self?.registered && !self.alive && (
              <p style={{ marginBottom: 0 }}>
                You are eliminated and waiting for the round to finish.
              </p>
            )}

            {self?.registered && self.alive && !self.isAssignedThisRound && (
              <p style={{ marginBottom: 0 }}>
                You are audience this round. Wait for the reveal, then vote.
              </p>
            )}

            {self?.registered && self.alive && self.isAssignedThisRound && currentStep && (
              <>
                <p>
                  Step {currentUnit.completedStepCount + 1} of {currentUnit.totalSteps}
                </p>
                {currentStep.sharedText && (
                  <p>
                    <strong>Shared lyric:</strong> {currentStep.sharedText}
                  </p>
                )}
                <p>
                  <strong>Prompt:</strong> {currentStep.promptText}
                </p>
                <p>
                  Time left: <strong>{secondsLeft}s</strong>
                </p>
                {currentStep.constraints && (
                  <p style={subtleTextStyle}>
                    Limit:
                    {typeof currentStep.constraints.maxWords === "number"
                      ? ` ${currentStep.constraints.maxWords} words`
                      : ""}
                    {typeof currentStep.constraints.maxChars === "number"
                      ? `, ${currentStep.constraints.maxChars} chars`
                      : ""}
                  </p>
                )}
                <form onSubmit={handleLyricSubmit}>
                  <input
                    type="text"
                    value={lyricDraft}
                    onChange={(event) => setLyricDraft(event.target.value)}
                    placeholder="Write one short line"
                    style={inputStyle}
                    maxLength={currentStep.constraints?.maxChars || undefined}
                  />
                  <button type="submit" style={buttonStyle}>
                    Submit
                  </button>
                  <button
                    type="button"
                    onClick={() => emit("skip_step")}
                    style={buttonStyle}
                  >
                    Skip
                  </button>
                </form>
              </>
            )}

            {self?.registered &&
              self.alive &&
              self.isAssignedThisRound &&
              currentUnit?.completed &&
              !currentStep && (
                <p style={{ marginBottom: 0 }}>
                  Your prompt unit is complete. Waiting for everyone else.
                </p>
              )}
          </div>
        )}

        {game.phase === "times_up" && (
          <div style={sectionStyle}>
            <h2 style={{ marginTop: 0, fontSize: "20px" }}>Time's Up</h2>
            <p>Hands off. The lyrics are locking in.</p>
            <p style={subtleTextStyle}>Continuing in {secondsLeft}s</p>
          </div>
        )}

        {game.phase === "ai_song_generating" && (
          <div style={sectionStyle}>
            <h2 style={{ marginTop: 0, fontSize: "20px" }}>Generating Song</h2>
            <p>The server is building the round song and syncing the lyrics.</p>
            {game.generatedSong?.errorMessage && (
              <p style={subtleTextStyle}>{game.generatedSong.errorMessage}</p>
            )}
          </div>
        )}

        {(game.phase === "lyric_reveal" ||
          game.phase === "voting" ||
          game.phase === "round_result" ||
          game.phase === "game_over") && (
          <div style={sectionStyle}>
            <h2 style={{ marginTop: 0, fontSize: "20px" }}>Song Reveal</h2>
            {game.generatedSong?.status === "error" && (
              <p style={subtleTextStyle}>
                Audio generation failed, so this round is using a text-only reveal.
              </p>
            )}
            <div style={listStyle}>
              {game.revealLines.map((line, index) => (
                <div
                  key={line.unitId}
                  style={{
                    ...itemStyle,
                    border:
                      game.phase === "lyric_reveal" &&
                      index === game.currentRevealLineIndex
                        ? "2px solid #111"
                        : "1px solid transparent"
                  }}
                >
                  <div style={subtleTextStyle}>{line.section}</div>
                  <strong>{line.ownerLabel}:</strong> {line.text}
                </div>
              ))}
            </div>
          </div>
        )}

        {game.phase === "voting" && (
          <div style={sectionStyle}>
            <h2 style={{ marginTop: 0, fontSize: "20px" }}>Voting Phase</h2>
            <p>
              Vote for the player you think is the imposter. Time left:{" "}
              <strong>{secondsLeft}s</strong>
            </p>
            {self?.registered && self.alive ? (
              <>
                <div style={listStyle}>
                  {game.voteTargets.map((player) => (
                    <button
                      key={player.playerId}
                      type="button"
                      onClick={() => emit("cast_vote", player.playerId)}
                      disabled={self.hasVoted}
                      style={buttonStyle}
                    >
                      Vote for {player.name}
                    </button>
                  ))}
                </div>
                <p style={subtleTextStyle}>
                  {self.hasVoted ? "Your vote is locked in." : "You can vote once."}
                </p>
              </>
            ) : (
              <p style={{ marginBottom: 0 }}>
                You are not voting in this round.
              </p>
            )}
            <p style={subtleTextStyle}>
              Votes received: {game.voteCount} / {game.totalAlivePlayers}
            </p>
          </div>
        )}

        {game.phase === "round_result" && (
          <div style={sectionStyle}>
            <h2 style={{ marginTop: 0, fontSize: "20px" }}>Round Result</h2>
            <p>
              {game.roundOutcome?.wasCorrect
                ? `${game.roundOutcome?.votedPlayerName} was the imposter.`
                : `${game.roundOutcome?.votedPlayerName} was voted out.`}
            </p>
            {!game.roundOutcome?.wasCorrect && (
              <p>{game.roundOutcome?.votedPlayerName} was not the imposter.</p>
            )}
            <p style={subtleTextStyle}>Continuing in {secondsLeft}s</p>
          </div>
        )}

        {game.phase === "game_over" && (
          <div style={sectionStyle}>
            <h2 style={{ marginTop: 0, fontSize: "20px" }}>Game Over</h2>
            <p>{renderWinnerLabel(game.winner)}</p>
            <p>Final imposter: {game.imposterName}</p>
            <p>Use the shared display to restart the session.</p>
          </div>
        )}
      </section>
    </main>
  );
}

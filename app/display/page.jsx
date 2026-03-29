"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import JoinQrCard from "../../components/JoinQrCard";

const pageStyle = {
  minHeight: "100vh",
  padding: "24px 16px"
};

const panelStyle = {
  maxWidth: "900px",
  margin: "0 auto",
  padding: "20px",
  backgroundColor: "#fff",
  border: "1px solid #ddd",
  borderRadius: "8px"
};

const listStyle = {
  display: "grid",
  gap: "10px",
  marginTop: "16px"
};

const itemStyle = {
  padding: "12px",
  backgroundColor: "#f3f3f3",
  borderRadius: "6px"
};

const buttonStyle = {
  padding: "12px 18px",
  fontSize: "16px",
  cursor: "pointer",
  marginTop: "12px",
  marginRight: "8px"
};

const lyricViewportStyle = {
  position: "relative",
  height: "320px",
  overflow: "hidden",
  marginTop: "20px",
  border: "1px solid #ddd",
  borderRadius: "8px",
  backgroundColor: "#f8f8f8"
};

function renderWinnerLabel(winner) {
  if (winner === "lyricists") {
    return "Lyricists win";
  }

  if (winner === "imposter") {
    return "Lyricists lose";
  }

  return "Game over";
}

function getCurrentLineIndexFromPlayback(lineTimings, playbackMs) {
  if (!Array.isArray(lineTimings) || lineTimings.length === 0) {
    return 0;
  }

  for (let index = 0; index < lineTimings.length; index += 1) {
    const line = lineTimings[index];

    if (playbackMs >= line.startMs && playbackMs < line.endMs) {
      return index;
    }
  }

  if (playbackMs < lineTimings[0].startMs) {
    return 0;
  }

  for (let index = lineTimings.length - 1; index >= 0; index -= 1) {
    if (playbackMs >= lineTimings[index].startMs) {
      return index;
    }
  }

  return 0;
}

export default function DisplayPage() {
  const socketRef = useRef(null);
  const audioRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const [snapshot, setSnapshot] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [playbackMs, setPlaybackMs] = useState(0);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);

  useEffect(() => {
    const socket = io({
      path: "/game-socket",
      auth: { clientType: "display" },
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

    socket.on("state", (nextSnapshot) => {
      setSnapshot(nextSnapshot);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  const players = snapshot?.players || [];
  const game = snapshot?.game || {
    phase: "lobby",
    phaseDeadlineAt: null,
    roundNumber: 0,
    songTitle: null,
    publicTheme: null,
    localGameUrl: null,
    totalPlayers: 0,
    totalAlivePlayers: 0,
    totalPromptUnits: 0,
    completedUnitCount: 0,
    currentRevealLineIndex: 0,
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

  useEffect(() => {
    if (!game.phaseDeadlineAt) {
      return undefined;
    }

    const interval = setInterval(() => {
      setNow(Date.now());
    }, 500);

    return () => clearInterval(interval);
  }, [game.phaseDeadlineAt]);

  useEffect(() => {
    const audioElement = audioRef.current;

    if (!audioElement) {
      return undefined;
    }

    const handleTimeUpdate = () => {
      setPlaybackMs(audioElement.currentTime * 1000);
    };

    const handleEnded = () => {
      setPlaybackMs(audioElement.duration * 1000 || 0);
    };

    audioElement.addEventListener("timeupdate", handleTimeUpdate);
    audioElement.addEventListener("ended", handleEnded);

    return () => {
      audioElement.removeEventListener("timeupdate", handleTimeUpdate);
      audioElement.removeEventListener("ended", handleEnded);
    };
  }, []);

  useEffect(() => {
    const audioElement = audioRef.current;
    const audioUrl = game.generatedSong?.audioUrl || null;

    if (!audioElement) {
      return;
    }

    if (game.phase !== "lyric_reveal") {
      audioElement.pause();
      setPlaybackMs(0);
      setAutoplayBlocked(false);
      return;
    }

    if (!audioUrl) {
      setPlaybackMs(0);
      setAutoplayBlocked(false);
      return;
    }

    if (!audioElement.src || !audioElement.src.endsWith(audioUrl)) {
      audioElement.src = audioUrl;
      audioElement.load();
    }

    audioElement.currentTime = 0;
    setPlaybackMs(0);
    setAutoplayBlocked(false);

    const playPromise = audioElement.play();

    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch(() => {
        setAutoplayBlocked(true);
      });
    }
  }, [game.phase, game.generatedSong?.audioUrl, game.roundId]);

  const secondsLeft = game.phaseDeadlineAt
    ? Math.max(0, Math.ceil((game.phaseDeadlineAt - now) / 1000))
    : 0;
  const showJoinQr =
    Boolean(game.localGameUrl) &&
    (game.phase === "lobby" || game.phase === "tutorial" || game.phase === "round_intro");

  const lineTimings = game.generatedSong?.lineTimings || [];
  const visualLineIndex =
    game.phase === "lyric_reveal" && lineTimings.length > 0
      ? getCurrentLineIndexFromPlayback(lineTimings, playbackMs)
      : game.currentRevealLineIndex || 0;

  const visibleRevealLines = useMemo(
    () =>
      game.revealLines.map((line, index) => ({
        ...line,
        index,
        offset: index - visualLineIndex
      })),
    [game.revealLines, visualLineIndex]
  );

  function emit(eventName) {
    if (!socketRef.current) {
      return;
    }

    socketRef.current.emit(eventName);
  }

  function handleManualPlay() {
    const audioElement = audioRef.current;

    if (!audioElement) {
      return;
    }

    audioElement.play().then(() => {
      setAutoplayBlocked(false);
    }).catch(() => {
      setAutoplayBlocked(true);
    });
  }

  return (
    <main style={pageStyle}>
      <section style={panelStyle}>
        <h1 style={{ marginTop: 0 }}>LAN Lyric Imposter Display</h1>
        <p>Status: {connected ? "Connected" : "Disconnected"}</p>
        {game.localGameUrl && <p>Players join on phones: {game.localGameUrl}</p>}
        {showJoinQr && (
          <JoinQrCard
            url={game.localGameUrl}
            title="Scan to Join on Phones"
            helperText="Use this QR code to open the participant screen directly."
          />
        )}

        {game.phase === "lobby" && (
          <>
            <h2>Waiting for players</h2>
            <p>{game.masterPlayerName ? `Master: ${game.masterPlayerName}` : "No master yet"}</p>
            <p>Open `/game` on phones, enter names, and wait for the master to start.</p>
            <div style={listStyle}>
              {players.map((player) => (
                <div key={player.playerId} style={itemStyle}>
                  <strong>{player.name}</strong> {player.connectionRole === "master" ? "(Master)" : ""}
                </div>
              ))}
            </div>
            {players.length === 0 && <p>No players have joined yet.</p>}
          </>
        )}

        {game.phase === "tutorial" && (
          <>
            <h2>How to play</h2>
            <p>One player is the imposter.</p>
            <p>Write lyric lines on your phone.</p>
            <p>Then vote for the imposter.</p>
            <p>Starting in {secondsLeft}s</p>
          </>
        )}

        {game.phase === "round_intro" && (
          <>
            <h2>Round {game.roundNumber}</h2>
            {game.songTitle && <p>{game.songTitle}</p>}
            <p>Get ready.</p>
            <p>Starting in {secondsLeft}s</p>
          </>
        )}

        {game.phase === "writing" && (
          <>
            <h2>Write your lyrics now</h2>
            {game.songTitle && <p>{game.songTitle}</p>}
            {game.publicTheme && <p>{game.publicTheme}</p>}
            <p>
              Time left: <strong>{secondsLeft}s</strong>
            </p>
            <p>
              Completed units: {game.completedUnitCount} / {game.totalPromptUnits}
            </p>
          </>
        )}

        {game.phase === "times_up" && (
          <>
            <h2>Time&apos;s up</h2>
            <p>The lyrics are locking in.</p>
            <p>Continuing in {secondsLeft}s</p>
          </>
        )}

        {game.phase === "ai_song_generating" && (
          <>
            <h2>Generating song...</h2>
            <p>Please wait.</p>
            {game.generatedSong?.errorMessage && <p>{game.generatedSong.errorMessage}</p>}
          </>
        )}

        {game.phase === "lyric_reveal" && (
          <>
            <h2>Lyrics Reveal</h2>
            <audio
              ref={audioRef}
              preload="auto"
              controls
              style={{ width: "100%", marginTop: "12px" }}
            />
            {autoplayBlocked && game.generatedSong?.audioUrl && (
              <button
                type="button"
                onClick={handleManualPlay}
                style={buttonStyle}
              >
                Play Song
              </button>
            )}
            {game.generatedSong?.status === "error" && (
              <p>{game.generatedSong.errorMessage || "Audio generation failed for this round."}</p>
            )}
            {!game.generatedSong?.audioUrl && game.generatedSong?.status !== "error" && (
              <p>Audio is not available for this round, so the reveal is text-only.</p>
            )}

            <div style={lyricViewportStyle}>
              {visibleRevealLines.map((line) => {
                const distance = Math.abs(line.offset);
                const hidden = distance > 2;
                const scale = hidden ? 0.82 : Math.max(0.82, 1 - distance * 0.12);
                const opacity = hidden ? 0 : Math.max(0.2, 1 - distance * 0.28);
                const blur = hidden ? 6 : distance * 1.4;

                return (
                  <div
                    key={line.unitId}
                    style={{
                      position: "absolute",
                      left: "50%",
                      top: "50%",
                      width: "100%",
                      padding: "0 24px",
                      boxSizing: "border-box",
                      transform: `translate(-50%, calc(-50% + ${line.offset * 68}px)) scale(${scale})`,
                      opacity,
                      filter: `blur(${blur}px)`,
                      transition:
                        "transform 240ms ease, opacity 240ms ease, filter 240ms ease",
                      textAlign: "center",
                      fontWeight: line.offset === 0 ? 700 : 400,
                      fontSize: line.offset === 0 ? "32px" : "22px",
                      pointerEvents: "none"
                    }}
                  >
                    {line.text}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {game.phase === "voting" && (
          <>
            <h2>Who is the imposter?</h2>
            <p>Vote now.</p>
            <p>
              Time left: <strong>{secondsLeft}s</strong>
            </p>
          </>
        )}

        {game.phase === "round_result" && (
          <>
            <h2>Round Result</h2>
            {game.roundOutcome?.wasCorrect ? (
              <p>{game.roundOutcome?.votedPlayerName} was the imposter.</p>
            ) : (
              <>
                <p>{game.roundOutcome?.votedPlayerName} was voted out.</p>
                <p>{game.roundOutcome?.votedPlayerName} was not the imposter.</p>
              </>
            )}
            <p>Continuing in {secondsLeft}s</p>
          </>
        )}

        {game.phase === "game_over" && (
          <>
            <h2>{renderWinnerLabel(game.winner)}</h2>
            <p>Final imposter: {game.imposterName}</p>
            <button
              type="button"
              onClick={() => emit("restart_same_players")}
              style={buttonStyle}
            >
              Play again with same players
            </button>
            <button
              type="button"
              onClick={() => emit("restart_new_players")}
              style={buttonStyle}
            >
              Play again with new players
            </button>
          </>
        )}
      </section>
    </main>
  );
}

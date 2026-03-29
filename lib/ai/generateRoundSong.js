const fs = require("fs");
const path = require("path");

const { alignLyricsToAudio } = require("./alignmentProvider");
const { deriveLineTimings } = require("./lineSync");
const { generateSongFromLyrics } = require("./musicProvider");

function resolveGeneratedMetaDir() {
  return path.resolve(
    process.cwd(),
    process.env.GENERATED_META_DIR || "./data/generated-meta"
  );
}

function ensureDirectory(directoryPath) {
  fs.mkdirSync(directoryPath, { recursive: true });
}

function buildInitialGeneratedSongState(lyricsLines = []) {
  return {
    status: "idle",
    audioUrl: null,
    mimeType: null,
    lyricsLines,
    lineTimings: [],
    wordTimings: [],
    errorMessage: null,
    musicProvider: null,
    alignmentProvider: null,
    promptUsed: null,
    roundId: null
  };
}

async function writeRoundMetadata(roundId, metadata) {
  const metaDir = resolveGeneratedMetaDir();

  ensureDirectory(metaDir);
  fs.writeFileSync(
    path.join(metaDir, `${roundId}.json`),
    JSON.stringify(metadata, null, 2)
  );
}

async function generateRoundSongAssets(roundState) {
  const revealLines = Array.isArray(roundState.revealLines) ? roundState.revealLines : [];
  const lyricsLines = revealLines.map((line) => line.text);
  const roundId =
    roundState.roundId ||
    `round-${roundState.roundNumber || 0}-${Date.now().toString(36)}`;
  const durationSec = Math.max(30, Math.min(45, Number(roundState.durationSec || 35)));

  roundState.generatedSong = {
    ...buildInitialGeneratedSongState(lyricsLines),
    status: "generating",
    roundId
  };

  const metadata = {
    roundId,
    createdAt: new Date().toISOString(),
    title: roundState.title || null,
    stylePrompt: roundState.stylePrompt || null,
    finalLyricLines: lyricsLines,
    musicProvider: null,
    alignmentProvider: null,
    songPrompt: null,
    audioFilePath: null,
    audioUrl: null,
    mimeType: null,
    generatedLyricsText: null,
    wordTimings: [],
    lineTimings: [],
    errorMessage: null
  };

  try {
    const musicResult = await generateSongFromLyrics({
      roundId,
      title: roundState.title,
      stylePrompt: roundState.stylePrompt,
      lyricsLines: revealLines,
      durationSec
    });

    let alignmentResult = null;
    let lineTimings = [];
    let wordTimings = [];
    let alignmentWarning = null;

    try {
      alignmentResult = await alignLyricsToAudio({
        audioFilePath: musicResult.audioFilePath,
        transcriptText: lyricsLines.join("\n"),
        lyricsLines
      });
      lineTimings = alignmentResult.lines;
      wordTimings = alignmentResult.words;
    } catch (error) {
      alignmentWarning =
        `Alignment failed, so the app is using proportional line timing fallback. ${error.message}`;
      lineTimings = deriveLineTimings({
        lyricsLines,
        words: [],
        totalDurationMs: durationSec * 1000
      });
      wordTimings = [];
    }

    metadata.musicProvider = musicResult.provider;
    metadata.alignmentProvider = alignmentResult?.provider || "fallback";
    metadata.songPrompt = musicResult.promptUsed;
    metadata.audioFilePath = musicResult.audioFilePath;
    metadata.audioUrl = musicResult.audioUrl;
    metadata.mimeType = musicResult.mimeType;
    metadata.generatedLyricsText = musicResult.generatedLyricsText;
    metadata.wordTimings = wordTimings;
    metadata.lineTimings = lineTimings;
    metadata.errorMessage = alignmentWarning;

    roundState.generatedSong = {
      status: "ready",
      audioUrl: musicResult.audioUrl,
      mimeType: musicResult.mimeType,
      lyricsLines,
      lineTimings,
      wordTimings,
      errorMessage: alignmentWarning,
      musicProvider: musicResult.provider,
      alignmentProvider: alignmentResult?.provider || "fallback",
      promptUsed: musicResult.promptUsed,
      roundId
    };

    await writeRoundMetadata(roundId, metadata);
    return roundState.generatedSong;
  } catch (error) {
    const safeErrorMessage = error.message || "Unknown AI generation error.";

    metadata.errorMessage = safeErrorMessage;
    roundState.generatedSong = {
      ...buildInitialGeneratedSongState(lyricsLines),
      status: "error",
      errorMessage: safeErrorMessage,
      roundId
    };

    await writeRoundMetadata(roundId, metadata);
    return roundState.generatedSong;
  }
}

module.exports = {
  buildInitialGeneratedSongState,
  generateRoundSongAssets
};

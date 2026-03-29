const fs = require("fs");
const path = require("path");

const { deriveLineTimings, tokenizeLine } = require("./lineSync");

function isMockEnabled() {
  return String(process.env.MOCK_AI || "").toLowerCase() === "true";
}

function durationToMs(value) {
  if (value == null) {
    return 0;
  }

  if (typeof value === "string") {
    const numericValue = Number.parseFloat(value.replace(/s$/i, ""));
    return Number.isFinite(numericValue) ? Math.round(numericValue * 1000) : 0;
  }

  const seconds = Number(value.seconds || 0);
  const nanos = Number(value.nanos || 0);
  return Math.round(seconds * 1000 + nanos / 1_000_000);
}

function parseWavHeader(buffer) {
  if (!buffer || buffer.length < 44) {
    return null;
  }

  if (buffer.toString("ascii", 0, 4) !== "RIFF") {
    return null;
  }

  if (buffer.toString("ascii", 8, 12) !== "WAVE") {
    return null;
  }

  return {
    channels: buffer.readUInt16LE(22),
    sampleRate: buffer.readUInt32LE(24),
    bitsPerSample: buffer.readUInt16LE(34)
  };
}

function detectRecognitionConfig(audioFilePath, audioBuffer, transcriptText) {
  const extension = path.extname(audioFilePath).toLowerCase();
  const wavInfo = extension === ".wav" ? parseWavHeader(audioBuffer) : null;
  const phrases = String(transcriptText || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 100);

  const config = {
    enableWordTimeOffsets: true,
    enableAutomaticPunctuation: true,
    languageCode: "en-US",
    model: "latest_long"
  };

  if (phrases.length > 0) {
    config.speechContexts = [
      {
        phrases,
        boost: 15
      }
    ];
  }

  if (extension === ".mp3") {
    config.encoding = "MP3";
  } else if (wavInfo && wavInfo.bitsPerSample === 16) {
    config.encoding = "LINEAR16";
    config.sampleRateHertz = wavInfo.sampleRate;
    config.audioChannelCount = wavInfo.channels;
  }

  return config;
}

function createMockWordTimings(lyricsLines, totalDurationMs) {
  const safeLines = Array.isArray(lyricsLines) ? lyricsLines : [];
  const weights = safeLines.map((line) => Math.max(tokenizeLine(line).length, 1));
  const totalWeight = weights.reduce((sum, value) => sum + value, 0) || safeLines.length || 1;
  const words = [];
  let lineStartMs = 0;

  safeLines.forEach((line, lineIndex) => {
    const tokens = tokenizeLine(line);
    const lineDurationMs =
      lineIndex === safeLines.length - 1
        ? totalDurationMs - lineStartMs
        : Math.max(
            1200,
            Math.round((totalDurationMs * weights[lineIndex]) / totalWeight)
          );
    const wordDurationMs =
      tokens.length > 0
        ? Math.max(220, Math.floor(lineDurationMs / tokens.length))
        : lineDurationMs;

    tokens.forEach((token, tokenIndex) => {
      const startMs = lineStartMs + tokenIndex * wordDurationMs;
      const endMs =
        tokenIndex === tokens.length - 1
          ? lineStartMs + lineDurationMs
          : startMs + wordDurationMs - 40;

      words.push({
        word: token,
        startMs,
        endMs: Math.max(startMs + 80, endMs)
      });
    });

    lineStartMs += lineDurationMs;
  });

  return words;
}

function createMockAlignment(lyricsLines) {
  const totalDurationMs = 30_000;
  const words = createMockWordTimings(lyricsLines, totalDurationMs);
  const lines = deriveLineTimings({
    lyricsLines,
    words,
    totalDurationMs
  });

  return {
    words,
    lines,
    provider: "mock"
  };
}

async function callGoogleCloudSpeechToText({
  audioFilePath,
  transcriptText,
  lyricsLines
}) {
  let SpeechClient;

  try {
    ({ SpeechClient } = require("@google-cloud/speech"));
  } catch (error) {
    throw new Error(
      "Missing @google-cloud/speech. Run npm install and try again."
    );
  }

  const client = new SpeechClient({
    projectId: process.env.GOOGLE_CLOUD_PROJECT || undefined
  });
  const audioBuffer = fs.readFileSync(audioFilePath);
  const request = {
    config: detectRecognitionConfig(audioFilePath, audioBuffer, transcriptText),
    audio: {
      content: audioBuffer.toString("base64")
    }
  };

  try {
    const [response] = await client.recognize(request);
    const words = (response.results || []).flatMap((result) => {
      const alternative = result.alternatives?.[0];

      if (!alternative || !Array.isArray(alternative.words)) {
        return [];
      }

      return alternative.words.map((wordInfo) => ({
        word: wordInfo.word || "",
        startMs: durationToMs(wordInfo.startTime),
        endMs: durationToMs(wordInfo.endTime)
      }));
    });

    const lines = deriveLineTimings({
      lyricsLines,
      words
    });

    return {
      words,
      lines,
      provider: "google-cloud-stt"
    };
  } catch (error) {
    const credentialsHint =
      "Ensure Application Default Credentials are available, for example by setting GOOGLE_APPLICATION_CREDENTIALS.";

    throw new Error(
      `Google Cloud Speech-to-Text alignment failed: ${error.message}. ${credentialsHint}`
    );
  }
}

async function alignLyricsToAudio({
  audioFilePath,
  transcriptText,
  lyricsLines
}) {
  if (isMockEnabled()) {
    return createMockAlignment(lyricsLines);
  }

  return callGoogleCloudSpeechToText({
    audioFilePath,
    transcriptText,
    lyricsLines
  });
}

module.exports = {
  alignLyricsToAudio
};

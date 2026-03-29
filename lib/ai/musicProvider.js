const fs = require("fs");
const path = require("path");

function isMockEnabled() {
  return String(process.env.MOCK_AI || "").toLowerCase() === "true";
}

function resolveGeneratedAudioDir() {
  return path.resolve(
    process.cwd(),
    process.env.GENERATED_AUDIO_DIR || "./data/generated-audio"
  );
}

function ensureDirectory(directoryPath) {
  fs.mkdirSync(directoryPath, { recursive: true });
}

function sanitizeFileSegment(value) {
  return String(value || "round-song")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function normalizeLyricsInput(lyricsLines) {
  return (Array.isArray(lyricsLines) ? lyricsLines : []).map((line, index) => {
    if (typeof line === "string") {
      return {
        section: index === 0 ? "Verse" : "Chorus",
        text: line
      };
    }

    return {
      section: line?.section ? String(line.section) : index === 0 ? "Verse" : "Chorus",
      text: String(line?.text || "")
    };
  });
}

function buildLyricsBlock(lines) {
  return lines
    .map((line) => `[${line.section}]\n${line.text}`)
    .join("\n\n");
}

function buildMusicPrompt({ title, stylePrompt, lyricsLines, durationSec }) {
  const normalizedLines = normalizeLyricsInput(lyricsLines);
  const lyricsBlock = buildLyricsBlock(normalizedLines);
  const safeDurationSec = Math.max(20, Math.min(90, Number(durationSec || 35)));

  return [
    `Create one coherent short song titled "${title || "LAN Lyric Imposter"}".`,
    `Target duration: about ${safeDurationSec} seconds.`,
    "Include sung lead vocals and a full backing track.",
    "Keep it as one complete performance, not multiple disconnected fragments.",
    "Use the supplied lyrics exactly or as closely as possible in the final vocal performance.",
    `Style direction: ${stylePrompt || "Bold, catchy party-pop with clear vocals and strong rhythm."}`,
    "Lyrics:",
    lyricsBlock
  ].join("\n\n");
}

function extensionFromMimeType(mimeType) {
  const normalizedMimeType = String(mimeType || "").toLowerCase();

  if (normalizedMimeType.includes("wav")) {
    return ".wav";
  }

  if (normalizedMimeType.includes("mpeg") || normalizedMimeType.includes("mp3")) {
    return ".mp3";
  }

  return ".bin";
}

function writeWaveHeader({
  dataByteLength,
  sampleRate,
  channelCount,
  bitsPerSample
}) {
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * channelCount * (bitsPerSample / 8);
  const blockAlign = channelCount * (bitsPerSample / 8);

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataByteLength, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channelCount, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataByteLength, 40);

  return header;
}

function createMockWaveBuffer({ durationSec, sampleRate = 24000, channelCount = 1 }) {
  const bitsPerSample = 16;
  const totalSamples = Math.max(1, Math.floor(sampleRate * durationSec));
  const dataByteLength = totalSamples * channelCount * (bitsPerSample / 8);
  const pcmBuffer = Buffer.alloc(dataByteLength);

  for (let sampleIndex = 0; sampleIndex < totalSamples; sampleIndex += 1) {
    const time = sampleIndex / sampleRate;
    const baseTone = Math.sin(2 * Math.PI * 220 * time);
    const harmonic = Math.sin(2 * Math.PI * 330 * time);
    const envelope = 0.22 + 0.08 * Math.sin(2 * Math.PI * 0.25 * time);
    const sampleValue = Math.round((baseTone * 0.7 + harmonic * 0.3) * envelope * 32767);

    for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
      const offset = (sampleIndex * channelCount + channelIndex) * 2;
      pcmBuffer.writeInt16LE(sampleValue, offset);
    }
  }

  return Buffer.concat([
    writeWaveHeader({
      dataByteLength,
      sampleRate,
      channelCount,
      bitsPerSample
    }),
    pcmBuffer
  ]);
}

function createMockSong({
  roundId,
  title,
  stylePrompt,
  lyricsLines,
  durationSec,
  promptUsed
}) {
  const generatedAudioDir = resolveGeneratedAudioDir();
  const safeDurationSec = Math.max(20, Math.min(90, Number(durationSec || 30)));
  const fileName = `${sanitizeFileSegment(roundId || title || "mock-song")}.wav`;
  const audioFilePath = path.join(generatedAudioDir, fileName);
  const audioUrl = `/generated-audio/${fileName}`;

  ensureDirectory(generatedAudioDir);
  fs.writeFileSync(
    audioFilePath,
    createMockWaveBuffer({ durationSec: safeDurationSec })
  );

  return {
    audioFilePath,
    audioUrl,
    mimeType: "audio/wav",
    provider: "mock",
    generatedLyricsText: normalizeLyricsInput(lyricsLines)
      .map((line) => line.text)
      .join("\n"),
    promptUsed:
      promptUsed ||
      buildMusicPrompt({
        title,
        stylePrompt,
        lyricsLines,
        durationSec: safeDurationSec
      })
  };
}

async function callGoogleLyria({
  roundId,
  title,
  stylePrompt,
  lyricsLines,
  durationSec
}) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error(
      "Missing GEMINI_API_KEY. Set the API key or use MOCK_AI=true for local development."
    );
  }

  let GoogleGenAI;

  try {
    ({ GoogleGenAI } = require("@google/genai"));
  } catch (error) {
    throw new Error("Missing @google/genai. Run npm install and try again.");
  }

  const generatedAudioDir = resolveGeneratedAudioDir();
  const promptUsed = buildMusicPrompt({
    title,
    stylePrompt,
    lyricsLines,
    durationSec
  });
  const modelId = process.env.LYRIA_MODEL || "lyria-3-pro-preview";
  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY
  });

  ensureDirectory(generatedAudioDir);

  try {
    const response = await ai.models.generateContent({
      model: modelId,
      contents: promptUsed,
      config: {
        responseModalities: ["AUDIO", "TEXT"]
      }
    });
    const parts = response?.candidates?.[0]?.content?.parts || response?.parts || [];
    const lyricFragments = [];
    let audioInlineData = null;

    for (const part of parts) {
      if (part?.text) {
        lyricFragments.push(part.text);
      } else if (part?.inlineData?.data) {
        audioInlineData = part.inlineData;
      }
    }

    if (!audioInlineData?.data) {
      throw new Error(
        "The Lyria response did not include an audio part. Check model access and response modalities."
      );
    }

    const mimeType = audioInlineData.mimeType || "audio/mpeg";
    const extension = extensionFromMimeType(mimeType);
    const fileName = `${sanitizeFileSegment(roundId || title || "round-song")}${extension}`;
    const audioFilePath = path.join(generatedAudioDir, fileName);
    const audioBuffer = Buffer.from(audioInlineData.data, "base64");

    fs.writeFileSync(audioFilePath, audioBuffer);

    return {
      audioFilePath,
      audioUrl: `/generated-audio/${fileName}`,
      mimeType,
      provider: "google-lyria",
      generatedLyricsText: lyricFragments.join("\n").trim(),
      promptUsed
    };
  } catch (error) {
    throw new Error(`Google Lyria generation failed: ${error.message}`);
  }
}

async function generateSongFromLyrics({
  roundId,
  title,
  stylePrompt,
  lyricsLines,
  durationSec
}) {
  const promptUsed = buildMusicPrompt({
    title,
    stylePrompt,
    lyricsLines,
    durationSec
  });

  if (isMockEnabled()) {
    return createMockSong({
      roundId,
      title,
      stylePrompt,
      lyricsLines,
      durationSec,
      promptUsed
    });
  }

  return callGoogleLyria({
    roundId,
    title,
    stylePrompt,
    lyricsLines,
    durationSec,
    promptUsed
  });
}

module.exports = {
  buildMusicPrompt,
  generateSongFromLyrics
};

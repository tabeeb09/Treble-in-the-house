function isMockEnabled() {
  return String(process.env.MOCK_AI || "").toLowerCase() === "true";
}

function collapseWhitespace(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function estimateSongDurationSec(revealLines) {
  const safeLines = Array.isArray(revealLines) ? revealLines : [];
  const wordCount = safeLines.reduce((sum, line) => {
    return sum + collapseWhitespace(line.text).split(" ").filter(Boolean).length;
  }, 0);

  return wordCount / 2.6 + safeLines.length * 1.2;
}

function countNeededSupplementalLines(revealLines, targetDurationSec) {
  const safeDurationSec = Math.max(30, Math.min(40, Number(targetDurationSec || 35)));
  const estimatedDurationSec = estimateSongDurationSec(revealLines);
  const minimumLineCount = 7;
  const minimumNeededForLength = Math.max(
    0,
    Math.ceil((safeDurationSec - estimatedDurationSec) / 4.5)
  );
  const minimumNeededForStructure = Math.max(
    0,
    minimumLineCount - (Array.isArray(revealLines) ? revealLines.length : 0)
  );

  return clamp(
    Math.max(minimumNeededForLength, minimumNeededForStructure),
    0,
    6
  );
}

function sanitizeGeneratedLine(text) {
  const collapsed = collapseWhitespace(
    String(text || "")
      .replace(/^[-*•\d.)\s]+/, "")
      .replace(/^["']|["']$/g, "")
  );

  return collapsed
    .split(" ")
    .filter(Boolean)
    .slice(0, 12)
    .join(" ")
    .slice(0, 96)
    .trim();
}

function getFallbackLineBank(stylePrompt) {
  const style = String(stylePrompt || "").toLowerCase();

  if (/holiday|pool|buffet|resort|sun|sangria|karaoke/.test(style)) {
    return [
      "plastic moonlight makes the bad ideas shimmer",
      "cheap bracelets clap like destiny on holiday",
      "we glow like receipts in the sunset wind",
      "the night keeps pouring one more chorus",
      "sunburnt saints keep dancing through the spill",
      "the pool lights blink yes to disaster"
    ];
  }

  if (/eurovision|pop|glitter|stage|anthem|student/.test(style)) {
    return [
      "cheap lights crown the chaos like royalty",
      "we pose like legends in borrowed smoke",
      "the speakers cough but the dream gets louder",
      "our chorus lands like confetti on concrete",
      "every bad decision arrives in sequins",
      "the tiny room becomes a screaming empire"
    ];
  }

  if (/space|galaxy|rocket|alien|cosmic/.test(style)) {
    return [
      "the dashboard blinks in karaoke starlight",
      "our helmets ring with discount destiny",
      "the moonbeam disco shakes the cargo hold",
      "we orbit trouble with cinematic pride",
      "the cheap thrusters hum like synth romance",
      "our star-map glitter starts another chorus"
    ];
  }

  if (/library|exam|heatwave|campus|student/.test(style)) {
    return [
      "the radiators preach like summer prophets",
      "our notes ignite in fluorescent weather",
      "the library doors swing open to revolt",
      "we cram like icons in a paper storm",
      "the hallway heat turns panic into rhythm",
      "one last chorus escapes the study graveyard"
    ];
  }

  return [
    "the chorus lands like trouble in silk",
    "neon luck keeps breathing through the room",
    "our cheap little myth gets louder tonight",
    "the floor remembers every reckless promise",
    "we swing the whole scene back into focus",
    "one more hook and the room belongs to us"
  ];
}

function createMockSupplementalLines({
  title,
  stylePrompt,
  revealLines,
  count
}) {
  const bank = getFallbackLineBank(stylePrompt);
  const seedSource = `${title || ""}|${stylePrompt || ""}|${JSON.stringify(revealLines || [])}`;
  let seed = 0;

  for (let index = 0; index < seedSource.length; index += 1) {
    seed = (seed * 31 + seedSource.charCodeAt(index)) % bank.length;
  }

  return Array.from({ length: count }, (_, index) => ({
    unitId: `auto-fill-${index + 1}`,
    section: index % 2 === 0 ? "bridge" : "chorus",
    ownerLabel: "Auto Chorus",
    text: bank[(seed + index) % bank.length]
  }));
}

function buildSupplementalLyricsPrompt({
  title,
  stylePrompt,
  revealLines,
  count
}) {
  const baseLyrics = (Array.isArray(revealLines) ? revealLines : [])
    .map((line) => `- ${line.text}`)
    .join("\n");

  return [
    `You are extending a short song called "${title || "LAN Lyric Imposter"}".`,
    "Write additional lyric lines that fit the public lyricist theme, not the imposter theme.",
    `Theme and style: ${stylePrompt || "Catchy, witty party-pop with singable hooks."}`,
    `Return exactly ${count} new lyric lines.`,
    "Each line must be 5 to 10 words.",
    'Return strictly valid JSON in the shape {"lines":["..."]}.',
    "Do not use numbering, bullet points, labels, quotes around the whole response, section headers, or player names.",
    "Make the lines singable and coherent with the existing lyrics.",
    "Existing lyrics:",
    baseLyrics
  ].join("\n\n");
}

function parseSupplementalLines(value, count) {
  const safeValue = typeof value === "string" ? value : "";
  const jsonCandidate = safeValue.match(/\{[\s\S]*\}/);
  let parsedValue = null;

  if (jsonCandidate) {
    try {
      parsedValue = JSON.parse(jsonCandidate[0]);
    } catch (error) {
      parsedValue = null;
    }
  }

  const lines = Array.isArray(parsedValue?.lines)
    ? parsedValue.lines
        .map((line) => sanitizeGeneratedLine(line))
        .filter(Boolean)
    : safeValue
        .split(/\r?\n/)
        .map((line) => sanitizeGeneratedLine(line))
        .filter(Boolean);

  return lines.slice(0, count);
}

async function callGeminiLyricFiller({
  title,
  stylePrompt,
  revealLines,
  count
}) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("Missing GEMINI_API_KEY for lyric filler generation.");
  }

  let GoogleGenAI;

  try {
    ({ GoogleGenAI } = require("@google/genai"));
  } catch (error) {
    throw new Error("Missing @google/genai. Run npm install and try again.");
  }

  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY
  });
  const modelId = process.env.LYRIC_FILL_MODEL || "gemini-2.5-flash-lite";
  const prompt = buildSupplementalLyricsPrompt({
    title,
    stylePrompt,
    revealLines,
    count
  });

  try {
    const response = await ai.models.generateContent({
      model: modelId,
      contents: prompt,
      config: {
        responseMimeType: "application/json"
      }
    });
    const text = response?.text || "";
    const parsedLines = parseSupplementalLines(text, count);

    if (parsedLines.length === 0) {
      throw new Error("The lyric filler did not return usable lines.");
    }

    return {
      lines: parsedLines.map((line, index) => ({
        unitId: `auto-fill-${index + 1}`,
        section: index % 2 === 0 ? "bridge" : "chorus",
        ownerLabel: "Auto Chorus",
        text: line
      })),
      provider: modelId,
      promptUsed: prompt
    };
  } catch (error) {
    throw new Error(`Gemini lyric filler failed: ${error.message}`);
  }
}

async function expandRevealLinesToSong({
  title,
  stylePrompt,
  revealLines,
  targetDurationSec
}) {
  const safeRevealLines = Array.isArray(revealLines) ? revealLines : [];
  const additionalLineCount = countNeededSupplementalLines(
    safeRevealLines,
    targetDurationSec
  );

  if (additionalLineCount === 0) {
    return {
      revealLines: safeRevealLines,
      usedFiller: false,
      fillerProvider: null,
      fillerPrompt: null
    };
  }

  if (isMockEnabled()) {
    return {
      revealLines: [
        ...safeRevealLines,
        ...createMockSupplementalLines({
          title,
          stylePrompt,
          revealLines: safeRevealLines,
          count: additionalLineCount
        })
      ],
      usedFiller: true,
      fillerProvider: "mock",
      fillerPrompt: null
    };
  }

  try {
    const result = await callGeminiLyricFiller({
      title,
      stylePrompt,
      revealLines: safeRevealLines,
      count: additionalLineCount
    });

    return {
      revealLines: [...safeRevealLines, ...result.lines],
      usedFiller: true,
      fillerProvider: result.provider,
      fillerPrompt: result.promptUsed
    };
  } catch (error) {
    return {
      revealLines: [
        ...safeRevealLines,
        ...createMockSupplementalLines({
          title,
          stylePrompt,
          revealLines: safeRevealLines,
          count: additionalLineCount
        })
      ],
      usedFiller: true,
      fillerProvider: "mock-fallback",
      fillerPrompt: error.message || null
    };
  }
}

module.exports = {
  estimateSongDurationSec,
  expandRevealLinesToSong
};

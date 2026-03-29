function isMockEnabled() {
  return String(process.env.MOCK_AI || "").toLowerCase() === "true";
}

function buildSongSchemaPrompt({ theme, promptUnitCount = 4 }) {
  return [
    "Create one song object for the LAN Lyric Imposter schema version 1.1.",
    `Theme: ${theme || "Chaotic comedic party-pop with a suspicious imposter theme."}`,
    `Return strictly valid JSON for one song object with ${promptUnitCount} promptUnits.`,
    "Each promptUnit should have two steps.",
    "Use the exact schema fields needed by the app: id, title, publicTheme, roleThemes, promptUnits, outputTemplate, steps, role-specific promptTemplate/defaultBotInstructionTemplate/defaultResponseTemplate/defaultTag.",
    "Use short funny defaults and singable lyric prompts.",
    "Do not include markdown fences or explanation."
  ].join("\n\n");
}

async function generateSongSchemaDraft({
  theme,
  promptUnitCount = 4
}) {
  if (isMockEnabled() || !process.env.GEMINI_API_KEY) {
    throw new Error(
      "Song schema draft generation requires GEMINI_API_KEY and is disabled in MOCK_AI mode."
    );
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
  const prompt = buildSongSchemaPrompt({
    theme,
    promptUnitCount
  });
  const response = await ai.models.generateContent({
    model: modelId,
    contents: prompt,
    config: {
      responseMimeType: "application/json"
    }
  });
  const rawText = response?.text || "";
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);

  if (!jsonMatch) {
    throw new Error("The song schema model response did not include valid JSON.");
  }

  return JSON.parse(jsonMatch[0]);
}

module.exports = {
  generateSongSchemaDraft
};

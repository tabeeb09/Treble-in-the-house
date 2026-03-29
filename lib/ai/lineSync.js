function normalizeWord(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/^[^a-z0-9']+|[^a-z0-9']+$/gi, "")
    .replace(/[^a-z0-9']+/gi, "");
}

function tokenizeLine(text) {
  return String(text || "")
    .split(/\s+/)
    .map((word) => normalizeWord(word))
    .filter(Boolean);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function splitRangeByWeight(lines, startIndex, endIndex, startMs, endMs) {
  const safeStart = Math.max(0, startMs || 0);
  const safeEnd = Math.max(safeStart, endMs || safeStart);
  const slice = lines.slice(startIndex, endIndex + 1);
  const totalWeight =
    slice.reduce((sum, line) => sum + (line._weight || 1), 0) || slice.length || 1;
  const span = safeEnd - safeStart;
  let cursor = safeStart;

  slice.forEach((line, offset) => {
    const isLast = offset === slice.length - 1;
    const portion = isLast
      ? safeEnd
      : cursor + Math.round((span * (line._weight || 1)) / totalWeight);

    line.startMs = cursor;
    line.endMs = Math.max(cursor, portion);
    cursor = line.endMs;
  });
}

function fillMissingLineTimings(lines, totalDurationMs) {
  const matchedIndices = lines
    .map((line, index) => (line.startMs != null && line.endMs != null ? index : null))
    .filter((index) => index != null);

  if (lines.length === 0) {
    return;
  }

  if (matchedIndices.length === 0) {
    splitRangeByWeight(lines, 0, lines.length - 1, 0, totalDurationMs);
    return;
  }

  const firstMatchedIndex = matchedIndices[0];

  if (firstMatchedIndex > 0) {
    splitRangeByWeight(
      lines,
      0,
      firstMatchedIndex - 1,
      0,
      lines[firstMatchedIndex].startMs
    );
  }

  for (let index = 0; index < matchedIndices.length - 1; index += 1) {
    const currentMatchedIndex = matchedIndices[index];
    const nextMatchedIndex = matchedIndices[index + 1];

    if (nextMatchedIndex - currentMatchedIndex > 1) {
      splitRangeByWeight(
        lines,
        currentMatchedIndex + 1,
        nextMatchedIndex - 1,
        lines[currentMatchedIndex].endMs,
        lines[nextMatchedIndex].startMs
      );
    }
  }

  const lastMatchedIndex = matchedIndices[matchedIndices.length - 1];

  if (lastMatchedIndex < lines.length - 1) {
    splitRangeByWeight(
      lines,
      lastMatchedIndex + 1,
      lines.length - 1,
      lines[lastMatchedIndex].endMs,
      totalDurationMs
    );
  }

  lines.forEach((line, index) => {
    if (line.startMs == null || line.endMs == null) {
      const previousLine = index > 0 ? lines[index - 1] : null;
      const nextLine = index < lines.length - 1 ? lines[index + 1] : null;
      const fallbackStart = previousLine ? previousLine.endMs : 0;
      const fallbackEnd = nextLine ? nextLine.startMs : totalDurationMs;

      line.startMs = fallbackStart;
      line.endMs = Math.max(fallbackStart, fallbackEnd);
    }
  });
}

function deriveLineTimings({ lyricsLines, words, totalDurationMs }) {
  const safeLyricsLines = Array.isArray(lyricsLines) ? lyricsLines : [];
  const safeWords = Array.isArray(words) ? words : [];
  const normalizedWords = safeWords
    .map((word, index) => ({
      index,
      word: String(word.word || ""),
      normalized: normalizeWord(word.word),
      startMs: Number(word.startMs || 0),
      endMs: Number(word.endMs || 0)
    }))
    .filter((word) => word.normalized);

  const detectedDurationMs =
    normalizedWords.length > 0
      ? normalizedWords[normalizedWords.length - 1].endMs
      : 0;
  const fallbackDurationMs = Math.max(
    Number(totalDurationMs || 0),
    detectedDurationMs,
    safeLyricsLines.length * 1800,
    8000
  );

  let searchCursor = 0;

  const lines = safeLyricsLines.map((text) => {
    const tokens = tokenizeLine(text);
    const matchedIndices = [];

    if (tokens.length > 0 && normalizedWords.length > 0) {
      for (const token of tokens) {
        let foundIndex = -1;
        const lookaheadLimit = Math.min(normalizedWords.length, searchCursor + 16);

        for (let index = searchCursor; index < lookaheadLimit; index += 1) {
          if (normalizedWords[index].normalized === token) {
            foundIndex = index;
            break;
          }
        }

        if (foundIndex === -1) {
          break;
        }

        matchedIndices.push(foundIndex);
        searchCursor = foundIndex + 1;
      }
    }

    return {
      text,
      startMs:
        matchedIndices.length > 0
          ? normalizedWords[matchedIndices[0]].startMs
          : null,
      endMs:
        matchedIndices.length > 0
          ? normalizedWords[matchedIndices[matchedIndices.length - 1]].endMs
          : null,
      wordStartIndex: matchedIndices.length > 0 ? matchedIndices[0] : -1,
      wordEndIndex:
        matchedIndices.length > 0 ? matchedIndices[matchedIndices.length - 1] : -1,
      _weight: Math.max(tokens.length, 1)
    };
  });

  fillMissingLineTimings(lines, fallbackDurationMs);

  return lines.map((line, index) => {
    const previousLine = index > 0 ? lines[index - 1] : null;
    const nextLine = index < lines.length - 1 ? lines[index + 1] : null;
    const safeStart = clamp(
      Math.round(line.startMs || 0),
      previousLine ? previousLine.endMs : 0,
      fallbackDurationMs
    );
    const safeEnd = clamp(
      Math.round(line.endMs || safeStart),
      safeStart,
      nextLine ? nextLine.startMs || fallbackDurationMs : fallbackDurationMs
    );

    return {
      text: line.text,
      startMs: safeStart,
      endMs: Math.max(safeStart, safeEnd),
      wordStartIndex: line.wordStartIndex,
      wordEndIndex: line.wordEndIndex
    };
  });
}

module.exports = {
  deriveLineTimings,
  normalizeWord,
  tokenizeLine
};

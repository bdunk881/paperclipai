export interface ChunkingConfig {
  maxChunkSizeTokens: number;
  minChunkSizeChars: number;
  overlapTokens: number;
}

export interface ChunkDraft {
  index: number;
  text: string;
  tokenCount: number;
  startOffset: number;
  endOffset: number;
}

export const DEFAULT_CHUNKING_CONFIG: ChunkingConfig = {
  maxChunkSizeTokens: 1024,
  minChunkSizeChars: 100,
  overlapTokens: 200,
};

interface TokenSpan {
  text: string;
  start: number;
  end: number;
  estimatedTokens: number;
}

interface TextSpan {
  text: string;
  start: number;
  end: number;
}

function estimateTokenCount(fragment: string): number {
  const normalized = fragment.trim();
  if (!normalized) {
    return 0;
  }

  if (/^[A-Za-z0-9]+$/.test(normalized)) {
    return Math.max(1, Math.ceil(normalized.length / 4));
  }

  return 1;
}

function tokenize(text: string, baseOffset = 0): TokenSpan[] {
  const matches = text.matchAll(/[A-Za-z0-9]+|[^\sA-Za-z0-9]/g);
  const tokens: TokenSpan[] = [];
  for (const match of matches) {
    const token = match[0];
    const start = (match.index ?? 0) + baseOffset;
    tokens.push({
      text: token,
      start,
      end: start + token.length,
      estimatedTokens: estimateTokenCount(token),
    });
  }
  return tokens;
}

function sentenceAwareParagraphs(content: string): TextSpan[] {
  const spans: TextSpan[] = [];
  const re = /[\s\S]+?(?:\n\s*\n|$)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    const raw = match[0];
    const leading = raw.match(/^\s*/)?.[0].length ?? 0;
    const trailing = raw.match(/\s*$/)?.[0].length ?? 0;
    const trimmed = raw.trim();
    if (!trimmed) {
      continue;
    }
    const start = (match.index ?? 0) + leading;
    const end = (match.index ?? 0) + raw.length - trailing;
    spans.push({ text: trimmed, start, end });
  }
  return spans;
}

function createChunkText(tokens: TokenSpan[]): string {
  const parts: string[] = [];
  for (const token of tokens) {
    if (parts.length === 0) {
      parts.push(token.text);
      continue;
    }
    if (/^[^\w]+$/.test(token.text)) {
      parts[parts.length - 1] = `${parts[parts.length - 1]}${token.text}`;
    } else {
      parts.push(token.text);
    }
  }
  return parts.join(" ").trim();
}

function totalEstimatedTokens(tokens: TokenSpan[]): number {
  return tokens.reduce((sum, token) => sum + token.estimatedTokens, 0);
}

export function chunkDocument(
  content: string,
  config: Partial<ChunkingConfig> = {}
): ChunkDraft[] {
  const merged = {
    ...DEFAULT_CHUNKING_CONFIG,
    ...config,
  };
  const normalized = content.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return [];
  }

  const chunks: ChunkDraft[] = [];
  const paragraphs = sentenceAwareParagraphs(normalized);
  const fallbackTokens = tokenize(normalized);
  const units = paragraphs.length > 0 ? paragraphs : [normalized];

  let carryover: TokenSpan[] = [];

  const flush = (tokens: TokenSpan[]) => {
    const text = createChunkText(tokens);
    if (!text) {
      return;
    }
    const startOffset = tokens[0].start;
    const endOffset = tokens[tokens.length - 1].end;
    chunks.push({
      index: chunks.length,
      text,
      tokenCount: totalEstimatedTokens(tokens),
      startOffset,
      endOffset,
    });
  };

  for (const unit of units) {
    const unitTokens = typeof unit === "string" ? tokenize(unit) : tokenize(unit.text, unit.start);
    if (unitTokens.length === 0) {
      continue;
    }

    if (totalEstimatedTokens(unitTokens) >= merged.maxChunkSizeTokens) {
      let oversizedCursor = 0;
      while (oversizedCursor < unitTokens.length) {
        const slice: TokenSpan[] = [];
        let estimated = 0;
        while (
          oversizedCursor < unitTokens.length &&
          estimated + unitTokens[oversizedCursor].estimatedTokens <= merged.maxChunkSizeTokens
        ) {
          slice.push(unitTokens[oversizedCursor]);
          estimated += unitTokens[oversizedCursor].estimatedTokens;
          oversizedCursor += 1;
        }
        if (slice.length === 0) {
          slice.push(unitTokens[oversizedCursor]);
          oversizedCursor += 1;
        }
        const candidate = [...carryover, ...slice];
        flush(candidate);
        let overlapBudget = merged.overlapTokens;
        carryover = [];
        for (let i = slice.length - 1; i >= 0 && overlapBudget > 0; i -= 1) {
          carryover.unshift(slice[i]);
          overlapBudget -= slice[i].estimatedTokens;
        }
      }
      continue;
    }

    const candidate = [...carryover, ...unitTokens];
    const candidateText = createChunkText(candidate);
    if (
      totalEstimatedTokens(candidate) > merged.maxChunkSizeTokens ||
      candidateText.length >= merged.minChunkSizeChars
    ) {
      flush(candidate);
      let overlapBudget = merged.overlapTokens;
      carryover = [];
      for (let i = candidate.length - 1; i >= 0 && overlapBudget > 0; i -= 1) {
        carryover.unshift(candidate[i]);
        overlapBudget -= candidate[i].estimatedTokens;
      }
    } else {
      carryover = candidate;
    }
  }

  if (carryover.length > 0) {
    flush(carryover);
  }

  if (chunks.length === 0 && fallbackTokens.length > 0) {
    const slice: TokenSpan[] = [];
    let estimated = 0;
    for (const token of fallbackTokens) {
      if (estimated + token.estimatedTokens > merged.maxChunkSizeTokens) {
        break;
      }
      slice.push(token);
      estimated += token.estimatedTokens;
    }
    flush(slice);
  }

  return chunks;
}

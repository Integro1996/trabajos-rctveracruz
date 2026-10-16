export function joinAdjacentText(first, second) {
  if (!first) return second;
  if (!second) return first;
  return first + (/\s$/u.test(first) || /^\s/u.test(second) ? "" : " ") + second;
}

export function referenceText(block) {
  const title = String(block?.referenceTitle || "").trim();
  const description = String(block?.text || "");
  if (!title) return description;
  return title + (description.trim() ? (/[.!?:;]$/u.test(title) ? " " : ". ") : "") + description.trim();
}

export function mergeAdjacentText(introduction, blocks) {
  const merged = [];
  let changed = false;
  for (const block of blocks) {
    const previous = merged.at(-1);
    if (block.type === "text" && previous?.type === "text" && block.heading === previous.heading && block.heading !== "Referencias bibliográficas") {
      merged[merged.length - 1] = { ...previous, text: joinAdjacentText(previous.text, block.text) };
      changed = true;
    } else {
      merged.push(block);
    }
  }
  let nextIntroduction = introduction;
  if (merged[0]?.type === "text" && merged[0].heading === "Introducción") {
    nextIntroduction = joinAdjacentText(introduction, merged[0].text);
    merged.shift();
    changed = true;
  }
  return { introduction: nextIntroduction, blocks: merged, changed };
}

// Drafting answers for recall cards (src/lib/study/draft-answers.ts). It writes a
// made-up draft, over two lines, for each numbered question, and leaves out one that
// says it needs the book, as Claude would (e2e/state-recall-draft.spec.ts).

export const matches = (body) => "answers" in (body.output_config?.format?.schema?.properties ?? {});

export function answer(user) {
  const block = /<questions>\n([\s\S]*)\n<\/questions>/.exec(user)?.[1] ?? "";
  const answers = block.split("\n").flatMap((line) => {
    const m = /^Q(\d+)\| \[[^\]]*\] (.*)$/.exec(line);
    if (!m || /needs the book/i.test(m[2])) return [];
    return [{ question: Number(m[1]), answer: `A made-up draft.\nIt answers: ${m[2]}` }];
  });
  return { answers };
}

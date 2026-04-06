const fs = require('fs');
const path = require('path');

const SRC = '/Users/yumin/.openclaw/workspace/tmp/gsat-115-source/txt';
const OUT = '/Users/yumin/.openclaw/workspace/tmp/gsat-115-quiz/data.js';

function cleanText(text) {
  return text
    .replace(/\r/g, '')
    .replace(/\f/g, '\n')
    .replace(/[‐‑‒–—]/g, '-')
    .replace(/說明/g, '說明')
    .replace(/年/g, '年')
    .replace(/零/g, '零')
    .replace(/不/g, '不')
    .replace(/更/g, '更')
    .replace(/切/g, '切')
    .replace(/識/g, '識')
    .replace(/理/g, '理')
    .replace(/．/g, '·')
    .replace(//g, '-')
    .replace(//g, '×')
    .replace(//g, '≤')
    .replace(//g, '≥')
    .replace(//g, '→')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n');
}

function parseAnswerKey(file) {
  const text = cleanText(fs.readFileSync(file, 'utf8'));
  const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
  const map = {};
  for (const line of lines) {
    const matches = [...line.matchAll(/(\d+(?:-\d+)?)\s+(／|[A-J](?:,[A-J])+|[1-5](?:,[1-5])+|[A-J]{2,10}|[1-9][0-9]?|[A-J])/g)];
    for (const m of matches) map[m[1]] = m[2];
  }
  return map;
}

function normalizeChoiceAnswer(ans, mode) {
  if (!ans || ans === '／') return null;
  if (mode === 'numeric') {
    if (ans.includes(',')) return ans.split(',').map(n => String.fromCharCode(64 + Number(n))).sort().join('');
    if (/^\d+$/.test(ans)) return String.fromCharCode(64 + Number(ans));
  }
  return ans.replace(/,/g, '').split('').sort().join('');
}

function extractRange(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  if (start === -1) return '';
  const end = endMarker ? text.indexOf(endMarker, start) : -1;
  return text.slice(start, end === -1 ? undefined : end);
}

function splitQuestionBlocks(sectionText, ids) {
  const positions = ids.map(id => ({ id, idx: sectionText.search(new RegExp(`(?:^|\\n)${id}\\.`)) })).filter(x => x.idx !== -1);
  const blocks = {};
  positions.forEach((p, i) => {
    const end = i + 1 < positions.length ? positions[i + 1].idx : sectionText.length;
    blocks[p.id] = sectionText.slice(p.idx, end).trim();
  });
  return blocks;
}

function parseLetterChoices(block) {
  const compact = block.replace(/\n/g, ' ');
  const pieces = compact.split(/(?=\([A-E]\))/g).map(s => s.trim()).filter(Boolean);
  const choices = [];
  for (const piece of pieces) {
    const m = piece.match(/^\(([A-E])\)\s*([\s\S]*)$/);
    if (!m) continue;
    choices.push({ key: m[1], text: m[2].trim() });
  }
  return choices;
}

function parseNumericChoices(block) {
  const compact = block.replace(/\n/g, ' ');
  const pieces = compact.split(/(?=\([1-5]\))/g).map(s => s.trim()).filter(Boolean);
  const choices = [];
  for (const piece of pieces) {
    const m = piece.match(/^\(([1-5])\)\s*([\s\S]*)$/);
    if (!m) continue;
    choices.push({ key: String.fromCharCode(64 + Number(m[1])), text: m[2].trim() });
  }
  return choices;
}

function stripQuestionNumber(block, id) {
  return block.replace(new RegExp(`^${id}\\.\\s*`), '').trim();
}

function normalizeEnglishText(text) {
  return cleanText(text)
    .split('\n')
    .filter(line => {
      const trimmed = line.trim();
      if (!trimmed) return true;
      if (/^[-－]\s*\d+\s*[-－]$/.test(trimmed)) return false;
      if (/^第\s*\d+\s*頁/.test(trimmed)) return false;
      if (/^共\s*\d+\s*頁/.test(trimmed)) return false;
      if (/^115年學測$/.test(trimmed)) return false;
      if (/^英文考科$/.test(trimmed)) return false;
      if (/^請記得在答題卷簽名欄位以正楷簽全名$/.test(trimmed)) return false;
      return true;
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}

function extractEnglishSharedChoices(sectionText, optionKeys) {
  const optionSet = new Set(optionKeys);
  const choices = [];
  const regex = /\(([A-J])\)\s*([\s\S]*?)(?=\s*\([A-J]\)|\s*$)/g;
  for (const match of sectionText.matchAll(regex)) {
    const key = match[1];
    if (!optionSet.has(key)) continue;
    choices.push({ key, text: match[2].replace(/\s+/g, ' ').trim() });
  }
  return choices.filter(c => optionSet.has(c.key));
}

function parseEnglishNumberedQuestions(sectionText, questionIds, choicesById, score, sharedPassage = '') {
  const positions = questionIds.map(id => ({ id, idx: sectionText.search(new RegExp(`(?:^|\\n)${id}\\.`)) })).filter(x => x.idx !== -1);
  const questions = [];
  positions.forEach((p, i) => {
    const end = i + 1 < positions.length ? positions[i + 1].idx : sectionText.length;
    const block = sectionText.slice(p.idx, end).trim();
    const m = block.match(new RegExp(`^${p.id}\\.\\s*([\\s\\S]*?)((?:\\n\\s*\\([A-E]\\)[\\s\\S]*)+)$`));
    if (!m) return;
    const stemOnly = m[1].replace(/\s+\n/g, '\n').trim();
    const choices = parseLetterChoices(m[2]);
    const stem = sharedPassage ? `${sharedPassage}\n\n${stemOnly}` : stemOnly;
    questions.push({
      id: String(p.id),
      type: 'single',
      score,
      stem,
      choices: choicesById?.[p.id] || choices,
      answer: choicesById?.[p.id]?.answer || null,
      sourceType: 'official-txt'
    });
  });
  return questions;
}

function parseEnglishSubject({ textFile, answerFile }) {
  const rawText = fs.readFileSync(textFile, 'utf8');
  const text = normalizeEnglishText(rawText);
  const answers = parseAnswerKey(answerFile);
  const questions = [];

  // 1-10 vocabulary
  questions.push(...parseChoiceQuestions({
    textFile,
    answerFile,
    id: 'english-vocab-tmp',
    name: 'tmp',
    sectionStart: '1.',
    sectionEnd: '二 、 綜 合 測 驗',
    questionIds: Array.from({ length: 10 }, (_, i) => i + 1),
    score: 1,
    choiceMode: 'letter',
    answerMode: 'letter'
  }).questions);

  // 11-20 cloze
  const sec11to15 = extractRange(text, '第 11 至 15 題為題組', '第 16 至 20 題為題組').trim();
  const sec16to20 = extractRange(text, '第 16 至 20 題為題組', '三 、 文 意 選 填').trim();
  for (const section of [sec11to15, sec16to20]) {
    const firstIdx = section.search(/(?:^|\n)\d+\./);
    const passage = section.slice(0, firstIdx).trim();
    const numbered = section.slice(firstIdx).trim();
    const lineRegex = /^(\d+)\.\s*(.*)$/gm;
    for (const match of numbered.matchAll(lineRegex)) {
      const qid = match[1];
      const choices = parseLetterChoices(match[2]);
      if (!choices.length) continue;
      questions.push({
        id: qid,
        type: 'single',
        score: 1,
        stem: passage,
        choices,
        answer: answers[qid],
        sourceType: 'official-txt'
      });
    }
  }

  // 21-30 word bank
  const sec21to30 = extractRange(text, '第 21 至 30 題為題組', '四 、 篇 章 結 構').trim();
  const options21 = extractEnglishSharedChoices(sec21to30, ['A','B','C','D','E','F','G','H','I','J']);
  const passage21 = sec21to30.slice(0, sec21to30.indexOf('(A)')).trim();
  for (let qid = 21; qid <= 30; qid++) {
    questions.push({
      id: String(qid),
      type: 'single',
      score: 1,
      stem: passage21,
      choices: options21,
      answer: answers[String(qid)],
      sourceType: 'official-txt'
    });
  }

  // 31-34 paragraph structure
  const sec31to34 = extractRange(text, '第 31 至 34 題為題組', '五 、 閱 讀 測 驗').trim();
  const options31 = extractEnglishSharedChoices(sec31to34, ['A','B','C','D','E']);
  const passage31 = sec31to34.slice(0, sec31to34.indexOf('(A)')).trim();
  for (let qid = 31; qid <= 34; qid++) {
    questions.push({
      id: String(qid),
      type: 'single',
      score: 2,
      stem: passage31,
      choices: options31,
      answer: answers[String(qid)],
      sourceType: 'official-txt'
    });
  }

  // 35-46 reading
  for (const [startMarker, endMarker, ids] of [
    ['第 35 至 38 題為題組', '第 39 至 42 題為題組', [35,36,37,38]],
    ['第 39 至 42 題為題組', '第 43 至 46 題為題組', [39,40,41,42]],
    ['第 43 至 46 題為題組', '第 貳 部 分', [43,44,45,46]]
  ]) {
    const section = extractRange(text, startMarker, endMarker).trim();
    const firstIdx = section.search(/(?:^|\n)\d+\./);
    const passage = section.slice(0, firstIdx).trim();
    const qs = parseEnglishNumberedQuestions(section.slice(firstIdx), ids, null, 2)
      .map(q => ({ ...q, stem: `${passage}\n\n${q.stem}`, answer: answers[q.id] }));
    questions.push(...qs);
  }

  return {
    id: 'english',
    name: '英文',
    note: '收錄可自動批改的客觀題 1-46；47-50 為混合或非選題未納入。',
    questions: questions.sort((a, b) => Number(a.id) - Number(b.id))
  };
}

function parseChoiceQuestions({ textFile, answerFile, name, id, sectionStart, sectionEnd, questionIds, score, choiceMode='letter', answerMode='letter', note }) {
  const text = cleanText(fs.readFileSync(textFile, 'utf8'));
  const answers = parseAnswerKey(answerFile);
  const section = extractRange(text, sectionStart, sectionEnd);
  const blocks = splitQuestionBlocks(section, questionIds);
  const questions = [];
  for (const qid of questionIds) {
    const ansRaw = answers[String(qid)];
    if (!ansRaw || ansRaw === '／') continue;
    const block = blocks[qid];
    if (!block) continue;
    const parser = choiceMode === 'numeric' ? parseNumericChoices : parseLetterChoices;
    const choices = parser(block);
    if (!choices.length) continue;
    const stem = stripQuestionNumber(block, qid).split(/\([A-E1-5]\)/)[0].trim();
    const answer = normalizeChoiceAnswer(ansRaw, answerMode);
    questions.push({
      id: String(qid),
      type: answer.length > 1 ? 'multi' : 'single',
      score,
      stem,
      choices,
      answer,
      sourceType: 'official-txt'
    });
  }
  return { id, name, note, questions };
}

function parseMathFillSubject({ textFile, answerFile, id, name, note, choicePrefix }) {
  const text = cleanText(fs.readFileSync(textFile, 'utf8'));
  const answers = parseAnswerKey(answerFile);
  const questions = [];
  const ranges = [13,14,15,16,17];
  for (let i = 0; i < ranges.length; i++) {
    const q = ranges[i];
    const next = ranges[i+1] ? `\n${ranges[i+1]}.` : '\n第 貳 部 分';
    const start = text.indexOf(`\n${q}.`);
    if (start === -1) continue;
    const end = text.indexOf(next, start + 1);
    const block = text.slice(start + 1, end === -1 ? undefined : end).trim();
    const parts = Object.keys(answers).filter(k => k.startsWith(`${q}-`)).sort((a,b)=>a.localeCompare(b, 'zh-Hant-u-kn-true'));
    if (!parts.length) continue;
    questions.push({
      id: `${choicePrefix}-${q}`,
      type: 'fill',
      score: 5,
      stem: block.replace(/○+/g, '＿').trim(),
      blanks: parts.map(k => ({ id: k, answer: answers[k] })),
      sourceType: 'official-txt'
    });
  }
  const choiceQ18Ans = answers['18'];
  if (choiceQ18Ans && choiceQ18Ans !== '／') {
    const start = text.indexOf('\n18.');
    const end = text.indexOf('\n19.', start + 1);
    const block = text.slice(start + 1, end === -1 ? undefined : end).trim();
    const choices = parseNumericChoices(block);
    questions.push({
      id: `${choicePrefix}-18`,
      type: 'single',
      score: 3,
      stem: stripQuestionNumber(block, 18).split(/\([1-5]\)/)[0].trim(),
      choices,
      answer: normalizeChoiceAnswer(choiceQ18Ans, 'numeric'),
      sourceType: 'official-txt'
    });
  }
  return { id, name, note, questions };
}

const subjects = [];
subjects.push(parseChoiceQuestions({
  textFile: path.join(SRC, '國綜題目.txt'),
  answerFile: path.join(SRC, '國綜答案.txt'),
  id: 'chinese',
  name: '國綜',
  sectionStart: '1.',
  sectionEnd: null,
  questionIds: Array.from({length: 36}, (_,i)=>i+1),
  score: 2,
  choiceMode: 'letter',
  answerMode: 'letter',
  note: '支援所有有官方客觀答案的選擇題；申論/非選題略過。'
}));
subjects.push(parseChoiceQuestions({
  textFile: path.join(SRC, '社會題目.txt'),
  answerFile: path.join(SRC, '社會答案.txt'),
  id: 'social',
  name: '社會',
  sectionStart: '1.',
  sectionEnd: null,
  questionIds: Array.from({length: 65}, (_,i)=>i+1),
  score: 2,
  choiceMode: 'letter',
  answerMode: 'letter',
  note: '只收錄答案鍵可自動批改的客觀題；需要文字作答的混合題略過。'
}));
subjects.push(parseChoiceQuestions({
  textFile: path.join(SRC, '自然題目.txt'),
  answerFile: path.join(SRC, '自然答案.txt'),
  id: 'science',
  name: '自然',
  sectionStart: '1.',
  sectionEnd: null,
  questionIds: Array.from({length: 56}, (_,i)=>i+1),
  score: 2,
  choiceMode: 'letter',
  answerMode: 'letter',
  note: '支援單選與多選；圖表仍以文字摘錄呈現，未嵌入原始附圖。'
}));
subjects.push(parseChoiceQuestions({
  textFile: path.join(SRC, '數A題目.txt'),
  answerFile: path.join(SRC, '數A答案.txt'),
  id: 'math-a-choice',
  name: '數A（選擇題）',
  sectionStart: '1.',
  sectionEnd: '13.',
  questionIds: Array.from({length: 12}, (_,i)=>i+1),
  score: 5,
  choiceMode: 'numeric',
  answerMode: 'numeric',
  note: '數A選擇題 1-12。'
}));
subjects.push(parseMathFillSubject({
  textFile: path.join(SRC, '數A題目.txt'),
  answerFile: path.join(SRC, '數A答案.txt'),
  id: 'math-a-fill',
  name: '數A（選填題）',
  choicePrefix: 'math-a',
  note: '數A 選填題 13-18；非選 19-20 未支援。'
}));
subjects.push(parseChoiceQuestions({
  textFile: path.join(SRC, '數B題目.txt'),
  answerFile: path.join(SRC, '數B答案.txt'),
  id: 'math-b-choice',
  name: '數B（選擇題）',
  sectionStart: '1.',
  sectionEnd: '13.',
  questionIds: Array.from({length: 12}, (_,i)=>i+1),
  score: 5,
  choiceMode: 'numeric',
  answerMode: 'numeric',
  note: '數B選擇題 1-12。'
}));
subjects.push(parseMathFillSubject({
  textFile: path.join(SRC, '數B題目.txt'),
  answerFile: path.join(SRC, '數B答案.txt'),
  id: 'math-b-fill',
  name: '數B（選填題）',
  choicePrefix: 'math-b',
  note: '數B 選填題 13-18；非選 19-20 未支援。'
}));

subjects.push(parseEnglishSubject({
  textFile: path.join(SRC, '英文題目.txt'),
  answerFile: path.join(SRC, '英文答案.txt')
}));

const payload = {
  builtAt: new Date().toISOString(),
  subjects: subjects.map(subject => ({
    ...subject,
    fullScore: subject.questions.reduce((sum, q) => sum + (q.score || 0), 0)
  }))
};

fs.writeFileSync(OUT, `window.GSAT_DATA = ${JSON.stringify(payload, null, 2)};\n`);
console.log('Wrote', OUT);
for (const s of payload.subjects) console.log(s.name, s.questions.length, s.fullScore);

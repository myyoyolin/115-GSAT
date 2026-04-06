const data = window.GSAT_DATA;
const subjectSelect = document.getElementById('subjectSelect');
const questionsEl = document.getElementById('questions');
const submitBtn = document.getElementById('submitBtn');
const resetBtn = document.getElementById('resetBtn');
const summarySubject = document.getElementById('summarySubject');
const summaryCount = document.getElementById('summaryCount');
const summaryCorrect = document.getElementById('summaryCorrect');
const summaryScore = document.getElementById('summaryScore');
const subjectNote = document.getElementById('subjectNote');

let currentSubject = null;

function initSubjects() {
  data.subjects.forEach(subject => {
    const option = document.createElement('option');
    option.value = subject.id;
    option.textContent = `${subject.name}（${subject.questions.length}題）`;
    subjectSelect.appendChild(option);
  });
  currentSubject = data.subjects[0];
  subjectSelect.value = currentSubject.id;
  render();
}

function escapeHtml(value = '') {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getQuestionResponse(q) {
  if (q.type === 'single') {
    const checked = document.querySelector(`input[name="q-${q.id}"]:checked`);
    return checked ? checked.value : '';
  }
  if (q.type === 'multi') {
    return [...document.querySelectorAll(`input[name="q-${q.id}"]:checked`)]
      .map(el => el.value)
      .sort()
      .join('');
  }
  if (q.type === 'fill') {
    return q.blanks.map(blank => {
      const el = document.querySelector(`input[name="blank-${blank.id}"]`);
      return (el?.value || '').trim();
    });
  }
  return '';
}

function renderSummary(correct = '-', score = '-') {
  summarySubject.textContent = currentSubject.name;
  summaryCount.textContent = currentSubject.questions.length;
  summaryCorrect.textContent = correct;
  summaryScore.textContent = score;
  subjectNote.textContent = currentSubject.note || '';
}

function renderQuestion(q, idx) {
  const box = document.createElement('div');
  box.className = 'question';
  box.dataset.qid = q.id;

  let body = '';
  if (q.type === 'fill') {
    body = `
      <div class="fill-grid">
        ${q.blanks.map((blank, i) => `
          <label class="fill-box">
            <span>第 ${i + 1} 格</span>
            <input type="text" name="blank-${blank.id}" autocomplete="off" />
          </label>
        `).join('')}
      </div>
    `;
  } else {
    const inputType = q.type === 'multi' ? 'checkbox' : 'radio';
    body = `
      <div class="choices">
        ${q.choices.map(c => `
          <label class="choice">
            <input type="${inputType}" name="q-${q.id}" value="${c.key}">
            <div><strong>${c.key}.</strong> ${escapeHtml(c.text)}</div>
          </label>
        `).join('')}
      </div>
    `;
  }

  box.innerHTML = `
    <div class="qhead">
      <h3>第 ${idx + 1} 題</h3>
      <div class="meta">配分：${q.score}｜題型：${q.type === 'single' ? '單選' : q.type === 'multi' ? '多選' : '選填'}</div>
    </div>
    <div class="stem">${escapeHtml(q.stem)}</div>
    ${body}
    <div class="result hidden"></div>
  `;

  questionsEl.appendChild(box);
}

function render() {
  renderSummary();
  questionsEl.innerHTML = '';
  currentSubject.questions.forEach(renderQuestion);
}

function gradeSingleOrMulti(q, response) {
  const answer = q.answer;
  return {
    correct: response === answer,
    userText: response || '未作答',
    answerText: answer,
    score: response === answer ? q.score : 0
  };
}

function gradeFill(q, response) {
  const userParts = response;
  const ok = q.blanks.every((blank, i) => userParts[i] === String(blank.answer));
  return {
    correct: ok,
    userText: userParts.map((v, i) => `第${i + 1}格：${v || '未作答'}`).join('｜'),
    answerText: q.blanks.map((blank, i) => `第${i + 1}格：${blank.answer}`).join('｜'),
    score: ok ? q.score : 0
  };
}

function grade() {
  let correctCount = 0;
  let totalScore = 0;

  currentSubject.questions.forEach(q => {
    const box = document.querySelector(`.question[data-qid="${q.id}"]`);
    const resultEl = box.querySelector('.result');
    const response = getQuestionResponse(q);
    const result = q.type === 'fill' ? gradeFill(q, response) : gradeSingleOrMulti(q, response);

    box.classList.remove('correct', 'wrong');
    box.classList.add(result.correct ? 'correct' : 'wrong');
    resultEl.classList.remove('hidden');
    resultEl.innerHTML = `${result.correct ? '<span class="ok">答對</span>' : '<span class="bad">答錯</span>'}｜你的答案：${escapeHtml(result.userText)}<br>正確答案：${escapeHtml(result.answerText)}`;

    if (result.correct) correctCount += 1;
    totalScore += result.score;
  });

  renderSummary(correctCount, `${totalScore} / ${currentSubject.fullScore}`);
}

subjectSelect.addEventListener('change', () => {
  currentSubject = data.subjects.find(s => s.id === subjectSelect.value);
  render();
});
submitBtn.addEventListener('click', grade);
resetBtn.addEventListener('click', render);

initSubjects();

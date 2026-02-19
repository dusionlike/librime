import { createRimeEngine, type RimeEngine, type RimeState } from '../src/index';

let engine: RimeEngine;
let outputText = '';

const statusEl = document.getElementById('status')!;
const inputEl = document.getElementById('input-box') as HTMLInputElement;
const preeditEl = document.getElementById('preedit')!;
const pageInfoEl = document.getElementById('page-info')!;
const candidatesEl = document.getElementById('candidates')!;
const outputEl = document.getElementById('output')!;

function renderState(state: RimeState) {
  // Handle committed text
  if (state.committed) {
    outputText += state.committed;
    outputEl.textContent = outputText;
    // Clear input after commit
    inputEl.value = '';
  }

  // Render preedit
  if (state.preeditHead || state.preeditBody || state.preeditTail) {
    preeditEl.innerHTML =
      escapeHtml(state.preeditHead) +
      '<span class="body">' + escapeHtml(state.preeditBody) + '</span>' +
      escapeHtml(state.preeditTail);
  } else {
    preeditEl.innerHTML = '';
  }

  // Render page info
  if (state.candidates.length > 0) {
    pageInfoEl.textContent = `Page ${state.pageNo + 1}${state.isLastPage ? ' (last)' : ''}`;
  } else {
    pageInfoEl.textContent = '';
  }

  // Render candidates
  candidatesEl.innerHTML = '';
  state.candidates.forEach((cand, i) => {
    const li = document.createElement('li');
    const label = state.selectLabels[i] ?? String(i + 1);
    let html = `<strong>${label}.</strong> ${escapeHtml(cand.text)}`;
    if (cand.comment) {
      html += ` <span class="comment">${escapeHtml(cand.comment)}</span>`;
    }
    li.innerHTML = html;
    if (i === state.highlightedIndex) li.className = 'active';
    li.addEventListener('click', () => {
      const newState = engine.pickCandidate(i);
      renderState(newState);
    });
    candidatesEl.appendChild(li);
  });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function clearState() {
  engine.clearInput();
  preeditEl.innerHTML = '';
  pageInfoEl.textContent = '';
  candidatesEl.innerHTML = '';
  inputEl.value = '';
}

async function main() {
  const t0 = performance.now();

  try {
    engine = await createRimeEngine({
      wasmDir: '',
    });

    const elapsed = Math.round(performance.now() - t0);
    const version = engine.getVersion();
    statusEl.textContent = `Rime ${version} ready (loaded in ${elapsed}ms)`;
    statusEl.className = 'ready';
    inputEl.disabled = false;
    inputEl.focus();
  } catch (e) {
    statusEl.textContent = `Error: ${e}`;
    statusEl.className = 'error';
    console.error('Failed to initialize Rime:', e);
    return;
  }

  // Track composition state for incremental input
  let lastInput = '';

  inputEl.addEventListener('keydown', (ev) => {
    // Escape clears composition
    if (ev.key === 'Escape') {
      clearState();
      ev.preventDefault();
      return;
    }

    // Number keys select candidates when menu is visible
    if (ev.key >= '1' && ev.key <= '9' && candidatesEl.children.length > 0) {
      const index = parseInt(ev.key) - 1;
      if (index < candidatesEl.children.length) {
        const state = engine.pickCandidate(index);
        renderState(state);
        lastInput = '';
        ev.preventDefault();
        return;
      }
    }

    // Page navigation
    if (ev.key === 'PageDown' || (ev.key === '=' && candidatesEl.children.length > 0)) {
      renderState(engine.flipPage(true));
      ev.preventDefault();
      return;
    }
    if (ev.key === 'PageUp' || (ev.key === '-' && candidatesEl.children.length > 0)) {
      renderState(engine.flipPage(false));
      ev.preventDefault();
      return;
    }

    // Enter commits current composition
    if (ev.key === 'Enter' && candidatesEl.children.length > 0) {
      const state = engine.pickCandidate(0);
      renderState(state);
      lastInput = '';
      ev.preventDefault();
      return;
    }
  });

  inputEl.addEventListener('input', () => {
    const val = inputEl.value;
    if (!val) {
      clearState();
      lastInput = '';
      return;
    }

    // Reset and re-process the full input each time
    engine.clearInput();
    const state = engine.processInput(val);
    renderState(state);
    lastInput = val;
  });
}

main();

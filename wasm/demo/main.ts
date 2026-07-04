import { createRimeEngine, type RimeEngine, type RimeState } from '../src/index';

let engine: RimeEngine;
let outputText = '';
let isSimplified = false;

const statusEl = document.getElementById('status')!;
const inputEl = document.getElementById('input-box') as HTMLInputElement;
const preeditEl = document.getElementById('preedit')!;
const pageInfoEl = document.getElementById('page-info')!;
const candidatesEl = document.getElementById('candidates')!;
const outputEl = document.getElementById('output')!;
const toggleSimpEl = document.getElementById('toggle-simp') as HTMLButtonElement;
const nextPageEl = document.getElementById('next-page') as HTMLButtonElement;

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
    li.innerHTML = html;
    if (i === state.highlightedIndex) li.className = 'active';
    li.addEventListener('click', async () => {
      renderState(await engine.pickCandidate(i));
    });
    candidatesEl.appendChild(li);
  });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function clearState() {
  await engine.clearInput();
  preeditEl.innerHTML = '';
  pageInfoEl.textContent = '';
  candidatesEl.innerHTML = '';
  inputEl.value = '';
}

async function main() {
  const t0 = performance.now();

  try {
    statusEl.textContent = 'Loading Rime WASM...';

    // 一步到位：加载 WASM + 加载预编译数据，createRimeEngine 内部处理缓存
    engine = await createRimeEngine({ wasmDir: '' });

    const elapsed = Math.round(performance.now() - t0);
    const version = engine.getDictVersion();
    statusEl.textContent = `Rime ready (loaded in ${elapsed}ms)` + (version ? `, dictVersion: ${version}` : '');
    statusEl.className = 'ready';
    inputEl.disabled = false;
    inputEl.focus();

    // 输入框失去焦点时将用户词典持久化到 IndexedDB
    // 使用 setTimeout(0) 将 sync 推迟到 click 事件（选词）之后执行，
    // 避免 blur 先于 click 触发导致 syncData 抢占了 mutex
    inputEl.addEventListener('blur', () => {
      setTimeout(() => {
        engine.syncData().catch(() => {});
      }, 0);
    });

    // Toggle Traditional/Simplified
    toggleSimpEl.addEventListener('click', async () => {
      isSimplified = !isSimplified;
      await engine.setOption('zh_simp', isSimplified);
      toggleSimpEl.classList.toggle('active', isSimplified);
      toggleSimpEl.textContent = isSimplified ? '简' : '繁';
    });

    // Next page (forward)
    nextPageEl.addEventListener('click', async () => {
      renderState(await engine.flipPage(true));
    });
  } catch (e) {
    statusEl.textContent = `Error: ${e}`;
    statusEl.className = 'error';
    console.error('Failed to initialize Rime:', e);
    return;
  }

  inputEl.addEventListener('keydown', async (ev) => {
    // Escape clears composition
    if (ev.key === 'Escape') {
      ev.preventDefault();
      await clearState();
      return;
    }

    // Number keys select candidates when menu is visible
    if (ev.key >= '1' && ev.key <= '9' && candidatesEl.children.length > 0) {
      const index = parseInt(ev.key) - 1;
      if (index < candidatesEl.children.length) {
        ev.preventDefault();
        const state = await engine.pickCandidate(index);
        renderState(state);
        return;
      }
    }

    // Page navigation
    if (ev.key === 'PageDown' || (ev.key === '=' && candidatesEl.children.length > 0)) {
      ev.preventDefault();
      renderState(await engine.flipPage(true));
      return;
    }
    if (ev.key === 'PageUp' || (ev.key === '-' && candidatesEl.children.length > 0)) {
      ev.preventDefault();
      renderState(await engine.flipPage(false));
      return;
    }

    // Enter commits current composition
    if (ev.key === 'Enter' && candidatesEl.children.length > 0) {
      ev.preventDefault();
      const state = await engine.pickCandidate(0);
      renderState(state);
      return;
    }
  });

  inputEl.addEventListener('input', async () => {
    const val = inputEl.value;
    if (!val) {
      await clearState();
      return;
    }

    // Reset and re-process the full input each time
    await engine.clearInput();
    const state = await engine.processInput(val);
    renderState(state);
  });
}

main();

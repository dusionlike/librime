import type { RimeEngine, RimeState, RimeWasmOptions, CompiledFiles, SourceFiles, CompiledBuffers, SourceBuffers } from './types';

export type { RimeEngine, RimeState, RimeCandidate, RimeWasmOptions, CompiledFiles, SourceFiles, CompiledBuffers, SourceBuffers } from './types';

interface EmscriptenModule {
  ccall(
    ident: string,
    returnType: string | null,
    argTypes: string[],
    args: unknown[],
  ): unknown;
  FS: {
    mkdir(path: string): void;
    mount(type: unknown, opts: Record<string, unknown>, mountpoint: string): void;
    syncfs(populate: boolean, callback: (err: unknown) => void): void;
    writeFile(path: string, data: Uint8Array): void;
    readFile(path: string, opts?: { encoding?: string; flags?: string }): Uint8Array;
    filesystems: { IDBFS: unknown };
  };
}

function syncfs(module: EmscriptenModule, populate: boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    module.FS.syncfs(populate, (err: unknown) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function loadModule(wasmDir: string): Promise<EmscriptenModule> {
  const scriptUrl = `${wasmDir}/rime-api.js`;
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const createRimeModule = (
    await import(/* @vite-ignore */ /* webpackIgnore: true */ scriptUrl)
  ).default;
  return createRimeModule({
    locateFile(file: string) {
      return `${wasmDir}/${file}`;
    },
  }) as Promise<EmscriptenModule>;
}

async function fetchBuffer(url: string): Promise<Uint8Array> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`获取 ${url} 失败: ${resp.status}`);
  return new Uint8Array(await resp.arrayBuffer());
}

function writeBuffers(
  module: EmscriptenModule,
  buffers: Record<string, Uint8Array>,
  destDir: string,
): void {
  for (const [file, data] of Object.entries(buffers)) {
    module.FS.writeFile(`${destDir}/${file}`, data);
  }
}

/**
 * 创建 Rime 输入法引擎实例。
 * 此方法只加载 WASM 模块，不加载词库数据。
 * 加载词库需要调用 loadCompiled / compileAndLoad 或对应的 FromBuffers 方法。
 */
export async function createRimeEngine(
  options: RimeWasmOptions = {},
): Promise<RimeEngine> {
  const wasmDir = options.wasmDir ?? '.';
  const Module = await loadModule(wasmDir);

  // 确保目录存在
  try { Module.FS.mkdir('/rime'); } catch { /* 已存在 */ }
  try { Module.FS.mkdir('/rime/build'); } catch { /* 已存在 */ }
  try { Module.FS.mkdir('/rime_user'); } catch { /* 已存在 */ }

  Module.FS.mount(Module.FS.filesystems.IDBFS, {}, '/rime_user');
  await syncfs(Module, true);

  let loaded = false;
  let destroyed = false;

  async function initEngine(): Promise<void> {
    const rc = Module.ccall('rime_wasm_init', 'number', [], []) as number;
    if (rc !== 0) {
      throw new Error(`rime_wasm_init 失败，返回码: ${rc}`);
    }
    loaded = true;
    await syncfs(Module, false);
  }

  function callJson(fn: string, argTypes: string[], args: unknown[]): RimeState {
    if (destroyed) throw new Error('引擎已被销毁');
    if (!loaded) throw new Error('引擎未初始化，请先调用 loadCompiled / compileAndLoad');
    const json = Module.ccall(fn, 'string', argTypes, args) as string;
    return JSON.parse(json) as RimeState;
  }

  const engine: RimeEngine = {
    async loadCompiled(files: CompiledFiles): Promise<RimeEngine> {
      if (loaded) throw new Error('引擎已初始化，请勿重复调用');
      const buffers: Record<string, Uint8Array> = {};
      for (const [file, url] of Object.entries(files)) {
        buffers[file] = await fetchBuffer(url as string);
      }
      writeBuffers(Module, buffers, '/rime/build');
      await initEngine();
      return engine;
    },

    async compileAndLoad(files: SourceFiles): Promise<RimeEngine> {
      if (loaded) throw new Error('引擎已初始化，请勿重复调用');
      const buffers: Record<string, Uint8Array> = {};
      for (const [file, url] of Object.entries(files)) {
        buffers[file] = await fetchBuffer(url as string);
      }
      writeBuffers(Module, buffers, '/rime');
      const rc = Module.ccall('rime_wasm_precompile', 'number', [], []) as number;
      if (rc !== 0) {
        throw new Error(`rime_wasm_precompile 失败，返回码: ${rc}`);
      }
      await initEngine();
      return engine;
    },

    async loadCompiledFromBuffers(buffers: CompiledBuffers): Promise<RimeEngine> {
      if (loaded) throw new Error('引擎已初始化，请勿重复调用');
      writeBuffers(Module, buffers, '/rime/build');
      await initEngine();
      return engine;
    },

    async compileAndLoadFromBuffers(buffers: SourceBuffers): Promise<RimeEngine> {
      if (loaded) throw new Error('引擎已初始化，请勿重复调用');
      writeBuffers(Module, buffers, '/rime');
      const rc = Module.ccall('rime_wasm_precompile', 'number', [], []) as number;
      if (rc !== 0) {
        throw new Error(`rime_wasm_precompile 失败，返回码: ${rc}`);
      }
      await initEngine();
      return engine;
    },

    processInput(keys: string): RimeState {
      return callJson('rime_wasm_process_input', ['string'], [keys]);
    },

    pickCandidate(index: number): RimeState {
      const state = callJson('rime_wasm_pick_candidate', ['number'], [index]);
      syncfs(Module, false).catch(() => {});
      return state;
    },

    flipPage(forward: boolean): RimeState {
      return callJson('rime_wasm_flip_page', ['number'], [forward ? 0 : 1]);
    },

    clearInput(): void {
      if (destroyed) return;
      Module.ccall('rime_wasm_clear_input', null, [], []);
    },

    setOption(name: string, value: boolean): void {
      if (destroyed) return;
      Module.ccall('rime_wasm_set_option', null, ['string', 'number'], [name, value ? 1 : 0]);
    },

    getVersion(): string {
      if (destroyed) return 'unknown';
      return Module.ccall('rime_wasm_get_version', 'string', [], []) as string;
    },

    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      Module.ccall('rime_wasm_destroy', null, [], []);
      syncfs(Module, false).catch(() => {});
    },
  };

  return engine;
}

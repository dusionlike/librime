import type { RimeEngine, RimeState, RimeWasmOptions } from './types';

export type { RimeEngine, RimeState, RimeCandidate, RimeWasmOptions } from './types';

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

export async function createRimeEngine(
  options: RimeWasmOptions = {},
): Promise<RimeEngine> {
  const wasmDir = options.wasmDir ?? '.';
  const scriptUrl = `${wasmDir}/rime-api.js`;

  // Load the Emscripten module factory
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const createRimeModule = (
    await import(/* @vite-ignore */ /* webpackIgnore: true */ scriptUrl)
  ).default;

  const Module: EmscriptenModule = await createRimeModule({
    locateFile(file: string) {
      return `${wasmDir}/${file}`;
    },
  });

  // Set up persistent filesystem
  try {
    Module.FS.mkdir('/rime_user');
  } catch {
    // Directory may already exist
  }
  Module.FS.mount(Module.FS.filesystems.IDBFS, {}, '/rime_user');
  await syncfs(Module, true);

  // Initialize the engine
  const rc = Module.ccall('rime_wasm_init', 'number', [], []) as number;
  if (rc !== 0) {
    throw new Error(`rime_wasm_init failed with code ${rc}`);
  }

  // Persist after initial deploy
  await syncfs(Module, false);

  let destroyed = false;

  function callJson(fn: string, argTypes: string[], args: unknown[]): RimeState {
    if (destroyed) throw new Error('Engine is destroyed');
    const json = Module.ccall(fn, 'string', argTypes, args) as string;
    return JSON.parse(json) as RimeState;
  }

  const engine: RimeEngine = {
    processInput(keys: string): RimeState {
      return callJson('rime_wasm_process_input', ['string'], [keys]);
    },

    pickCandidate(index: number): RimeState {
      const state = callJson('rime_wasm_pick_candidate', ['number'], [index]);
      // Persist user dictionary after candidate selection
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

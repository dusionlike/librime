export interface RimeCandidate {
  text: string;
  comment: string;
}

export interface RimeState {
  /** Committed (finalized) text, or null if nothing was committed. */
  committed: string | null;
  /** Preedit text before the selection. */
  preeditHead: string;
  /** Currently selected portion of preedit. */
  preeditBody: string;
  /** Preedit text after the selection. */
  preeditTail: string;
  /** Cursor position in preedit. */
  cursorPos: number;
  /** List of candidates on the current page. */
  candidates: RimeCandidate[];
  /** Current page number (0-based). */
  pageNo: number;
  /** Whether this is the last page of candidates. */
  isLastPage: boolean;
  /** Index of the highlighted candidate. */
  highlightedIndex: number;
  /** Labels for candidate selection keys. */
  selectLabels: string[];
}

export interface RimeEngine {
  /** Send a key sequence (e.g., "nihao") and get updated state. */
  processInput(keys: string): RimeState;
  /** Select a candidate by index on the current page. */
  pickCandidate(index: number): RimeState;
  /** Navigate to next or previous page of candidates. */
  flipPage(forward: boolean): RimeState;
  /** Clear current composition. */
  clearInput(): void;
  /** Set a boolean option (e.g., "ascii_mode"). */
  setOption(name: string, value: boolean): void;
  /** Get the librime version string. */
  getVersion(): string;
  /** Shut down the engine and free resources. */
  destroy(): void;
}

export interface RimeWasmOptions {
  /**
   * URL or path prefix for rime-api.js, rime-api.wasm,
   * and all data files (YAML configs + binary dictionaries).
   * Defaults to current directory.
   */
  wasmDir?: string;
  /**
   * List of data filenames to fetch and load at startup.
   * Files are fetched from `wasmDir` and written to `/rime/build/` in
   * the virtual filesystem before engine initialization.
   * Defaults to luna_pinyin schema and dictionary files plus config YAMLs.
   */
  dataFiles?: string[];
}

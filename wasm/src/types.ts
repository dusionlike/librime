export interface RimeCandidate {
  text: string;
  comment: string;
}

export interface RimeState {
  /** 已提交（确认）的文本，若无提交则为 null。 */
  committed: string | null;
  /** 预编辑文本中光标前的部分。 */
  preeditHead: string;
  /** 预编辑文本中当前选中的部分。 */
  preeditBody: string;
  /** 预编辑文本中光标后的部分。 */
  preeditTail: string;
  /** 预编辑文本中的光标位置。 */
  cursorPos: number;
  /** 当前页的候选词列表。 */
  candidates: RimeCandidate[];
  /** 当前页码（从 0 开始）。 */
  pageNo: number;
  /** 是否为候选词的最后一页。 */
  isLastPage: boolean;
  /** 高亮候选项的索引。 */
  highlightedIndex: number;
  /** 候选词选择键的标签。 */
  selectLabels: string[];
}

/** 预编译数据的文件列表（键为文件名，值为 URL） */
export interface CompiledFiles {
  'default.yaml': string;
  'luna_pinyin.schema.yaml': string;
  'luna_pinyin.table.bin': string;
  'luna_pinyin.prism.bin': string;
  'luna_pinyin.reverse.bin': string;
}

/** 源数据文件列表（键为文件名，值为 URL） */
export interface SourceFiles {
  'default.yaml': string;
  'luna_pinyin.schema.yaml': string;
  'luna_pinyin.dict.yaml': string;
  'symbols.yaml': string;
  'essay.txt': string;
}

/** 预编译数据的缓冲区（键为文件名，值为二进制内容） */
export type CompiledBuffers = {
  [K in keyof CompiledFiles]: Uint8Array;
};

/** 源数据的缓冲区（键为文件名，值为二进制内容） */
export type SourceBuffers = {
  [K in keyof SourceFiles]: Uint8Array;
};

export interface RimeEngine {
  /** 从 URL 获取预编译好的词典数据并初始化引擎。 */
  loadCompiled(files: CompiledFiles): Promise<RimeEngine>;
  /** 从 URL 获取源数据文件，在 WASM 中编译并初始化引擎。 */
  compileAndLoad(files: SourceFiles): Promise<RimeEngine>;
  /** 从内存缓冲区加载预编译好的词典数据并初始化引擎。 */
  loadCompiledFromBuffers(buffers: CompiledBuffers): Promise<RimeEngine>;
  /** 从内存缓冲区获取源数据，在 WASM 中编译并初始化引擎。 */
  compileAndLoadFromBuffers(buffers: SourceBuffers): Promise<RimeEngine>;
  /** 发送按键序列（如 "nihao"）并获取更新后的状态。 */
  processInput(keys: string): RimeState;
  /** 在当前页按索引选择候选词。 */
  pickCandidate(index: number): RimeState;
  /** 翻到候选词的下一页或上一页。 */
  flipPage(forward: boolean): RimeState;
  /** 清除当前输入。 */
  clearInput(): void;
  /** 设置布尔选项（如 "ascii_mode"）。 */
  setOption(name: string, value: boolean): void;
  /** 获取 librime 版本号字符串。 */
  getVersion(): string;
  /** 关闭引擎并释放资源。 */
  destroy(): void;
}

export interface RimeWasmOptions {
  /** rime-api.js、rime-api.wasm 所在 URL 或路径前缀。默认为当前目录。 */
  wasmDir?: string;
}

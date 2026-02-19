# rime-wasm

[librime](https://github.com/rime/librime) compiled to WebAssembly, packaged as an ESM library.

Includes the **luna_pinyin** (朙月拼音) schema and **OpenCC** for Traditional/Simplified conversion. glog, Lua plugin, and threading are disabled to reduce binary size.

## Output files

After building, `dist/` contains:

| File | Size | Description |
|------|------|-------------|
| `index.js` | 2.6 KB | TypeScript library entry point |
| `rime-api.wasm` | ~1.0 MB | WASM binary (librime + OpenCC + dependencies) |
| `rime-api.js` | 84 KB | Emscripten glue code |
| `rime-api.data` | ~1.0 MB | Embedded OpenCC dict data (preloaded by Emscripten) |
| `default.yaml` | 4 KB | Default engine config (fetched at runtime) |
| `luna_pinyin.schema.yaml` | 5 KB | Schema definition (fetched at runtime) |
| `luna_pinyin.table.bin` | 8.3 MB | Dictionary table (fetched at runtime) |
| `luna_pinyin.prism.bin` | 31 KB | Prism data (fetched at runtime) |
| `luna_pinyin.reverse.bin` | 131 KB | Reverse lookup data (fetched at runtime) |

**Data loading strategy:**
- **OpenCC dict** (`rime-api.data`): Embedded by Emscripten's `--preload-file`, automatically loaded in the virtual filesystem
- **Rime config & dictionaries**: Fetched at runtime via `fetch()` and written to the virtual filesystem before engine initialization. This allows all files to benefit from HTTP compression (gzip/brotli)

## Prerequisites

- [Emscripten SDK](https://emscripten.org/docs/getting_started/downloads.html) (emcc, em++, emar, emcmake)
- CMake >= 3.12
- Ninja
- Node.js >= 18

## Build

```bash
cd wasm

# Full build (all phases)
bash build.sh

# Or run individual phases:
bash build.sh patches   # Apply LevelDB patches
bash build.sh boost     # Download Boost headers (Boost.Regex used header-only via std::regex)
bash build.sh deps      # Build yaml-cpp, LevelDB, marisa-trie
bash build.sh opencc-native  # Build native OpenCC dict tool, generate .ocd2 data
bash build.sh opencc-wasm    # Build OpenCC for WASM
bash build.sh rime      # Build librime for WASM
bash build.sh native    # Build native rime_deployer
bash build.sh data      # Precompile dictionary data
bash build.sh wasm      # Compile final WASM binding

# Build TypeScript library
npx tsdown
```

## Usage

```typescript
import { createRimeEngine } from 'rime-wasm';

const engine = await createRimeEngine({
  // Path prefix where rime-api.js, rime-api.wasm, rime-api.data,
  // and *.bin files are served from.
  wasmDir: '/assets',
});

// Get version
console.log(engine.getVersion()); // "1.16.1"

// Process pinyin input
const state = engine.processInput('nihao');
console.log(state.candidates); // [{ text: "你好", comment: "" }, ...]
console.log(state.preeditBody); // "ni hao"

// Select a candidate (0-based index)
const committed = engine.pickCandidate(0);
console.log(committed.committed); // "你好"

// Page navigation
engine.processInput('shi');
engine.flipPage(true);  // next page
engine.flipPage(false); // previous page

// Clear current input
engine.clearInput();

// Set options
engine.setOption('ascii_mode', true);

// Clean up
engine.destroy();
```

### Options

```typescript
interface RimeWasmOptions {
  /** URL prefix for WASM files. Defaults to ".". */
  wasmDir?: string;
  /** Binary dictionary files to fetch at startup. Defaults to luna_pinyin files. */
  dataFiles?: string[];
}
```

### RimeState

Every input operation returns a `RimeState`:

```typescript
interface RimeState {
  committed: string | null;   // Text committed by this operation
  preeditHead: string;         // Preedit before selection
  preeditBody: string;         // Selected portion of preedit
  preeditTail: string;         // Preedit after selection
  cursorPos: number;
  candidates: RimeCandidate[]; // Current page of candidates
  pageNo: number;              // 0-based page number
  isLastPage: boolean;
  highlightedIndex: number;
  selectLabels: string[];      // Labels for selection keys ("1", "2", ...)
}
```

## Demo

```bash
npm run dev
```

Opens a browser page at `http://localhost:5173` with a simple pinyin input demo.

## Tests

```bash
# Install Playwright browsers (first time)
npx playwright install chromium

# Run E2E tests
npm test
```

12 E2E tests cover: engine initialization, pinyin input, candidate selection (keyboard and mouse), page navigation, escape to clear, multi-word sequences, and Traditional/Simplified conversion via OpenCC.

## Architecture

```
wasm/
  build.sh              # Build orchestrator (8 phases)
  binding/
    rime_wasm.cpp        # C++ binding layer (WASM ↔ librime)
  src/
    index.ts             # TypeScript API wrapper
    types.ts             # Type definitions
  data/
    *.yaml, essay.txt    # Source schema data (compile-time only)
  demo/
    index.html, main.ts  # Browser demo page
    vite.config.ts       # Vite dev server config
  tests/
    rime.spec.ts         # Playwright E2E tests
    playwright.config.ts
  patches/
    leveldb-sync-schedule.patch
  dist/                  # Build output (npm package content)
```

The build process:

1. **Patches** LevelDB for synchronous scheduling (no background threads in WASM)
2. **Boost** headers are installed; Boost.Regex uses `BOOST_REGEX_STANDALONE` to delegate to `std::regex` (no compiled library needed)
3. **Dependencies** (yaml-cpp, LevelDB, marisa-trie) are cross-compiled to WASM
4. **OpenCC** native dict tool generates `.ocd2` data; OpenCC library is cross-compiled to WASM (DARTS format disabled, only `.ocd2` needed)
5. **librime** is cross-compiled with OpenCC enabled; glog, threading, and Lua disabled
6. **Native tools** (rime_deployer) are built for the host, used to precompile dictionaries
7. **Data** is precompiled: `rime_deployer --build` converts YAML + essay.txt into binary .bin files
8. **WASM binding** links everything into rime-api.wasm with LTO, `-Oz`, and wasm-native exceptions (`-fwasm-exceptions`); all config YAMLs and dictionary files are copied to dist/ for runtime loading

### Size optimization techniques

The binary is optimized using several techniques that together reduce size from ~2.1MB to ~1.0MB:

- **`BOOST_REGEX_STANDALONE`**: Makes `boost::regex` a header-only wrapper over `std::regex`, eliminating `libboost_regex.a` (~400KB saved)
- **`-Oz` via `CMAKE_CXX_FLAGS_RELEASE`**: Size-optimized compilation for all WASM libraries and the final link
- **`-flto`**: Link-Time Optimization for cross-module dead code elimination
- **`-fwasm-exceptions`**: Native WebAssembly exception handling (smaller than setjmp-based emulation)
- **`ENABLE_DARTS=OFF`**: Disables legacy `.ocd` format in OpenCC (only `.ocd2` is used)
- **`wasm-opt -Oz --strip-producers`**: Binaryen post-processing for additional size reduction
- **`ELIMINATE_DUPLICATE_FUNCTIONS=1`**: Emscripten deduplication pass

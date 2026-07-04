#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$SCRIPT_DIR/build"
SYSROOT="$BUILD_DIR/sysroot"
NATIVE_DIR="$BUILD_DIR/native"
DIST_DIR="$SCRIPT_DIR/dist"

BOOST_VERSION="1.86.0"
BOOST_UNDERSCORE="1_86_0"
BOOST_DIR="$BUILD_DIR/boost_${BOOST_UNDERSCORE}"
EMSDK_CXXFLAGS="-flto -fwasm-exceptions -DBOOST_DISABLE_ASSERTS -DBOOST_DISABLE_CURRENT_LOCATION -DBOOST_REGEX_STANDALONE -ffile-prefix-map=$PROJECT_ROOT=."

CMAKE_COMMON=(
  -G Ninja
  -DCMAKE_BUILD_TYPE=Release
  -DBUILD_SHARED_LIBS=OFF
  "-DCMAKE_INSTALL_PREFIX=$SYSROOT"
  "-DCMAKE_CXX_FLAGS_RELEASE=-Oz -DNDEBUG"
  "-DCMAKE_C_FLAGS_RELEASE=-Oz -DNDEBUG"
)

EXPORTED_FUNCTIONS=(
  _rime_wasm_init
  _rime_wasm_process_input
  _rime_wasm_pick_candidate
  _rime_wasm_flip_page
  _rime_wasm_clear_input
  _rime_wasm_set_option
  _rime_wasm_get_version
  _rime_wasm_sync_data
  _rime_wasm_create_session
  _rime_wasm_destroy
  _rime_wasm_precompile
  _rime_wasm_read_file
  _rime_wasm_free
  _malloc
  _free
)

# ─── Helpers ────────────────────────────────────────────────────────────────

log() { echo "==> $*"; }

check_prerequisites() {
  local missing=()
  command -v emcc   >/dev/null 2>&1 || missing+=(emcc)
  command -v cmake  >/dev/null 2>&1 || missing+=(cmake)
  command -v ninja  >/dev/null 2>&1 || missing+=(ninja)
  if [[ ${#missing[@]} -gt 0 ]]; then
    echo "ERROR: Missing required tools: ${missing[*]}"
    echo "Please install them and activate the Emscripten SDK."
    exit 1
  fi
}

join_by() {
  local IFS="$1"; shift; echo "$*";
}

# ─── Phase 1: Apply patches ────────────────────────────────────────────────

apply_patches() {
  log "Applying patches..."

  local leveldb_dir="$PROJECT_ROOT/deps/leveldb"
  local patch_file="$SCRIPT_DIR/patches/leveldb-sync-schedule.patch"

  if [[ -f "$patch_file" ]]; then
    cd "$leveldb_dir"
    if ! git diff --quiet util/env_posix.cc 2>/dev/null; then
      log "LevelDB already patched, skipping."
    else
      git apply "$patch_file" || {
        log "Warning: patch may already be applied or failed."
      }
    fi
    cd "$SCRIPT_DIR"
  fi
}

# ─── Phase 2: Download and build Boost ─────────────────────────────────────

build_boost() {
  log "Preparing Boost..."

  if [[ ! -d "$BOOST_DIR" ]]; then
    log "Downloading Boost $BOOST_VERSION..."
    mkdir -p "$BUILD_DIR"
    local url="https://archives.boost.io/release/${BOOST_VERSION}/source/boost_${BOOST_UNDERSCORE}.tar.gz"
    curl -L "$url" -o "$BUILD_DIR/boost.tar.gz"
    tar xzf "$BUILD_DIR/boost.tar.gz" -C "$BUILD_DIR"
    rm -f "$BUILD_DIR/boost.tar.gz"
  fi

  # Install headers
  if [[ ! -d "$SYSROOT/include/boost" ]]; then
    log "Installing Boost headers..."
    mkdir -p "$SYSROOT/include"
    cp -r "$BOOST_DIR/boost" "$SYSROOT/include/"
  fi

  # Boost.Regex is used header-only via BOOST_REGEX_STANDALONE (delegates to std::regex)
  # No compiled library needed.
}

# ─── Phase 3: Build WASM dependencies ──────────────────────────────────────

build_yaml_cpp() {
  log "Building yaml-cpp..."
  local src="$PROJECT_ROOT/deps/yaml-cpp"
  local dst="$BUILD_DIR/yaml-cpp"
  rm -rf "$dst"
  mkdir -p "$dst"

  cd "$dst"
  CXXFLAGS="$EMSDK_CXXFLAGS" emcmake cmake "${CMAKE_COMMON[@]}" \
    -DYAML_CPP_BUILD_CONTRIB=OFF \
    -DYAML_CPP_BUILD_TESTS=OFF \
    -DYAML_CPP_BUILD_TOOLS=OFF \
    "$src"
  cmake --build .
  cmake --install .
  cd "$SCRIPT_DIR"
}

build_leveldb() {
  log "Building LevelDB..."
  local src="$PROJECT_ROOT/deps/leveldb"
  local dst="$BUILD_DIR/leveldb"
  rm -rf "$dst"
  mkdir -p "$dst"

  cd "$dst"
  CXXFLAGS="$EMSDK_CXXFLAGS" emcmake cmake "${CMAKE_COMMON[@]}" \
    -DLEVELDB_BUILD_BENCHMARKS=OFF \
    -DLEVELDB_BUILD_TESTS=OFF \
    "$src"
  cmake --build .
  cmake --install .
  cd "$SCRIPT_DIR"
}

build_marisa() {
  log "Building marisa-trie..."
  local src="$PROJECT_ROOT/deps/marisa-trie"
  local dst="$BUILD_DIR/marisa-trie"
  rm -rf "$dst"
  mkdir -p "$dst"

  cd "$dst"
  CXXFLAGS="$EMSDK_CXXFLAGS" emcmake cmake "${CMAKE_COMMON[@]}" \
    "$src"
  cmake --build .
  cmake --install .
  cd "$SCRIPT_DIR"
}

build_librime_wasm() {
  log "Building librime for WASM..."
  local dst="$BUILD_DIR/librime_wasm"
  rm -rf "$dst"
  mkdir -p "$dst"

  cd "$dst"
  CXXFLAGS="$EMSDK_CXXFLAGS" emcmake cmake "${CMAKE_COMMON[@]}" \
    -DBUILD_STATIC=ON \
    -DBUILD_TEST=OFF \
    -DENABLE_LOGGING=OFF \
    -DENABLE_OPENCC=OFF \
    -DENABLE_THREADING=OFF \
    -DENABLE_TIMESTAMP=OFF \
    -DENABLE_EXTERNAL_PLUGINS=OFF \
    "-DCMAKE_FIND_ROOT_PATH=$SYSROOT" \
    "-DBoost_INCLUDE_DIR=$SYSROOT/include" \
    "$PROJECT_ROOT"
  cmake --build .
  cmake --install .
  cd "$SCRIPT_DIR"
}

# ─── Phase 5: Prepare source data for WASM preloading ───────────────────

prepare_source_data() {
  log "Preparing source data for WASM..."
  local data_dir="$BUILD_DIR/rime_source_data"
  rm -rf "$data_dir"
  mkdir -p "$data_dir"

  # Copy source data files (YAML configs + dict + essay)
  cp "$SCRIPT_DIR"/data/*.yaml "$data_dir/"
  cp "$SCRIPT_DIR"/data/essay.txt "$data_dir/"
  log "Source data ready: $(ls "$data_dir")"
}

# ─── Phase 6: Build native tools (rime_deployer etc.) ──────────────────────

build_native_tools() {
  log "Building native librime tools..."
  local dst="$BUILD_DIR/native"
  rm -rf "$dst"
  mkdir -p "$dst"

  cd "$dst"
  cmake -G Ninja \
    -DCMAKE_BUILD_TYPE=Release \
    -DBUILD_TEST=OFF \
    -DBUILD_SHARED_LIBS=ON \
    -DENABLE_LOGGING=OFF \
    -DENABLE_OPENCC=OFF \
    -DENABLE_EXTERNAL_PLUGINS=OFF \
    "$PROJECT_ROOT"
  cmake --build .
  cd "$SCRIPT_DIR"

  # Verify rime_deployer was built
  if [[ ! -f "$dst/bin/rime_deployer" ]]; then
    # Maybe it's in tools/
    if [[ -f "$dst/tools/rime_deployer" ]]; then
      mkdir -p "$dst/bin"
      cp "$dst/tools/rime_deployer" "$dst/bin/"
    else
      log "Warning: rime_deployer not found, checking build output..."
      find "$dst" -name rime_deployer -type f 2>/dev/null
    fi
  fi
  log "Native tools built: $(ls "$dst/bin/" 2>/dev/null)"
}

# ─── Phase 6b: Precompile data with native deployer ─────────────────────────

precompile_data() {
  log "Precompiling data with native rime_deployer..."
  local native_bin="$BUILD_DIR/native/bin"
  local rime_data_dir="$BUILD_DIR/rime_data"
  rm -rf "$rime_data_dir"
  mkdir -p "$rime_data_dir"

  # Copy source data to working dir for deployer
  cp "$SCRIPT_DIR"/data/*.yaml "$rime_data_dir/"
  cp "$SCRIPT_DIR"/data/essay.txt "$rime_data_dir/"

  if [[ ! -f "$native_bin/rime_deployer" ]]; then
    log "Error: rime_deployer not found. Run 'build_native_tools' first."
    return 1
  fi

  # Run deployer (LD_LIBRARY_PATH to find librime.so)
  LD_LIBRARY_PATH="$BUILD_DIR/native/lib" \
    "$native_bin/rime_deployer" --build "$rime_data_dir"

  # Verify output
  local build_dir="$rime_data_dir/build"
  if [[ -d "$build_dir" ]]; then
    log "Precompiled data: $(ls "$build_dir")"
  else
    log "Warning: no build/ directory created; checking rime_data_dir..."
    ls -la "$rime_data_dir" 2>/dev/null
  fi
}

# ─── Phase 6c: Prepare distribution directories ─────────────────────────────

prepare_dist() {
  log "Preparing distribution..."

  # Compiled data → dist/bin/
  local compiled_dir="$DIST_DIR/bin"
  rm -rf "$compiled_dir"
  mkdir -p "$compiled_dir"

  # Source data → dist/source/
  local source_dir="$DIST_DIR/source"
  rm -rf "$source_dir"
  mkdir -p "$source_dir"

  # Copy compiled binary files from native deployer output
  local rime_data_build="$BUILD_DIR/rime_data/build"
  if [[ -d "$rime_data_build" ]]; then
    cp "$rime_data_build"/*.bin "$compiled_dir/" 2>/dev/null || true
    cp "$rime_data_build"/*.yaml "$compiled_dir/" 2>/dev/null || true
    log "Copied compiled data from $rime_data_build"
  else
    log "Warning: no precompiled data found at $rime_data_build"
  fi

  # Copy source data
  cp "$SCRIPT_DIR"/data/*.yaml "$source_dir/"
  cp "$SCRIPT_DIR"/data/essay.txt "$source_dir/"
  log "Copied source data to $source_dir"

  log "dist/bin/:  $(ls "$compiled_dir" 2>/dev/null)"
  log "dist/source/: $(ls "$source_dir" 2>/dev/null)"
}

# ─── Phase 7: Compile WASM binding ─────────────────────────────────────────

compile_wasm() {
  log "Compiling WASM binding..."
  mkdir -p "$DIST_DIR"

  local funcs
  funcs=$(join_by , "${EXPORTED_FUNCTIONS[@]}")

  em++ -std=c++17 -Oz -flto \
    $EMSDK_CXXFLAGS \
    -I"$SYSROOT/include" \
    -I"$PROJECT_ROOT/src" \
    -I"$PROJECT_ROOT/include" \
    -L"$SYSROOT/lib" \
    -s ALLOW_MEMORY_GROWTH=1 \
    -s MAXIMUM_MEMORY=4GB \
    -s STACK_SIZE=8388608 \
    -s MODULARIZE=1 \
    -s EXPORT_ES6=1 \
    -s ENVIRONMENT=web \
    -s "EXPORT_NAME=createRimeModule" \
    -s ELIMINATE_DUPLICATE_FUNCTIONS=1 \
    -s "EXPORTED_FUNCTIONS=[$funcs]" \
    -s 'EXPORTED_RUNTIME_METHODS=["ccall","FS","getValue","setValue"]' \
    -l idbfs.js \
    -Wl,--whole-archive -lrime -Wl,--no-whole-archive \
    -lyaml-cpp \
    -lleveldb \
    -lmarisa \
    -o "$DIST_DIR/rime-api.js" \
    "$SCRIPT_DIR/binding/rime_wasm.cpp"

  log "WASM build complete! (all data preloaded)"

  # Optional: additional size reduction via binaryen wasm-opt
  if command -v wasm-opt >/dev/null 2>&1; then
    log "Running wasm-opt -Oz for additional size reduction..."
    wasm-opt -Oz \
      --strip-producers \
      --enable-bulk-memory \
      --enable-nontrapping-float-to-int \
      --enable-exception-handling \
      "$DIST_DIR/rime-api.wasm" -o "$DIST_DIR/rime-api.wasm" \
      || log "Warning: wasm-opt failed, keeping em++ output"
    log "wasm-opt complete."
  fi

  ls -lh "$DIST_DIR"/rime-api.js "$DIST_DIR"/rime-api.wasm 2>/dev/null
}

# ─── Main ──────────────────────────────────────────────────────────────────

main() {
  log "Building rime-api.wasm"
  log "Project root: $PROJECT_ROOT"
  log "Build dir: $BUILD_DIR"

  check_prerequisites

  # Parse args for selective build
  local target="${1:-all}"

  case "$target" in
    patches)       apply_patches ;;
    boost)         build_boost ;;
    deps)          build_yaml_cpp; build_leveldb; build_marisa ;;
    rime)          build_librime_wasm ;;
    source-data)   prepare_source_data ;;
    native-tools)  build_native_tools ;;
    precompile)    build_native_tools; precompile_data; prepare_dist ;;
    wasm)          compile_wasm ;;
    all)
      apply_patches
      build_boost
      build_yaml_cpp
      build_leveldb
      build_marisa
      build_librime_wasm
      prepare_source_data
      compile_wasm
      build_native_tools
      precompile_data
      prepare_dist
      ;;
    dist)
      build_native_tools
      precompile_data
      prepare_dist
      ;;
    *)
      echo "Usage: $0 [patches|boost|deps|rime|source-data|native-tools|precompile|wasm|dist|all]"
      exit 1
      ;;
  esac

  log "Done."
}

main "$@"

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
EMSDK_CXXFLAGS="-fexceptions -DBOOST_DISABLE_ASSERTS -DBOOST_DISABLE_CURRENT_LOCATION"

CMAKE_COMMON=(
  -G Ninja
  -DCMAKE_BUILD_TYPE=Release
  -DBUILD_SHARED_LIBS=OFF
  "-DCMAKE_INSTALL_PREFIX=$SYSROOT"
)

EXPORTED_FUNCTIONS=(
  _rime_wasm_init
  _rime_wasm_process_input
  _rime_wasm_pick_candidate
  _rime_wasm_flip_page
  _rime_wasm_clear_input
  _rime_wasm_set_option
  _rime_wasm_get_version
  _rime_wasm_destroy
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

  # Build boost_regex with emscripten
  if [[ ! -f "$SYSROOT/lib/libboost_regex.a" ]]; then
    log "Building Boost.Regex for WASM..."
    local obj_dir="$BUILD_DIR/boost_regex_obj"
    mkdir -p "$obj_dir" "$SYSROOT/lib"

    for src in "$BOOST_DIR"/libs/regex/src/*.cpp; do
      local name
      name=$(basename "${src%.cpp}")
      em++ -c -O2 -std=c++17 $EMSDK_CXXFLAGS \
        -I"$BOOST_DIR" \
        "$src" -o "$obj_dir/${name}.o"
    done

    emar rcs "$SYSROOT/lib/libboost_regex.a" "$obj_dir"/*.o
    log "Boost.Regex built."
  fi
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

# ─── Phase 4: Build librime for WASM ───────────────────────────────────────

build_librime_wasm() {
  log "Building librime for WASM..."
  local dst="$BUILD_DIR/librime_wasm"
  rm -rf "$dst"
  mkdir -p "$dst"

  cd "$dst"
  CXXFLAGS="$EMSDK_CXXFLAGS -ffile-prefix-map=$PROJECT_ROOT=." emcmake cmake "${CMAKE_COMMON[@]}" \
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

# ─── Phase 5: Build native rime tools ──────────────────────────────────────

build_native_tools() {
  log "Building native rime tools..."
  rm -rf "$NATIVE_DIR"
  mkdir -p "$NATIVE_DIR"

  cd "$NATIVE_DIR"
  cmake -G Ninja \
    -DCMAKE_BUILD_TYPE=Release \
    -DBUILD_SHARED_LIBS=ON \
    -DBUILD_TEST=OFF \
    -DENABLE_LOGGING=OFF \
    -DENABLE_OPENCC=OFF \
    "$PROJECT_ROOT"
  cmake --build . --target rime_deployer
  cd "$SCRIPT_DIR"
}

# ─── Phase 6: Precompile dictionary data ───────────────────────────────────

precompile_data() {
  log "Precompiling rime data..."
  local data_dir="$BUILD_DIR/rime_data"
  rm -rf "$data_dir"
  mkdir -p "$data_dir"

  # Copy modified data files
  cp "$SCRIPT_DIR"/data/*.yaml "$data_dir/"
  cp "$SCRIPT_DIR"/data/essay.txt "$data_dir/"

  # Run native rime_deployer to build binary schemas
  local deployer="$NATIVE_DIR/bin/rime_deployer"
  if [[ ! -x "$deployer" ]]; then
    log "ERROR: rime_deployer not found at $deployer"
    exit 1
  fi

  "$deployer" --build "$data_dir" "$data_dir"
  log "Data precompiled: $(ls "$data_dir/build/" 2>/dev/null || echo 'no build dir')"

  # Strip compile-time-only files (not needed at runtime)
  log "Stripping compile-time files..."
  rm -f "$data_dir"/essay.txt
  rm -f "$data_dir"/*.dict.yaml
  rm -f "$data_dir"/symbols.yaml
  rm -f "$data_dir"/user.yaml
  rm -f "$data_dir"/default.yaml
  rm -f "$data_dir"/luna_pinyin.schema.yaml
  log "Runtime data: $(ls "$data_dir/build/")"
}

# ─── Phase 7: Compile WASM binding ─────────────────────────────────────────

compile_wasm() {
  log "Compiling WASM binding..."
  local data_dir="$BUILD_DIR/rime_data"
  mkdir -p "$DIST_DIR"

  # Copy all data files (YAML + binary) to dist/ for runtime loading
  log "Copying data files to dist/ for runtime loading..."
  cp "$data_dir/build/default.yaml" "$DIST_DIR/"
  cp "$data_dir/build/luna_pinyin.schema.yaml" "$DIST_DIR/"
  cp "$data_dir/build/luna_pinyin.table.bin" "$DIST_DIR/"
  cp "$data_dir/build/luna_pinyin.prism.bin" "$DIST_DIR/"
  cp "$data_dir/build/luna_pinyin.reverse.bin" "$DIST_DIR/"

  local funcs
  funcs=$(join_by , "${EXPORTED_FUNCTIONS[@]}")

  em++ -std=c++17 -O2 \
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
    -s "EXPORT_NAME=createRimeModule" \
    -s "EXPORTED_FUNCTIONS=[$funcs]" \
    -s 'EXPORTED_RUNTIME_METHODS=["ccall","FS"]' \
    -l idbfs.js \
    -Wl,--whole-archive -lrime -Wl,--no-whole-archive \
    -lyaml-cpp \
    -lleveldb \
    -lmarisa \
    -lboost_regex \
    -o "$DIST_DIR/rime-api.js" \
    "$SCRIPT_DIR/binding/rime_wasm.cpp"

  log "WASM build complete! (all data loaded at runtime)"
  ls -lh "$DIST_DIR"/rime-api.js "$DIST_DIR"/rime-api.wasm "$DIST_DIR"/*.yaml "$DIST_DIR"/*.bin
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
    patches)    apply_patches ;;
    boost)      build_boost ;;
    deps)       build_yaml_cpp; build_leveldb; build_marisa ;;
    rime)       build_librime_wasm ;;
    native)     build_native_tools ;;
    data)       precompile_data ;;
    wasm)       compile_wasm ;;
    all)
      apply_patches
      build_boost
      build_yaml_cpp
      build_leveldb
      build_marisa
      build_librime_wasm
      build_native_tools
      precompile_data
      compile_wasm
      ;;
    *)
      echo "Usage: $0 [patches|boost|deps|rime|native|data|wasm|all]"
      exit 1
      ;;
  esac

  log "Done."
}

main "$@"

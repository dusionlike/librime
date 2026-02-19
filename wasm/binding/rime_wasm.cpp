#include <cstring>
#include <string>
#include <vector>

#include <boost/json/src.hpp>
#include <emscripten.h>
#include <rime_api.h>

namespace rime_wasm {

// Engine state
RimeApi* api = nullptr;
RimeSessionId session = 0;
RimeCommit commit = {0};
RimeContext context = {0};
std::string json_buf;
bool engine_started = false;

const char* to_json_cstr(const boost::json::object& obj) {
  json_buf = boost::json::serialize(obj);
  return json_buf.c_str();
}

boost::json::object build_state() {
  boost::json::object result;

  // Check committed text
  api->free_commit(&commit);
  Bool has_commit = api->get_commit(session, &commit);
  if (has_commit && commit.text) {
    result["committed"] = commit.text;
  } else {
    result["committed"] = nullptr;
  }

  // Get context
  api->free_context(&context);
  api->get_context(session, &context);

  if (context.composition.length > 0 && context.composition.preedit) {
    std::string preedit(context.composition.preedit);
    int sel_start = context.composition.sel_start;
    int sel_end = context.composition.sel_end;

    result["preeditHead"] = preedit.substr(0, sel_start);
    result["preeditBody"] = preedit.substr(
        sel_start, sel_end - sel_start);
    result["preeditTail"] = preedit.substr(sel_end);
    result["cursorPos"] = context.composition.cursor_pos;

    // Candidates
    boost::json::array candidates;
    for (int i = 0; i < context.menu.num_candidates; ++i) {
      boost::json::object cand;
      cand["text"] = context.menu.candidates[i].text
                         ? context.menu.candidates[i].text
                         : "";
      if (context.menu.candidates[i].comment) {
        cand["comment"] = context.menu.candidates[i].comment;
      } else {
        cand["comment"] = "";
      }
      candidates.push_back(cand);
    }
    result["candidates"] = candidates;
    result["pageNo"] = context.menu.page_no;
    result["isLastPage"] = static_cast<bool>(context.menu.is_last_page);
    result["highlightedIndex"] = context.menu.highlighted_candidate_index;

    // Select labels
    boost::json::array labels;
    if (context.select_labels) {
      for (int i = 0; i < context.menu.num_candidates; ++i) {
        labels.push_back(context.select_labels[i]
                             ? context.select_labels[i]
                             : "");
      }
    } else if (context.menu.select_keys) {
      const char* keys = context.menu.select_keys;
      for (int i = 0;
           keys[i] && i < context.menu.num_candidates; ++i) {
        char buf[2] = {keys[i], '\0'};
        labels.push_back(buf);
      }
    }
    result["selectLabels"] = labels;
  } else {
    result["preeditHead"] = "";
    result["preeditBody"] = "";
    result["preeditTail"] = "";
    result["cursorPos"] = 0;
    result["candidates"] = boost::json::array();
    result["pageNo"] = 0;
    result["isLastPage"] = true;
    result["highlightedIndex"] = 0;
    result["selectLabels"] = boost::json::array();
  }

  return result;
}

}  // namespace rime_wasm

extern "C" {

EMSCRIPTEN_KEEPALIVE
int rime_wasm_init() {
  using namespace rime_wasm;

  api = rime_get_api();
  if (!api) return -1;

  RIME_STRUCT(RimeTraits, traits);
  traits.shared_data_dir = "/rime";
  traits.user_data_dir = "/rime_user";
  traits.app_name = "rime-wasm";
  traits.distribution_name = "Rime WASM";
  traits.distribution_code_name = "rime-wasm";
  traits.distribution_version = "1.16.1";

  api->setup(&traits);
  api->initialize(&traits);

  // Deploy schemas (synchronous in WASM)
  api->start_maintenance(true);

  // Create session
  session = api->create_session();
  if (!session) return -2;

  RIME_STRUCT_INIT(RimeCommit, commit);
  RIME_STRUCT_INIT(RimeContext, context);
  engine_started = true;

  return 0;
}

EMSCRIPTEN_KEEPALIVE
const char* rime_wasm_process_input(const char* keys) {
  using namespace rime_wasm;
  if (!api || !session || !keys) return "{}";

  api->simulate_key_sequence(session, keys);
  return to_json_cstr(build_state());
}

EMSCRIPTEN_KEEPALIVE
const char* rime_wasm_pick_candidate(int index) {
  using namespace rime_wasm;
  if (!api || !session) return "{}";

  api->select_candidate_on_current_page(session, index);
  return to_json_cstr(build_state());
}

EMSCRIPTEN_KEEPALIVE
const char* rime_wasm_flip_page(int backward) {
  using namespace rime_wasm;
  if (!api || !session) return "{}";

  api->change_page(session, backward ? True : False);
  return to_json_cstr(build_state());
}

EMSCRIPTEN_KEEPALIVE
void rime_wasm_clear_input() {
  using namespace rime_wasm;
  if (!api || !session) return;
  api->clear_composition(session);
}

EMSCRIPTEN_KEEPALIVE
void rime_wasm_set_option(const char* option, int value) {
  using namespace rime_wasm;
  if (!api || !session || !option) return;
  api->set_option(session, option, value ? True : False);
}

EMSCRIPTEN_KEEPALIVE
const char* rime_wasm_get_version() {
  using namespace rime_wasm;
  if (!api) return "unknown";
  return api->get_version();
}

EMSCRIPTEN_KEEPALIVE
void rime_wasm_destroy() {
  using namespace rime_wasm;
  if (!api) return;
  if (session) {
    api->destroy_session(session);
    session = 0;
  }
  api->finalize();
  engine_started = false;
}

}  // extern "C"

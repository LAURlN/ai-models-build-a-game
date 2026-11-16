#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

/* Minimal self-contained Node-API (N-API v8) ABI declarations resolved dynamically
 * from the host process (Node.js or Electron) via GetProcAddress. This avoids
 * needing Electron-specific .lib/.h files while remaining ABI-stable across Node/Electron. */

typedef struct napi_env__* napi_env;
typedef struct napi_value__* napi_value;
typedef struct napi_callback_info__* napi_callback_info;

typedef enum {
  napi_ok = 0,
} napi_status;

typedef napi_value (*napi_callback)(napi_env env, napi_callback_info info);

typedef struct {
  const char* utf8name;
  napi_value name;
  napi_callback method;
  napi_callback getter;
  napi_callback setter;
  napi_value value;
  int attributes;
  void* data;
} napi_property_descriptor;

typedef struct {
  int nm_version;
  unsigned int nm_flags;
  const char* nm_filename;
  napi_value (*nm_register_func)(napi_env env, napi_value exports);
  const char* nm_modname;
  void* nm_priv;
  void* reserved[4];
} napi_module;

typedef napi_status (*fn_napi_get_cb_info)(napi_env, napi_callback_info, size_t*, napi_value*, napi_value*, void**);
typedef napi_status (*fn_napi_get_value_uint32)(napi_env, napi_value, uint32_t*);
typedef napi_status (*fn_napi_get_value_bigint_uint64)(napi_env, napi_value, uint64_t*, int*);
typedef napi_status (*fn_napi_get_value_string_utf8)(napi_env, napi_value, char*, size_t, size_t*);
typedef napi_status (*fn_napi_get_named_property)(napi_env, napi_value, const char*, napi_value*);
typedef napi_status (*fn_napi_get_array_length)(napi_env, napi_value, uint32_t*);
typedef napi_status (*fn_napi_get_element)(napi_env, napi_value, uint32_t, napi_value*);
typedef napi_status (*fn_napi_create_object)(napi_env, napi_value*);
typedef napi_status (*fn_napi_create_uint32)(napi_env, uint32_t, napi_value*);
typedef napi_status (*fn_napi_create_bigint_uint64)(napi_env, uint64_t, napi_value*);
typedef napi_status (*fn_napi_get_boolean)(napi_env, int, napi_value*);
typedef napi_status (*fn_napi_set_named_property)(napi_env, napi_value, const char*, napi_value);
typedef napi_status (*fn_napi_define_properties)(napi_env, napi_value, size_t, const napi_property_descriptor*);
typedef napi_status (*fn_napi_throw_error)(napi_env, const char*, const char*);
typedef void (*fn_napi_module_register)(napi_module*);

static fn_napi_get_cb_info p_get_cb_info;
static fn_napi_get_value_uint32 p_get_value_uint32;
static fn_napi_get_value_bigint_uint64 p_get_value_bigint_uint64;
static fn_napi_get_value_string_utf8 p_get_value_string_utf8;
static fn_napi_get_named_property p_get_named_property;
static fn_napi_get_array_length p_get_array_length;
static fn_napi_get_element p_get_element;
static fn_napi_create_object p_create_object;
static fn_napi_create_uint32 p_create_uint32;
static fn_napi_create_bigint_uint64 p_create_bigint_uint64;
static fn_napi_get_boolean p_get_boolean;
static fn_napi_set_named_property p_set_named_property;
static fn_napi_define_properties p_define_properties;
static fn_napi_throw_error p_throw_error;

static void init_napi_procs(HMODULE host) {
  p_get_cb_info = (fn_napi_get_cb_info)GetProcAddress(host, "napi_get_cb_info");
  p_get_value_uint32 = (fn_napi_get_value_uint32)GetProcAddress(host, "napi_get_value_uint32");
  p_get_value_bigint_uint64 = (fn_napi_get_value_bigint_uint64)GetProcAddress(host, "napi_get_value_bigint_uint64");
  p_get_value_string_utf8 = (fn_napi_get_value_string_utf8)GetProcAddress(host, "napi_get_value_string_utf8");
  p_get_named_property = (fn_napi_get_named_property)GetProcAddress(host, "napi_get_named_property");
  p_get_array_length = (fn_napi_get_array_length)GetProcAddress(host, "napi_get_array_length");
  p_get_element = (fn_napi_get_element)GetProcAddress(host, "napi_get_element");
  p_create_object = (fn_napi_create_object)GetProcAddress(host, "napi_create_object");
  p_create_uint32 = (fn_napi_create_uint32)GetProcAddress(host, "napi_create_uint32");
  p_create_bigint_uint64 = (fn_napi_create_bigint_uint64)GetProcAddress(host, "napi_create_bigint_uint64");
  p_get_boolean = (fn_napi_get_boolean)GetProcAddress(host, "napi_get_boolean");
  p_set_named_property = (fn_napi_set_named_property)GetProcAddress(host, "napi_set_named_property");
  p_define_properties = (fn_napi_define_properties)GetProcAddress(host, "napi_define_properties");
  p_throw_error = (fn_napi_throw_error)GetProcAddress(host, "napi_throw_error");
}

static void throw_win32(napi_env env, const char* prefix, DWORD err) {
  char buf[256];
  wsprintfA(buf, "%s (Win32 error %lu)", prefix, (unsigned long)err);
  p_throw_error(env, NULL, buf);
}

static wchar_t* utf8_to_wide(const char* src) {
  if (!src) return NULL;
  int len = MultiByteToWideChar(CP_UTF8, 0, src, -1, NULL, 0);
  if (len <= 0) return NULL;
  wchar_t* out = (wchar_t*)malloc((size_t)len * sizeof(wchar_t));
  if (!out) return NULL;
  MultiByteToWideChar(CP_UTF8, 0, src, -1, out, len);
  return out;
}

static char* get_utf8_arg(napi_env env, napi_value val, size_t* out_len) {
  size_t len = 0;
  if (p_get_value_string_utf8(env, val, NULL, 0, &len) != napi_ok) return NULL;
  char* buf = (char*)malloc(len + 1);
  if (!buf) return NULL;
  size_t actual = 0;
  if (p_get_value_string_utf8(env, val, buf, len + 1, &actual) != napi_ok) {
    free(buf);
    return NULL;
  }
  buf[actual] = '\0';
  if (out_len) *out_len = actual;
  return buf;
}

static wchar_t* get_named_wide_prop(napi_env env, napi_value obj, const char* name) {
  napi_value prop = NULL;
  if (p_get_named_property(env, obj, name, &prop) != napi_ok || !prop) return NULL;
  char* utf8 = get_utf8_arg(env, prop, NULL);
  if (!utf8) return NULL;
  wchar_t* wide = utf8_to_wide(utf8);
  free(utf8);
  return wide;
}

/* createJob(): bigint */
static napi_value fn_create_job(napi_env env, napi_callback_info info) {
  (void)info;
  HANDLE hJob = CreateJobObjectW(NULL, NULL);
  if (!hJob) {
    throw_win32(env, "CreateJobObjectW failed", GetLastError());
    return NULL;
  }
  JOBOBJECT_EXTENDED_LIMIT_INFORMATION jeli;
  ZeroMemory(&jeli, sizeof(jeli));
  jeli.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
  if (!SetInformationJobObject(hJob, JobObjectExtendedLimitInformation, &jeli, sizeof(jeli))) {
    DWORD err = GetLastError();
    CloseHandle(hJob);
    throw_win32(env, "SetInformationJobObject failed", err);
    return NULL;
  }
  napi_value result = NULL;
  p_create_bigint_uint64(env, (uint64_t)(uintptr_t)hJob, &result);
  return result;
}

/* assignPid(jobHandle: bigint, pid: number): void */
static napi_value fn_assign_pid(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  p_get_cb_info(env, info, &argc, argv, NULL, NULL);
  if (argc < 2) {
    p_throw_error(env, NULL, "assignPid requires (jobHandle, pid)");
    return NULL;
  }
  uint64_t rawJob = 0;
  int lossless = 0;
  if (p_get_value_bigint_uint64(env, argv[0], &rawJob, &lossless) != napi_ok) {
    p_throw_error(env, NULL, "Invalid job handle");
    return NULL;
  }
  uint32_t pid = 0;
  if (p_get_value_uint32(env, argv[1], &pid) != napi_ok) {
    p_throw_error(env, NULL, "Invalid pid");
    return NULL;
  }
  HANDLE hProc = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE | SYNCHRONIZE, FALSE, pid);
  if (!hProc) {
    throw_win32(env, "OpenProcess failed", GetLastError());
    return NULL;
  }
  BOOL ok = AssignProcessToJobObject((HANDLE)(uintptr_t)rawJob, hProc);
  DWORD err = GetLastError();
  CloseHandle(hProc);
  if (!ok) {
    throw_win32(env, "AssignProcessToJobObject failed", err);
    return NULL;
  }
  napi_value res = NULL;
  p_get_boolean(env, 1, &res);
  return res;
}

/* spawnSuspendedAndAssign({ jobHandle, applicationName, commandLine, cwd, stdoutPath, stderrPath, envPairs })
 * Creates process with CREATE_SUSPENDED | CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT,
 * assigns it to the job object, resumes its primary thread, and returns { pid, stdinHandle }. */
static napi_value fn_spawn_suspended_and_assign(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  p_get_cb_info(env, info, &argc, argv, NULL, NULL);
  if (argc < 1) {
    p_throw_error(env, NULL, "spawnSuspendedAndAssign requires options object");
    return NULL;
  }
  napi_value opts = argv[0];

  napi_value jobProp = NULL;
  if (p_get_named_property(env, opts, "jobHandle", &jobProp) != napi_ok) {
    p_throw_error(env, NULL, "Missing jobHandle");
    return NULL;
  }
  uint64_t rawJob = 0;
  int lossless = 0;
  if (p_get_value_bigint_uint64(env, jobProp, &rawJob, &lossless) != napi_ok || rawJob == 0) {
    p_throw_error(env, NULL, "Invalid jobHandle");
    return NULL;
  }
  HANDLE hJob = (HANDLE)(uintptr_t)rawJob;

  wchar_t* appName = get_named_wide_prop(env, opts, "applicationName");
  wchar_t* cmdLine = get_named_wide_prop(env, opts, "commandLine");
  wchar_t* cwd = get_named_wide_prop(env, opts, "cwd");
  wchar_t* stdoutPath = get_named_wide_prop(env, opts, "stdoutPath");
  wchar_t* stderrPath = get_named_wide_prop(env, opts, "stderrPath");

  if (!cmdLine) {
    free(appName); free(cwd); free(stdoutPath); free(stderrPath);
    p_throw_error(env, NULL, "Missing commandLine");
    return NULL;
  }

  /* Build wide environment block if envPairs (string[] of "KEY=VAL") provided */
  wchar_t* envBlock = NULL;
  napi_value envProp = NULL;
  if (p_get_named_property(env, opts, "envPairs", &envProp) == napi_ok && envProp) {
    uint32_t envCount = 0;
    if (p_get_array_length(env, envProp, &envCount) == napi_ok && envCount > 0) {
      size_t totalChars = 1; /* trailing double null */
      wchar_t** wideItems = (wchar_t**)calloc(envCount, sizeof(wchar_t*));
      if (wideItems) {
        for (uint32_t i = 0; i < envCount; i++) {
          napi_value el = NULL;
          if (p_get_element(env, envProp, i, &el) == napi_ok && el) {
            char* s = get_utf8_arg(env, el, NULL);
            if (s) {
              wideItems[i] = utf8_to_wide(s);
              free(s);
              if (wideItems[i]) {
                totalChars += wcslen(wideItems[i]) + 1;
              }
            }
          }
        }
        envBlock = (wchar_t*)calloc(totalChars + 1, sizeof(wchar_t));
        if (envBlock) {
          size_t offset = 0;
          for (uint32_t i = 0; i < envCount; i++) {
            if (wideItems[i]) {
              size_t itemLen = wcslen(wideItems[i]) + 1;
              memcpy(envBlock + offset, wideItems[i], itemLen * sizeof(wchar_t));
              offset += itemLen;
            }
          }
          envBlock[offset] = L'\0';
        }
        for (uint32_t i = 0; i < envCount; i++) free(wideItems[i]);
        free(wideItems);
      }
    }
  }

  SECURITY_ATTRIBUTES sa;
  ZeroMemory(&sa, sizeof(sa));
  sa.nLength = sizeof(sa);
  sa.bInheritHandle = TRUE;

  HANDLE hStdinRead = NULL, hStdinWrite = NULL;
  if (!CreatePipe(&hStdinRead, &hStdinWrite, &sa, 0)) {
    DWORD err = GetLastError();
    free(appName); free(cmdLine); free(cwd); free(stdoutPath); free(stderrPath); free(envBlock);
    throw_win32(env, "CreatePipe stdin failed", err);
    return NULL;
  }
  SetHandleInformation(hStdinWrite, HANDLE_FLAG_INHERIT, 0);

  HANDLE hStdout = INVALID_HANDLE_VALUE;
  HANDLE hStderr = INVALID_HANDLE_VALUE;
  if (stdoutPath) {
    hStdout = CreateFileW(stdoutPath, FILE_APPEND_DATA, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, &sa, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
  }
  if (stderrPath) {
    hStderr = CreateFileW(stderrPath, FILE_APPEND_DATA, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, &sa, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
  }

  STARTUPINFOW si;
  ZeroMemory(&si, sizeof(si));
  si.cb = sizeof(si);
  si.dwFlags = STARTF_USESTDHANDLES | STARTF_USESHOWWINDOW;
  si.wShowWindow = SW_HIDE;
  si.hStdInput = hStdinRead;
  si.hStdOutput = (hStdout != INVALID_HANDLE_VALUE) ? hStdout : GetStdHandle(STD_OUTPUT_HANDLE);
  si.hStdError = (hStderr != INVALID_HANDLE_VALUE) ? hStderr : GetStdHandle(STD_ERROR_HANDLE);

  PROCESS_INFORMATION pi;
  ZeroMemory(&pi, sizeof(pi));

  DWORD flags = CREATE_SUSPENDED | CREATE_NO_WINDOW | (envBlock ? CREATE_UNICODE_ENVIRONMENT : 0);
  BOOL created = CreateProcessW(
    appName,
    cmdLine,
    NULL,
    NULL,
    TRUE,
    flags,
    envBlock,
    cwd,
    &si,
    &pi
  );
  DWORD createErr = GetLastError();

  CloseHandle(hStdinRead);
  if (hStdout != INVALID_HANDLE_VALUE) CloseHandle(hStdout);
  if (hStderr != INVALID_HANDLE_VALUE) CloseHandle(hStderr);
  free(appName); free(cmdLine); free(cwd); free(stdoutPath); free(stderrPath); free(envBlock);

  if (!created) {
    CloseHandle(hStdinWrite);
    throw_win32(env, "CreateProcessW failed", createErr);
    return NULL;
  }

  if (!AssignProcessToJobObject(hJob, pi.hProcess)) {
    DWORD assignErr = GetLastError();
    TerminateProcess(pi.hProcess, 1);
    CloseHandle(pi.hThread);
    CloseHandle(pi.hProcess);
    CloseHandle(hStdinWrite);
    throw_win32(env, "AssignProcessToJobObject failed", assignErr);
    return NULL;
  }

  ResumeThread(pi.hThread);
  CloseHandle(pi.hThread);
  CloseHandle(pi.hProcess);

  napi_value result = NULL, pidVal = NULL, stdinVal = NULL;
  p_create_object(env, &result);
  p_create_uint32(env, (uint32_t)pi.dwProcessId, &pidVal);
  p_create_bigint_uint64(env, (uint64_t)(uintptr_t)hStdinWrite, &stdinVal);
  p_set_named_property(env, result, "pid", pidVal);
  p_set_named_property(env, result, "stdinHandle", stdinVal);
  return result;
}

/* writeAndCloseHandle(handle: bigint, utf8Text: string): void */
static napi_value fn_write_and_close_handle(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  p_get_cb_info(env, info, &argc, argv, NULL, NULL);
  if (argc < 2) {
    p_throw_error(env, NULL, "writeAndCloseHandle requires (handle, text)");
    return NULL;
  }
  uint64_t rawHandle = 0;
  int lossless = 0;
  if (p_get_value_bigint_uint64(env, argv[0], &rawHandle, &lossless) != napi_ok || rawHandle == 0) {
    p_throw_error(env, NULL, "Invalid handle");
    return NULL;
  }
  HANDLE hPipe = (HANDLE)(uintptr_t)rawHandle;
  size_t textLen = 0;
  char* text = get_utf8_arg(env, argv[1], &textLen);
  if (!text) {
    CloseHandle(hPipe);
    p_throw_error(env, NULL, "Invalid text string");
    return NULL;
  }
  size_t offset = 0;
  while (offset < textLen) {
    DWORD chunk = (DWORD)((textLen - offset) > 65536 ? 65536 : (textLen - offset));
    DWORD written = 0;
    if (!WriteFile(hPipe, text + offset, chunk, &written, NULL)) {
      DWORD err = GetLastError();
      free(text);
      CloseHandle(hPipe);
      throw_win32(env, "WriteFile failed", err);
      return NULL;
    }
    offset += written;
  }
  FlushFileBuffers(hPipe);
  free(text);
  CloseHandle(hPipe);

  napi_value res = NULL;
  p_get_boolean(env, 1, &res);
  return res;
}

/* terminateJob(jobHandle: bigint, exitCode?: number): void */
static napi_value fn_terminate_job(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  p_get_cb_info(env, info, &argc, argv, NULL, NULL);
  if (argc < 1) {
    p_throw_error(env, NULL, "terminateJob requires jobHandle");
    return NULL;
  }
  uint64_t rawJob = 0;
  int lossless = 0;
  if (p_get_value_bigint_uint64(env, argv[0], &rawJob, &lossless) != napi_ok || rawJob == 0) {
    napi_value res = NULL;
    p_get_boolean(env, 0, &res);
    return res;
  }
  uint32_t exitCode = 1;
  if (argc >= 2) {
    p_get_value_uint32(env, argv[1], &exitCode);
  }
  HANDLE hJob = (HANDLE)(uintptr_t)rawJob;
  BOOL ok = TerminateJobObject(hJob, (UINT)exitCode);
  CloseHandle(hJob);
  napi_value res = NULL;
  p_get_boolean(env, ok ? 1 : 0, &res);
  return res;
}

/* closeJob(jobHandle: bigint): void */
static napi_value fn_close_job(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  p_get_cb_info(env, info, &argc, argv, NULL, NULL);
  if (argc < 1) {
    napi_value res = NULL;
    p_get_boolean(env, 0, &res);
    return res;
  }
  uint64_t rawJob = 0;
  int lossless = 0;
  if (p_get_value_bigint_uint64(env, argv[0], &rawJob, &lossless) == napi_ok && rawJob != 0) {
    CloseHandle((HANDLE)(uintptr_t)rawJob);
  }
  napi_value res = NULL;
  p_get_boolean(env, 1, &res);
  return res;
}

/* isProcessAlive(pid: number): boolean */
static napi_value fn_is_process_alive(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  p_get_cb_info(env, info, &argc, argv, NULL, NULL);
  uint32_t pid = 0;
  int alive = 0;
  if (argc >= 1 && p_get_value_uint32(env, argv[0], &pid) == napi_ok && pid > 0) {
    HANDLE hProc = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, FALSE, pid);
    if (hProc) {
      DWORD code = 0;
      if (GetExitCodeProcess(hProc, &code) && code == STILL_ACTIVE) {
        alive = 1;
      }
      CloseHandle(hProc);
    }
  }
  napi_value res = NULL;
  p_get_boolean(env, alive, &res);
  return res;
}

static HMODULE find_napi_host(void) {
  HMODULE h = GetModuleHandleW(NULL);
  if (h && GetProcAddress(h, "napi_define_properties")) return h;
  const wchar_t* candidates[] = { L"node.dll", L"libnode.dll", L"electron.exe", L"node.exe" };
  for (size_t i = 0; i < sizeof(candidates) / sizeof(candidates[0]); i++) {
    HMODULE mod = GetModuleHandleW(candidates[i]);
    if (mod && GetProcAddress(mod, "napi_define_properties")) return mod;
  }
  return h;
}

__declspec(dllexport) napi_value napi_register_module_v1(napi_env env, napi_value exports) {
  HMODULE host = find_napi_host();
  init_napi_procs(host);
  if (!p_define_properties) {
    return exports;
  }
  napi_property_descriptor props[] = {
    { "createJob", NULL, fn_create_job, NULL, NULL, NULL, 7, NULL },
    { "assignPid", NULL, fn_assign_pid, NULL, NULL, NULL, 7, NULL },
    { "spawnSuspendedAndAssign", NULL, fn_spawn_suspended_and_assign, NULL, NULL, NULL, 7, NULL },
    { "writeAndCloseHandle", NULL, fn_write_and_close_handle, NULL, NULL, NULL, 7, NULL },
    { "terminateJob", NULL, fn_terminate_job, NULL, NULL, NULL, 7, NULL },
    { "closeJob", NULL, fn_close_job, NULL, NULL, NULL, 7, NULL },
    { "isProcessAlive", NULL, fn_is_process_alive, NULL, NULL, NULL, 7, NULL }
  };
  p_define_properties(env, exports, sizeof(props) / sizeof(props[0]), props);
  return exports;
}

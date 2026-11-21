#include <node_api.h>
#include <windows.h>

#include <algorithm>
#include <map>
#include <memory>
#include <string>
#include <exception>
#include <vector>
namespace {

struct ManagedProcess {
  HANDLE job = nullptr;
  HANDLE process = nullptr;
  DWORD pid = 0;
  bool closed = false;

  void Close() {
    if (closed) return;
    closed = true;
    // Closing the final non-inherited Job Object handle enforces
    // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE for every process in the job.
    if (job) {
      CloseHandle(job);
      job = nullptr;
    }
    if (process) {
      CloseHandle(process);
      process = nullptr;
    }
  }

  ~ManagedProcess() { Close(); }
};

std::string Utf8FromWide(const std::wstring& value) {
  if (value.empty()) return {};
  const int size = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, value.data(),
    static_cast<int>(value.size()), nullptr, 0, nullptr, nullptr);
  if (size <= 0) return "Unknown Windows error";
  std::string result(static_cast<size_t>(size), '\0');
  WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, value.data(),
    static_cast<int>(value.size()), result.data(), size, nullptr, nullptr);
  return result;
}

std::wstring WideFromUtf8(const std::string& value) {
  if (value.empty()) return {};
  const int size = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.data(),
    static_cast<int>(value.size()), nullptr, 0);
  if (size <= 0) return {};
  std::wstring result(static_cast<size_t>(size), L'\0');
  MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.data(),
    static_cast<int>(value.size()), result.data(), size);
  return result;
}

void Throw(napi_env env, const std::string& message) {
  napi_throw_error(env, nullptr, message.c_str());
}

void ThrowWin32(napi_env env, const char* operation, DWORD error = GetLastError()) {
  LPWSTR buffer = nullptr;
  const DWORD length = FormatMessageW(FORMAT_MESSAGE_ALLOCATE_BUFFER |
    FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS,
    nullptr, error, MAKELANGID(LANG_NEUTRAL, SUBLANG_DEFAULT),
    reinterpret_cast<LPWSTR>(&buffer), 0, nullptr);
  std::wstring detail = length && buffer ? std::wstring(buffer, length) : L"Unknown Windows error";
  if (buffer) LocalFree(buffer);
  Throw(env, std::string(operation) + " failed (" + std::to_string(error) + "): " + Utf8FromWide(detail));
}
template <napi_value (*Callback)(napi_env, napi_callback_info)>
napi_value GuardCallback(napi_env env, napi_callback_info info) {
  try {
    return Callback(env, info);
  } catch (const std::exception& error) {
    Throw(env, std::string("Native process-control exception: ") + error.what());
    return nullptr;
  } catch (...) {
    Throw(env, "Unknown native process-control exception.");
    return nullptr;
  }
}


bool ReadString(napi_env env, napi_value value, std::wstring* output) {
  size_t length = 0;
  if (napi_get_value_string_utf8(env, value, nullptr, 0, &length) != napi_ok) return false;
  std::string utf8(length + 1, '\0');
  if (napi_get_value_string_utf8(env, value, utf8.data(), length + 1, &length) != napi_ok) return false;
  utf8.resize(length);
  *output = WideFromUtf8(utf8);
  return !output->empty() || utf8.empty();
}

std::wstring QuoteArgument(const std::wstring& argument) {
  std::wstring result = L"\"";
  size_t backslashes = 0;
  for (wchar_t character : argument) {
    if (character == L'\\') {
      ++backslashes;
    } else if (character == L'"') {
      result.append(backslashes * 2 + 1, L'\\');
      result.push_back(L'"');
      backslashes = 0;
    } else {
      result.append(backslashes, L'\\');
      backslashes = 0;
      result.push_back(character);
    }
  }
  result.append(backslashes * 2, L'\\');
  result.push_back(L'"');
  return result;
}

struct CaseInsensitiveLess {
  bool operator()(const std::wstring& left, const std::wstring& right) const {
    return CompareStringOrdinal(left.c_str(), -1, right.c_str(), -1, TRUE) == CSTR_LESS_THAN;
  }
};

bool ReadEnvironment(napi_env env, napi_value object, std::vector<wchar_t>* block) {
  napi_valuetype objectType;
  bool isArray = false;
  if (napi_typeof(env, object, &objectType) != napi_ok || objectType != napi_object ||
      napi_is_array(env, object, &isArray) != napi_ok || isArray) return false;
  napi_value names;
  if (napi_get_property_names(env, object, &names) != napi_ok) return false;
  uint32_t count = 0;
  if (napi_get_array_length(env, names, &count) != napi_ok || count > 512) return false;

  std::map<std::wstring, std::wstring, CaseInsensitiveLess> values;
  for (uint32_t index = 0; index < count; ++index) {
    napi_value keyValue;
    napi_value itemValue;
    if (napi_get_element(env, names, index, &keyValue) != napi_ok) return false;
    std::wstring key;
    if (!ReadString(env, keyValue, &key) || key.empty() || key.find(L'=') != std::wstring::npos || key.find(L'\0') != std::wstring::npos) return false;
    if (napi_get_property(env, object, keyValue, &itemValue) != napi_ok) return false;
    std::wstring item;
    if (!ReadString(env, itemValue, &item) || item.find(L'\0') != std::wstring::npos) return false;
    values[key] = item;
  }

  for (const auto& [key, value] : values) {
    const std::wstring entry = key + L"=" + value;
    block->insert(block->end(), entry.begin(), entry.end());
    block->push_back(L'\0');
  }
  block->push_back(L'\0');
  if (values.empty()) block->push_back(L'\0');
  return true;
}

ManagedProcess* Unwrap(napi_env env, napi_callback_info info) {
  napi_value self;
  size_t argc = 0;
  if (napi_get_cb_info(env, info, &argc, nullptr, &self, nullptr) != napi_ok) return nullptr;
  ManagedProcess* process = nullptr;
  if (napi_unwrap(env, self, reinterpret_cast<void**>(&process)) != napi_ok || !process || process->closed) {
    Throw(env, "Native process handle is closed or invalid.");
    return nullptr;
  }
  return process;
}

void FinalizeProcess(napi_env, void* data, void*) {
  delete static_cast<ManagedProcess*>(data);
}

napi_value IsJobEmpty(napi_env env, napi_callback_info info) {
  ManagedProcess* process = Unwrap(env, info);
  if (!process) return nullptr;
  JOBOBJECT_BASIC_ACCOUNTING_INFORMATION accounting{};
  if (!QueryInformationJobObject(process->job, JobObjectBasicAccountingInformation,
      &accounting, sizeof(accounting), nullptr)) {
    ThrowWin32(env, "QueryInformationJobObject");
    return nullptr;
  }
  napi_value result;
  napi_get_boolean(env, accounting.ActiveProcesses == 0, &result);
  return result;
}

napi_value TerminateJob(napi_env env, napi_callback_info info) {
  ManagedProcess* process = Unwrap(env, info);
  if (!process) return nullptr;
  JOBOBJECT_BASIC_ACCOUNTING_INFORMATION accounting{};
  if (!QueryInformationJobObject(process->job, JobObjectBasicAccountingInformation,
      &accounting, sizeof(accounting), nullptr)) {
    ThrowWin32(env, "QueryInformationJobObject");
    return nullptr;
  }
  if (accounting.ActiveProcesses == 0) {
    napi_value result;
    napi_get_boolean(env, true, &result);
    return result;
  }
  if (!TerminateJobObject(process->job, 1)) {
    ThrowWin32(env, "TerminateJobObject");
    return nullptr;
  }
  napi_value result;
  napi_get_boolean(env, true, &result);
  return result;
}

napi_value GetExitCode(napi_env env, napi_callback_info info) {
  ManagedProcess* process = Unwrap(env, info);
  if (!process) return nullptr;
  DWORD code = STILL_ACTIVE;
  if (!GetExitCodeProcess(process->process, &code)) {
    ThrowWin32(env, "GetExitCodeProcess");
    return nullptr;
  }
  napi_value result;
  if (code == STILL_ACTIVE) {
    const DWORD waitResult = WaitForSingleObject(process->process, 0);
    if (waitResult == WAIT_FAILED) {
      ThrowWin32(env, "WaitForSingleObject");
      return nullptr;
    }
    if (waitResult != WAIT_OBJECT_0) {
      napi_get_null(env, &result);
      return result;
    }
  }
  napi_create_uint32(env, code, &result);
  return result;
}

napi_value CloseProcess(napi_env env, napi_callback_info info) {
  napi_value self;
  size_t argc = 0;
  if (napi_get_cb_info(env, info, &argc, nullptr, &self, nullptr) != napi_ok) return nullptr;
  ManagedProcess* process = nullptr;
  if (napi_unwrap(env, self, reinterpret_cast<void**>(&process)) == napi_ok && process) process->Close();
  napi_value result;
  napi_get_undefined(env, &result);
  return result;
}

napi_value SpawnManagedProcess(napi_env env, napi_callback_info info) {
  size_t argc = 4;
  napi_value argv[4];
  if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok || argc != 4) {
    Throw(env, "spawnManagedProcess expects executablePath, args, cwd, and env.");
    return nullptr;
  }

  std::wstring executable;
  std::wstring workingDirectory;
  if (!ReadString(env, argv[0], &executable) || executable.empty() || executable.find(L'\0') != std::wstring::npos ||
      !ReadString(env, argv[2], &workingDirectory) || workingDirectory.empty() || workingDirectory.find(L'\0') != std::wstring::npos) {
    Throw(env, "Executable path and working directory must be valid UTF-8 strings without NUL characters.");
    return nullptr;
  }


  uint32_t argumentCount = 0;
  if (napi_get_array_length(env, argv[1], &argumentCount) != napi_ok || argumentCount > 128) {
    Throw(env, "Process arguments must be an array with at most 128 items.");
    return nullptr;
  }

  std::wstring commandLine = QuoteArgument(executable);
  if (commandLine.size() > 32760) {
    Throw(env, "Windows process command line exceeds the supported length.");
    return nullptr;
  }

  for (uint32_t index = 0; index < argumentCount; ++index) {
    napi_value value;
    std::wstring argument;
    if (napi_get_element(env, argv[1], index, &value) != napi_ok ||
        !ReadString(env, value, &argument) || argument.find(L'\0') != std::wstring::npos) {
      Throw(env, "Every process argument must be a valid UTF-8 string without NUL characters.");
      return nullptr;
    }
    const std::wstring quotedArgument = QuoteArgument(argument);
    if (commandLine.size() + quotedArgument.size() + 1 > 32760) {
      Throw(env, "Windows process command line exceeds the supported length.");
      return nullptr;
    }
    commandLine.push_back(L' ');
    commandLine += quotedArgument;
  }

  std::vector<wchar_t> environmentBlock;
  if (!ReadEnvironment(env, argv[3], &environmentBlock)) {
    Throw(env, "Process environment must be a plain object containing valid string values.");
    return nullptr;
  }
  if (environmentBlock.size() > 32767) {
    Throw(env, "Windows process environment block exceeds the supported length.");
    return nullptr;
  }


  // Allocate the owner before acquiring OS resources. From this point onward,
  // every acquired process/job handle is immediately transferred to RAII.
  auto managed = std::make_unique<ManagedProcess>();

  HANDLE job = CreateJobObjectW(nullptr, nullptr);
  if (!job) {
    ThrowWin32(env, "CreateJobObjectW");
    return nullptr;
  }
  managed->job = job;

  JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
  limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
  if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, &limits, sizeof(limits))) {
    const DWORD error = GetLastError();
    managed.reset();
    ThrowWin32(env, "SetInformationJobObject", error);
    return nullptr;
  }

  STARTUPINFOW startup{};
  startup.cb = sizeof(startup);
  startup.dwFlags = STARTF_USESHOWWINDOW;
  startup.wShowWindow = SW_HIDE;
  PROCESS_INFORMATION processInfo{};
  const DWORD flags = CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT | CREATE_NO_WINDOW;

  if (!CreateProcessW(executable.c_str(), commandLine.data(), nullptr, nullptr, FALSE,
      flags, environmentBlock.data(), workingDirectory.c_str(), &startup, &processInfo)) {
    const DWORD error = GetLastError();
    managed.reset();
    ThrowWin32(env, "CreateProcessW", error);
    return nullptr;
  }
  managed->process = processInfo.hProcess;

  // The primary thread remains suspended until Job Object membership is proven.
  if (!AssignProcessToJobObject(job, processInfo.hProcess)) {
    const DWORD error = GetLastError();
    TerminateProcess(processInfo.hProcess, 1);
    WaitForSingleObject(processInfo.hProcess, 5000);
    CloseHandle(processInfo.hThread);
    managed.reset();
    ThrowWin32(env, "AssignProcessToJobObject", error);
    return nullptr;
  }

  if (ResumeThread(processInfo.hThread) == static_cast<DWORD>(-1)) {
    const DWORD error = GetLastError();
    TerminateJobObject(job, 1);
    WaitForSingleObject(processInfo.hProcess, 5000);
    CloseHandle(processInfo.hThread);
    managed.reset();
    ThrowWin32(env, "ResumeThread", error);
    return nullptr;
  }
  CloseHandle(processInfo.hThread);
  managed->pid = processInfo.dwProcessId;

  napi_value result;
  if (napi_create_object(env, &result) != napi_ok) {
    managed.reset();
    Throw(env, "Could not create the JavaScript native process handle.");
    return nullptr;
  }
  if (napi_wrap(env, result, managed.get(), FinalizeProcess, nullptr, nullptr) != napi_ok) {
    managed.reset();
    Throw(env, "Could not wrap the JavaScript native process handle.");
    return nullptr;
  }
  managed.release();

  napi_value pid;
  if (napi_create_uint32(env, processInfo.dwProcessId, &pid) != napi_ok ||
      napi_set_named_property(env, result, "pid", pid) != napi_ok) {
    Throw(env, "Could not expose the native process identifier.");
    return nullptr;
  }

  const napi_property_descriptor methods[] = {
    { "isJobEmpty", nullptr, GuardCallback<IsJobEmpty>, nullptr, nullptr, nullptr, napi_default, nullptr },
    { "terminateJob", nullptr, GuardCallback<TerminateJob>, nullptr, nullptr, nullptr, napi_default, nullptr },
    { "getExitCode", nullptr, GuardCallback<GetExitCode>, nullptr, nullptr, nullptr, napi_default, nullptr },
    { "close", nullptr, GuardCallback<CloseProcess>, nullptr, nullptr, nullptr, napi_default, nullptr },
  };
  if (napi_define_properties(env, result, sizeof(methods) / sizeof(methods[0]), methods) != napi_ok) {
    Throw(env, "Could not define native process handle methods.");
    return nullptr;
  }
  return result;
}

napi_value GetCurrentProcessHandleCount(napi_env env, napi_callback_info) {
  DWORD count = 0;
  if (!GetProcessHandleCount(GetCurrentProcess(), &count)) {
    ThrowWin32(env, "GetProcessHandleCount");
    return nullptr;
  }
  napi_value result;
  napi_create_uint32(env, count, &result);
  return result;
}

napi_value Initialize(napi_env env, napi_value exports) {
  napi_value spawn;
  napi_create_function(env, "spawnManagedProcess", NAPI_AUTO_LENGTH, GuardCallback<SpawnManagedProcess>, nullptr, &spawn);
  napi_set_named_property(env, exports, "spawnManagedProcess", spawn);
  napi_value handleCount;
  napi_create_function(env, "getCurrentProcessHandleCount", NAPI_AUTO_LENGTH, GuardCallback<GetCurrentProcessHandleCount>, nullptr, &handleCount);
  napi_set_named_property(env, exports, "getCurrentProcessHandleCount", handleCount);
  return exports;
}


} // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, Initialize)

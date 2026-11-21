#define WIN32_LEAN_AND_MEAN
#include <windows.h>

#include <cstdio>
#include <string>

namespace {
std::wstring Quote(const std::wstring& value) {
  std::wstring result = L"\"";
  size_t slashes = 0;
  for (wchar_t character : value) {
    if (character == L'\\') {
      ++slashes;
    } else if (character == L'"') {
      result.append(slashes * 2 + 1, L'\\');
      result.push_back(L'"');
      slashes = 0;
    } else {
      result.append(slashes, L'\\');
      slashes = 0;
      result.push_back(character);
    }
  }
  result.append(slashes * 2, L'\\');
  result.push_back(L'"');
  return result;
}

int Fail(const wchar_t* operation, DWORD error) {
  fwprintf(stderr, L"%ls failed: %lu\n", operation, error);
  return 1;
}
} // namespace

int wmain(int argc, wchar_t** argv) {
  if (argc != 7) {
    fwprintf(stderr, L"Usage: nested_job_host.exe node.exe script.js addon.node result.json cwd mode\n");
    return 2;
  }

  HANDLE outerJob = CreateJobObjectW(nullptr, nullptr);
  if (!outerJob) return Fail(L"CreateJobObjectW", GetLastError());

  JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
  limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
  if (std::wstring(argv[6]) == L"constrained") {
    limits.BasicLimitInformation.LimitFlags |= JOB_OBJECT_LIMIT_ACTIVE_PROCESS;
    limits.BasicLimitInformation.ActiveProcessLimit = 1;
  }
  if (!SetInformationJobObject(outerJob, JobObjectExtendedLimitInformation, &limits, sizeof(limits))) {
    const DWORD error = GetLastError();
    CloseHandle(outerJob);
    return Fail(L"SetInformationJobObject", error);
  }

  std::wstring command = Quote(argv[1]) + L" " + Quote(argv[2]) + L" " +
    Quote(argv[3]) + L" " + Quote(argv[4]) + L" " + Quote(argv[6]);
  STARTUPINFOW startup{};
  startup.cb = sizeof(startup);
  PROCESS_INFORMATION process{};
  if (!CreateProcessW(argv[1], command.data(), nullptr, nullptr, FALSE,
      CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT, nullptr, argv[5], &startup, &process)) {
    const DWORD error = GetLastError();
    CloseHandle(outerJob);
    return Fail(L"CreateProcessW", error);
  }

  if (!AssignProcessToJobObject(outerJob, process.hProcess)) {
    const DWORD error = GetLastError();
    TerminateProcess(process.hProcess, 1);
    WaitForSingleObject(process.hProcess, 5000);
    CloseHandle(process.hThread);
    CloseHandle(process.hProcess);
    CloseHandle(outerJob);
    // 77 means the host environment itself prevents the test harness setup.
    return error == ERROR_ACCESS_DENIED ? 77 : Fail(L"AssignProcessToJobObject(outer)", error);
  }

  if (ResumeThread(process.hThread) == static_cast<DWORD>(-1)) {
    const DWORD error = GetLastError();
    TerminateJobObject(outerJob, 1);
    WaitForSingleObject(process.hProcess, 5000);
    CloseHandle(process.hThread);
    CloseHandle(process.hProcess);
    CloseHandle(outerJob);
    return Fail(L"ResumeThread", error);
  }
  CloseHandle(process.hThread);

  const DWORD waitResult = WaitForSingleObject(process.hProcess, 20000);
  if (waitResult != WAIT_OBJECT_0) {
    const DWORD error = waitResult == WAIT_FAILED ? GetLastError() : WAIT_TIMEOUT;
    TerminateJobObject(outerJob, 1);
    WaitForSingleObject(process.hProcess, 5000);
    CloseHandle(process.hProcess);
    CloseHandle(outerJob);
    return Fail(L"WaitForSingleObject(child)", error);
  }

  DWORD exitCode = 1;
  if (!GetExitCodeProcess(process.hProcess, &exitCode)) {
    const DWORD error = GetLastError();
    CloseHandle(process.hProcess);
    CloseHandle(outerJob);
    return Fail(L"GetExitCodeProcess", error);
  }
  CloseHandle(process.hProcess);
  CloseHandle(outerJob);
  return static_cast<int>(exitCode);
}

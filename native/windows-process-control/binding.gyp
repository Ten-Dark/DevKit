{
  "targets": [
    {
      "target_name": "windows_process_control",
      "sources": ["windows_process_control.cc"],
      "defines": ["NAPI_VERSION=8", "UNICODE", "_UNICODE", "WIN32_LEAN_AND_MEAN", "NOMINMAX"],
      "msvs_settings": {
        "VCCLCompilerTool": {
          "ExceptionHandling": 1
        }
      }
    }
  ]
}

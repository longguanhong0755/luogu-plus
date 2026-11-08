/* Windows 任务栏入口：用当前可执行文件创建稳定的开始菜单快捷方式，再请求系统
   执行“固定到任务栏”。Windows 不同版本会决定是否展示确认 UI；失败时返回可操作提示，
   不伪造成功，也不触碰用户已有固定项。 */
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { app } = require("electron");
const { APP_USER_MODEL_ID, APP_DISPLAY_NAME } = require("./window");

const SHORTCUT_NAME = "Luogu Desktop.lnk";

function launchSpec() {
  const target = process.execPath;
  const packaged = app.isPackaged;
  const args = packaged ? "" : `"${app.getAppPath()}"`;
  const relaunchCommand = args ? `"${target}" ${args}` : `"${target}"`;
  return {
    target,
    args,
    relaunchCommand,
    workingDirectory: packaged ? path.dirname(target) : app.getAppPath(),
    icon: path.join(app.getAppPath(), "src", "assets", "icon.ico"),
  };
}

function shortcutPath() {
  return path.join(app.getPath("appData"), "Microsoft", "Windows", "Start Menu", "Programs", SHORTCUT_NAME);
}

function pinnedShortcutPath() {
  return path.join(
    app.getPath("appData"),
    "Microsoft",
    "Internet Explorer",
    "Quick Launch",
    "User Pinned",
    "TaskBar",
    SHORTCUT_NAME
  );
}

function runPowerShell(script, env, timeout = 15000) {
  return new Promise((resolve) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
      windowsHide: true,
      env: Object.assign({}, process.env, env),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      resolve({ code: -1, stdout, stderr: stderr + "\nTIMEOUT" });
    }, timeout);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.once("error", (err) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: err.message });
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({ code: Number(code), stdout, stderr });
    });
  });
}

async function pinToTaskbar(options = {}) {
  if (process.platform !== "win32") {
    return { ok: false, supported: false, message: "任务栏固定仅支持 Windows。" };
  }
  if (options.smoke) {
    return { ok: false, supported: true, smoke: true, message: "隔离测试模式不会修改真实任务栏。" };
  }
  const shortcut = shortcutPath();
  const pinned = pinnedShortcutPath();
  if (fs.existsSync(pinned)) {
    return { ok: true, supported: true, already: true, shortcut, message: "已经固定在任务栏。" };
  }
  const spec = launchSpec();
  const script = String.raw`
$ErrorActionPreference = "Stop"
$shortcutPath = $env:LG_TASKBAR_SHORTCUT
$parent = Split-Path -Parent $shortcutPath
New-Item -ItemType Directory -Path $parent -Force | Out-Null
$wsh = New-Object -ComObject WScript.Shell
$shortcut = $wsh.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $env:LG_TASKBAR_TARGET
$shortcut.Arguments = $env:LG_TASKBAR_ARGS
$shortcut.WorkingDirectory = $env:LG_TASKBAR_WORKDIR
$shortcut.IconLocation = $env:LG_TASKBAR_ICON + ",0"
$shortcut.Description = "洛谷桌面版"
$shortcut.Save()

$metadataOk = $false
try {
  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
[StructLayout(LayoutKind.Sequential, Pack = 4)] internal struct PROPERTYKEY { public Guid fmtid; public uint pid; }
[StructLayout(LayoutKind.Explicit)] internal struct PROPVARIANT { [FieldOffset(0)] public ushort vt; [FieldOffset(8)] public IntPtr pointerValue; }
[ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99")] internal interface IPropertyStore {
  [PreserveSig] int GetCount(out uint cProps);
  [PreserveSig] int GetAt(uint iProp, out PROPERTYKEY pkey);
  [PreserveSig] int GetValue(ref PROPERTYKEY key, out PROPVARIANT pv);
  [PreserveSig] int SetValue(ref PROPERTYKEY key, ref PROPVARIANT pv);
  [PreserveSig] int Commit();
}
public static class LuoguShortcutMetadata {
  [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)] private static extern void SHGetPropertyStoreFromParsingName(string path, IntPtr pbc, uint flags, ref Guid riid, [MarshalAs(UnmanagedType.Interface)] out IPropertyStore store);
  public static int SetString(string path, string keyGuid, uint keyPid, string value) {
    Guid iid = new Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99");
    IPropertyStore store;
    SHGetPropertyStoreFromParsingName(path, IntPtr.Zero, 2, ref iid, out store);
    PROPERTYKEY key = new PROPERTYKEY(); key.fmtid = new Guid(keyGuid); key.pid = keyPid;
    PROPVARIANT pv = new PROPVARIANT(); pv.vt = 31; pv.pointerValue = Marshal.StringToCoTaskMemUni(value);
    try {
      int hr = store.SetValue(ref key, ref pv);
      if (hr != 0) return hr;
      return store.Commit();
    } finally {
      Marshal.FreeCoTaskMem(pv.pointerValue);
      if (Marshal.IsComObject(store)) Marshal.ReleaseComObject(store);
    }
  }
}
"@
  $appIdHr = [LuoguShortcutMetadata]::SetString($shortcutPath, "9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3", 5, $env:LG_TASKBAR_APP_ID)
  $relaunchHr = [LuoguShortcutMetadata]::SetString($shortcutPath, "9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3", 2, $env:LG_TASKBAR_RELAUNCH)
  $metadataOk = ($appIdHr -eq 0 -and $relaunchHr -eq 0)
} catch {
  Write-Output ("SHORTCUT_METADATA_WARN " + $_.Exception.Message)
}
if ($metadataOk) { Write-Output "SHORTCUT_METADATA_OK" } else { Write-Output "SHORTCUT_METADATA_WARN properties-not-written" }

$shell = New-Object -ComObject Shell.Application
$folder = $shell.Namespace($parent)
$item = $folder.ParseName((Split-Path -Leaf $shortcutPath))
$verb = @($item.Verbs()) | Where-Object { (($_.Name -replace '&', '') -match '(?i)pin.*taskbar|固定到任务栏|釘選到工作列') } | Select-Object -First 1
if ($verb) {
  $verb.DoIt()
  Write-Output "PIN_REQUESTED"
  exit 0
}
try {
  $item.InvokeVerb('taskbarpin')
  Write-Output "PIN_REQUESTED_FALLBACK"
  exit 0
} catch {
  Write-Output "PIN_UNAVAILABLE"
  exit 3
}
`;
  const result = await runPowerShell(script, {
    LG_TASKBAR_SHORTCUT: shortcut,
    LG_TASKBAR_TARGET: spec.target,
    LG_TASKBAR_ARGS: spec.args,
    LG_TASKBAR_WORKDIR: spec.workingDirectory,
    LG_TASKBAR_ICON: spec.icon,
    LG_TASKBAR_APP_ID: APP_USER_MODEL_ID,
    LG_TASKBAR_RELAUNCH: spec.relaunchCommand,
  });
  if (result.code === 0 && /PIN_REQUESTED/.test(result.stdout)) {
    return {
      ok: true,
      supported: true,
      shortcut,
      requested: true,
      identity: /SHORTCUT_METADATA_OK/.test(result.stdout),
      message: "已发送固定请求，请查看任务栏。",
    };
  }
  return {
    ok: false,
    supported: true,
    shortcut,
    message: "Windows 未允许自动固定，请右键任务栏中的洛谷图标选择“固定到任务栏”。",
    detail: (result.stderr || result.stdout || "").trim().slice(0, 500),
  };
}

module.exports = { pinToTaskbar, launchSpec, shortcutPath, pinnedShortcutPath };

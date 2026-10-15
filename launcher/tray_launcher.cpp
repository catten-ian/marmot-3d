// ============================================================================
//  土拨鼠大作战 3D —— 托盘服务器启动器
// ----------------------------------------------------------------------------
//  零第三方依赖，纯 Win32（源码刻意保持 C 兼容，g++/cl 与 TCC 均可编译）：
//    1. 自动定位 node.exe（PATH -> 常见安装目录 -> WorkBuddy 托管运行时）；
//    2. 以隐藏窗口方式启动 tools/serve.cjs 静态服务器（127.0.0.1:8200）；
//    3. 系统托盘图标 + 气泡提示网址，双击打开游戏，右键菜单可打开正式版 /
//       DEV 版 / 复制网址 / 退出；关闭时连 node 子进程一起结束。
//
//  构建方式：
//    · MSVC  : cl /O2 /DUNICODE /D_UNICODE tray_launcher.cpp /link \
//                user32.lib shell32.lib advapi32.lib /SUBSYSTEM:WINDOWS
//    · MinGW : g++ -O2 -mwindows -municode tray_launcher.cpp \
//                -o marmot-server.exe -lshell32 -ladvapi32
//    · TCC   : tcc -DUNICODE -D_UNICODE tray_launcher.c \
//                -o marmot-server.exe -luser32 -lshell32 -ladvapi32
//
//  用法：marmot-server.exe [端口]   （默认 8200）
// ============================================================================

#ifndef NTDDI_VERSION
#define NTDDI_VERSION 0x06000000
#endif
#ifndef _WIN32_WINNT
#define _WIN32_WINNT 0x0600
#endif

#include <windows.h>
#include <shellapi.h>
#include <stdlib.h>
#include <wchar.h>

/* MSVC 自动链接；TCC 不识别 #pragma comment(lib)，用宏屏蔽 */
#ifndef __TINYC__
#pragma comment(lib, "user32.lib")
#pragma comment(lib, "shell32.lib")
#pragma comment(lib, "advapi32.lib")
#endif


/* TCC 兼容：补缺失的托盘常量 */
#ifndef NIN_SELECT
#define NIN_SELECT (WM_USER + 0)
#endif
#ifndef NIN_KEYSELECT
#define NIN_KEYSELECT (WM_USER + 1)
#endif
#ifndef NIN_BALLOONUSERCLICK
#define NIN_BALLOONUSERCLICK (WM_USER + 5)
#endif
#ifndef NOTIFYICON_VERSION_4
#define NOTIFYICON_VERSION_4 4
#endif

#define WM_TRAYICON (WM_APP + 1)
#define IDM_OPEN_STABLE 1001
#define IDM_OPEN_DEV    1002
#define IDM_COPY_URL    1003
#define IDM_EXIT        1004
#define DEFAULT_PORT    8200
#define URL_MAX         128

typedef struct {
    NOTIFYICONDATAW nid;
    HICON           hIcon;
    PROCESS_INFORMATION pi;
    int             serverUp;
    WCHAR           url[URL_MAX];
    WCHAR           urlDev[URL_MAX + 32];
    WCHAR           port[8];
} AppState;

static AppState g_app;

/* ---- 宽字符串小工具（纯 C 实现，兼容 MSVC / MinGW / TCC）---- */
static void ws_copy(WCHAR* dst, int cch, const WCHAR* src) {
    if (cch <= 0) return;
    int i = 0;
    if (src) for (; i < cch - 1 && src[i]; ++i) dst[i] = src[i];
    dst[i] = 0;
}
static void ws_cat(WCHAR* dst, int cch, const WCHAR* src) {
    int n = (int)wcslen(dst);
    if (n >= cch) { if (cch) dst[cch - 1] = 0; return; }
    int i = 0;
    if (src) for (; n + i < cch - 1 && src[i]; ++i) dst[n + i] = src[i];
    dst[n + i] = 0;
}
/* 托盘字段的容量辅助 */
#define TIP_CCH   (int)(sizeof(g_app.nid.szTip)/sizeof(WCHAR))
#define TITLE_CCH (int)(sizeof(g_app.nid.szInfoTitle)/sizeof(WCHAR))
#define INFO_CCH  (int)(sizeof(g_app.nid.szInfo)/sizeof(WCHAR))
static int  file_exists(const WCHAR* p) {
    DWORD a = GetFileAttributesW(p);
    return a != INVALID_FILE_ATTRIBUTES && !(a & FILE_ATTRIBUTE_DIRECTORY);
}

/* exe 所在目录（以反斜杠结尾） */
static void exe_dir(WCHAR* out, int cch) {
    WCHAR buf[MAX_PATH];
    DWORD n = GetModuleFileNameW(NULL, buf, MAX_PATH);
    if (!n) { ws_copy(out, cch, L".\\"); return; }
    WCHAR* slash = wcsrchr(buf, L'\\');
    if (slash) { slash[1] = 0; ws_copy(out, cch, buf); }
    else ws_copy(out, cch, L".\\");
}

/* 项目根：exe 在根目录或 launcher\\ 下都能识别（以 tools\\serve.cjs 为锚） */
static void project_root(WCHAR* out, int cch, const WCHAR* exeDir) {
    WCHAR cand[MAX_PATH];
    ws_copy(cand, MAX_PATH, exeDir);
    ws_cat(cand, MAX_PATH, L"tools\\serve.cjs");
    if (file_exists(cand)) { ws_copy(out, cch, exeDir); return; }

    ws_copy(cand, MAX_PATH, exeDir);
    ws_cat(cand, MAX_PATH, L"..\\tools\\serve.cjs");
    if (file_exists(cand)) {
        ws_copy(out, cch, exeDir);
        ws_cat(out, cch, L"..\\");
        return;
    }
    ws_copy(out, cch, exeDir); /* 兜底 */
}

/* 定位 node.exe */
static void locate_node(WCHAR* out, int cch) {
    WCHAR buf[MAX_PATH];
    out[0] = 0;
    if (SearchPathW(NULL, L"node.exe", NULL, MAX_PATH, buf, NULL)) {
        ws_copy(out, cch, buf);
        return;
    }
    const WCHAR* fixed[] = {
        L"C:\\Program Files\\nodejs\\node.exe",
        L"C:\\Program Files (x86)\\nodejs\\node.exe",
    };
    for (int i = 0; i < 2; ++i)
        if (file_exists(fixed[i])) { ws_copy(out, cch, fixed[i]); return; }

    /* WorkBuddy 托管运行时：优先已知版本，再扫描 versions 下最大版本目录 */
    const WCHAR* home = _wgetenv(L"USERPROFILE");
    if (home) {
        WCHAR cand[MAX_PATH * 2];
        wsprintfW(cand,
            L"%s\\.workbuddy\\binaries\\node\\versions\\22.22.2-6\\node.exe", home);
        if (file_exists(cand)) { ws_copy(out, cch, cand); return; }

        WCHAR pattern[MAX_PATH * 2];
        wsprintfW(pattern,
            L"%s\\.workbuddy\\binaries\\node\\versions\\*", home);
        WIN32_FIND_DATAW fd;
        WCHAR bestDir[MAX_PATH]; bestDir[0] = 0;
        HANDLE h = FindFirstFileW(pattern, &fd);
        if (h != INVALID_HANDLE_VALUE) {
            do {
                if ((fd.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) &&
                    fd.cFileName[0] != L'.') {
                    if (bestDir[0] == 0 || wcscmp(fd.cFileName, bestDir) > 0)
                        ws_copy(bestDir, MAX_PATH, fd.cFileName);
                }
            } while (FindNextFileW(h, &fd));
            FindClose(h);
        }
        if (bestDir[0]) {
            wsprintfW(cand,
                L"%s\\.workbuddy\\binaries\\node\\versions\\%s\\node.exe",
                home, bestDir);
            if (file_exists(cand)) ws_copy(out, cch, cand);
        }
    }
}

static void balloon(const WCHAR* title, const WCHAR* msg) {
    g_app.nid.dwInfoFlags = NIIF_INFO;
    ws_copy(g_app.nid.szInfoTitle, TITLE_CCH, title);
    ws_copy(g_app.nid.szInfo, INFO_CCH, msg);
    g_app.nid.uFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP | NIF_INFO;
    Shell_NotifyIconW(NIM_MODIFY, &g_app.nid);
}

static void shell_open(const WCHAR* url) {
    ShellExecuteW(NULL, L"open", url, NULL, NULL, SW_SHOWNORMAL);
}

static void copy_url(const WCHAR* text) {
    if (!OpenClipboard(NULL)) return;
    EmptyClipboard();
    SIZE_T bytes = (wcslen(text) + 1) * sizeof(WCHAR);
    HGLOBAL mem = GlobalAlloc(GMEM_MOVEABLE, bytes);
    if (mem) {
        void* p = GlobalLock(mem);
        memcpy(p, text, bytes);
        GlobalUnlock(mem);
        SetClipboardData(CF_UNICODETEXT, mem);
    }
    CloseClipboard();
}

/* ---- 启停 node 服务器 ---- */
static int start_server(const WCHAR* nodeExe, const WCHAR* serveJs,
                        const WCHAR* workDir, const WCHAR* port) {
    STARTUPINFOW si;
    ZeroMemory(&si, sizeof(si));
    si.cb = sizeof(si);
    si.dwFlags = STARTF_USESHOWWINDOW;
    si.wShowWindow = SW_HIDE;

    /* 命令行："node.exe" "serve.cjs" 8200 */
    static WCHAR cmd[2048];
    wsprintfW(cmd, L"\"%s\" \"%s\" %s", nodeExe, serveJs, port);

    ZeroMemory(&g_app.pi, sizeof(g_app.pi));
    BOOL ok = CreateProcessW(nodeExe, cmd, NULL, NULL, FALSE,
                             CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP,
                             NULL, workDir, &si, &g_app.pi);
    if (!ok) return 0;
    g_app.serverUp = 1;
    return 1;
}

static void stop_server(void) {
    if (g_app.pi.hProcess) {
        /* taskkill /T 结束整棵进程树，再兜底 TerminateProcess */
        WCHAR tk[128];
        wsprintfW(tk, L"/PID %lu /T /F", g_app.pi.dwProcessId);
        STARTUPINFOW si; ZeroMemory(&si, sizeof(si)); si.cb = sizeof(si);
        PROCESS_INFORMATION tp; ZeroMemory(&tp, sizeof(tp));
        if (CreateProcessW(L"C:\\Windows\\System32\\taskkill.exe", tk, NULL, NULL,
                           FALSE, CREATE_NO_WINDOW, NULL, NULL, &si, &tp)) {
            WaitForSingleObject(tp.hProcess, 2000);
            CloseHandle(tp.hProcess); CloseHandle(tp.hThread);
        }
        WaitForSingleObject(g_app.pi.hProcess, 2000);
        TerminateProcess(g_app.pi.hProcess, 0);
        CloseHandle(g_app.pi.hProcess); CloseHandle(g_app.pi.hThread);
        ZeroMemory(&g_app.pi, sizeof(g_app.pi));
    }
    g_app.serverUp = 0;
}

static void show_menu(HWND hwnd) {
    POINT pt;
    GetCursorPos(&pt);
    HMENU menu = CreatePopupMenu();
    AppendMenuW(menu, MF_BYPOSITION, IDM_OPEN_STABLE, L"打开游戏（正式版）");
    AppendMenuW(menu, MF_BYPOSITION, IDM_OPEN_DEV,    L"打开 DEV 版（?version=dev）");
    AppendMenuW(menu, MF_BYPOSITION, IDM_COPY_URL,    L"复制网址到剪贴板");
    AppendMenuW(menu, MF_SEPARATOR, 0, NULL);

    WCHAR status[URL_MAX + 24];
    wsprintfW(status, L"%s  %s",
              g_app.serverUp ? L"● 运行中" : L"○ 已停止", g_app.url);
    AppendMenuW(menu, MF_BYPOSITION | MF_GRAYED | MF_DISABLED, 0, status);
    AppendMenuW(menu, MF_SEPARATOR, 0, NULL);
    AppendMenuW(menu, MF_BYPOSITION, IDM_EXIT, L"退出（关闭服务器）");

    SetForegroundWindow(hwnd);
    TrackPopupMenu(menu, TPM_RIGHTBUTTON, pt.x, pt.y, 0, hwnd, NULL);
    PostMessageW(hwnd, WM_NULL, 0, 0);
    DestroyMenu(menu);
}

static LRESULT CALLBACK tray_proc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
    switch (msg) {
    case WM_TRAYICON:
        switch (LOWORD(lp)) {
        case NIN_SELECT:
        case WM_LBUTTONDBLCLK:
        case NIN_BALLOONUSERCLICK:
            shell_open(g_app.url);
            return 0;
        case WM_RBUTTONUP:
        case NIN_KEYSELECT:
            show_menu(hwnd);
            return 0;
        }
        return 0;

    case WM_COMMAND:
        switch (LOWORD(wp)) {
        case IDM_OPEN_STABLE: shell_open(g_app.url); break;
        case IDM_OPEN_DEV:    shell_open(g_app.urlDev); break;
        case IDM_COPY_URL:
            copy_url(g_app.url);
            balloon(L"已复制网址", g_app.url);
            break;
        case IDM_EXIT:
            DestroyWindow(hwnd);
            break;
        }
        return 0;

    case WM_TIMER:
        if (g_app.pi.hProcess && WaitForSingleObject(g_app.pi.hProcess, 0) != WAIT_TIMEOUT) {
            if (g_app.serverUp) {
                g_app.serverUp = 0;
                balloon(L"服务器已停止", L"node 进程已退出，请重新运行本程序。");
            }
        }
        return 0;

    case WM_DESTROY:
        KillTimer(hwnd, 1);
        Shell_NotifyIconW(NIM_DELETE, &g_app.nid);
        stop_server();
        if (g_app.hIcon) DestroyIcon(g_app.hIcon);
        PostQuitMessage(0);
        return 0;
    }
    return DefWindowProcW(hwnd, msg, wp, lp);
}

int WINAPI wWinMain(HINSTANCE hInst, HINSTANCE hPrev, LPWSTR cmdLine, int show) {
    (void)hPrev; (void)show;

    /* 端口：命令行里第一个独立数字（自解析，避免依赖 CommandLineToArgvW） */
    int port = DEFAULT_PORT;
    {
        LPWSTR s = GetCommandLineW();
        while (*s) {
            while (*s == L' ' || *s == L'\t') s++;
            if (*s >= L'0' && *s <= L'9') {
                int v = _wtoi(s);
                if (v > 0 && v < 65536) { port = v; break; }
            }
            while (*s && *s != L' ' && *s != L'\t') s++;
        }
    }
    (void)cmdLine;
    wsprintfW(g_app.port, L"%d", port);
    wsprintfW(g_app.url,    L"http://127.0.0.1:%d/index.html", port);
    wsprintfW(g_app.urlDev, L"http://127.0.0.1:%d/index.html?version=dev", port);

    WCHAR exeDir[MAX_PATH], root[MAX_PATH];
    exe_dir(exeDir, MAX_PATH);
    project_root(root, MAX_PATH, exeDir);

    WCHAR serveJs[MAX_PATH], nodeExe[MAX_PATH];
    wsprintfW(serveJs, L"%stools\\serve.cjs", root);
    locate_node(nodeExe, MAX_PATH);

    /* 隐藏消息窗口 */
    const WCHAR* cls = L"MarmotServerTrayWnd";
    WNDCLASSW wc;
    ZeroMemory(&wc, sizeof(wc));
    wc.lpfnWndProc = tray_proc;
    wc.hInstance = hInst;
    wc.lpszClassName = cls;
    RegisterClassW(&wc);
    HWND hwnd = CreateWindowExW(0, cls, L"土拨鼠大作战服务器", 0,
                                0, 0, 0, 0, HWND_MESSAGE, NULL, hInst, NULL);

    /* 托盘图标 */
    g_app.hIcon = LoadIconW(NULL, IDI_APPLICATION);
    ZeroMemory(&g_app.nid, sizeof(g_app.nid));
    g_app.nid.cbSize = sizeof(NOTIFYICONDATAW);
    g_app.nid.hWnd = hwnd;
    g_app.nid.uID = 1;
    g_app.nid.uFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP;
    g_app.nid.uCallbackMessage = WM_TRAYICON;
    g_app.nid.hIcon = g_app.hIcon;
    ws_copy(g_app.nid.szTip, TIP_CCH, L"土拨鼠大作战服务器");
    Shell_NotifyIconW(NIM_ADD, &g_app.nid);
    g_app.nid.uVersion = NOTIFYICON_VERSION_4;
    Shell_NotifyIconW(NIM_SETVERSION, &g_app.nid);

    SetTimer(hwnd, 1, 1500, NULL);

    /* 启动服务器 */
    int started = 0;
    WCHAR errMsg[512];
    if (nodeExe[0] == 0) {
        ws_copy(errMsg, 512, L"未找到 node.exe（已检查 PATH 与 WorkBuddy 托管运行时）。");
    } else if (!file_exists(serveJs)) {
        wsprintfW(errMsg, L"未找到服务器脚本：\n%s\n请把本程序放到游戏根目录或 launcher\\ 下。", serveJs);
    } else {
        started = start_server(nodeExe, serveJs, root, g_app.port);
        if (!started)
            wsprintfW(errMsg, L"启动失败（错误码 %lu）。端口 %d 可能已被占用。",
                      GetLastError(), port);
    }

    if (started) {
        Sleep(1200); /* 等服务器就绪 */
        WCHAR tip[URL_MAX + 32];
        wsprintfW(tip, L"土拨鼠大作战服务器（运行中）\n%s", g_app.url);
        ws_copy(g_app.nid.szTip, TIP_CCH, tip);
        Shell_NotifyIconW(NIM_MODIFY, &g_app.nid);
        balloon(L"土拨鼠大作战服务器已启动",
                L"双击托盘图标打开游戏，右键查看菜单：\n");
        shell_open(g_app.url); /* 自动打开浏览器 */
    } else {
        ws_copy(g_app.nid.szTip, TIP_CCH, L"土拨鼠大作战服务器（启动失败）");
        Shell_NotifyIconW(NIM_MODIFY, &g_app.nid);
        MessageBoxW(NULL, errMsg, L"启动失败", MB_OK | MB_ICONERROR);
    }

    MSG msg;
    while (GetMessageW(&msg, NULL, 0, 0) > 0) {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }
    return 0;
}

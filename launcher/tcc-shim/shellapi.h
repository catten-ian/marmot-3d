/*
 * 最小 shellapi 兼容头 —— 仅供精简版 TCC（tcc-0.9.27-win64-bin，
 * 其 winapi/ 目录被裁剪、缺少 shellapi.h）编译本托盘程序使用。
 *
 * 用 g++ / MSVC 构建时不会用到本文件（编译器自带完整 Windows SDK 头）。
 * 结构布局按 Vista+ 的 NOTIFYICONDATAW 编写，运行时由 cbSize 协商版本。
 */
#ifndef SHIM_SHELLAPI_H
#define SHIM_SHELLAPI_H

/* GUID 仅用于占位（本程序不用，但必须占满 NOTIFYICONDATAW 末尾字段） */
typedef struct SHIM_GUID {
    unsigned long  Data1;
    unsigned short Data2;
    unsigned short Data3;
    unsigned char  Data4[8];
} SHIM_GUID;

typedef struct _NOTIFYICONDATAW {
    DWORD cbSize;
    HWND  hWnd;
    UINT  uID;
    UINT  uFlags;
    UINT  uCallbackMessage;
    HICON hIcon;
    WCHAR szTip[128];
    DWORD dwState;
    DWORD dwStateMask;
    WCHAR szInfo[256];
    union { UINT uTimeout; UINT uVersion; };
    WCHAR szInfoTitle[64];
    DWORD dwInfoFlags;
    SHIM_GUID guidItem;
    HICON hBalloonIcon;
} NOTIFYICONDATAW, *PNOTIFYICONDATAW;

#define NIM_ADD        0x00000000
#define NIM_MODIFY     0x00000001
#define NIM_DELETE     0x00000002
#define NIM_SETVERSION 0x00000004

#define NIF_MESSAGE 0x00000001
#define NIF_ICON    0x00000002
#define NIF_TIP     0x00000004
#define NIF_INFO    0x00000010

#define NIIF_INFO    0x00000001
#define NIIF_WARNING 0x00000002
#define NIIF_ERROR   0x00000003

extern int   __stdcall Shell_NotifyIconW(DWORD dwMessage, NOTIFYICONDATAW* lpData);
extern void* __stdcall ShellExecuteW(HWND hwnd, const WCHAR* op, const WCHAR* file,
                                     const WCHAR* params, const WCHAR* dir, int show);

#endif /* SHIM_SHELLAPI_H */

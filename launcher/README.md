# 土拨鼠大作战 3D —— 托盘服务器启动器

双击 `marmot-server.exe` 即可：

1. 自动找到本机的 `node.exe`（依次查找：系统 PATH → 常见安装目录 → WorkBuddy 托管运行时）；
2. 在隐藏窗口启动项目里的 `tools/serve.cjs` 静态服务器（默认 `127.0.0.1:8200`）；
3. 系统托盘出现图标并弹出气泡提示网址，同时自动用默认浏览器打开游戏；
4. **右键托盘图标**可：打开正式版 / 打开 DEV 版 / 复制网址 / 退出（关闭服务器）；
   **双击图标**直接打开正式版。
5. 托盘菜单退出时会用 `taskkill /T /F` 连带结束 node 子进程，端口随之释放。

网址：

- 正式版：http://127.0.0.1:8200/index.html
- DEV 版：http://127.0.0.1:8200/index.html?version=dev

换端口：`marmot-server.exe 9000`（命令行第一个数字即端口）。

> exe 会自动识别自己是放在**游戏根目录**还是 `launcher\` 子目录（以 `tools\serve.cjs` 为锚），
> 所以把整个 `marmot-3d` 文件夹拷到别处也能直接运行；但**单独移动 exe 会找不到游戏**。

## 从源码构建

源码 `tray_launcher.cpp` 刻意保持 **C 兼容**（仅用 Win32 + 宽字符缓冲，零第三方依赖），
三种编译器都能构建：

```bat
:: MSVC（开发者命令提示符）
cl /O2 /DUNICODE /D_UNICODE tray_launcher.cpp /link ^
   user32.lib shell32.lib advapi32.lib /SUBSYSTEM:WINDOWS

:: MinGW-w64 / g++
g++ -O2 -mwindows -municode tray_launcher.cpp -o marmot-server.exe -lshell32 -ladvapi32
```

本仓库自带了一份便携 TCC（`tcc/` 目录，免安装）。其官方二进制包的 Win32 头被精简、
缺少 `shellapi.h`，因此用 `tcc-shim/` 下的最小兼容头 + `shell32.def` 补齐后构建：

```bat
copy /Y tray_launcher.cpp tray_launcher.c
tcc\tcc\tcc.exe -DUNICODE -D_UNICODE -municode ^
    -I tcc-shim -I tcc\tcc\include\winapi ^
    tray_launcher.c tcc-shim\shell32.def ^
    -o marmot-server.exe ^
    -luser32 -lkernel32 -lgdi32 -ladvapi32 -lmsvcrt
```

构建脚本见 `build-tcc.bat`。用 g++ / MSVC 构建时**不需要** `tcc-shim/`（编译器自带完整 Windows SDK 头）。

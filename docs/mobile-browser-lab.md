# MuMu 移动端实验台：浏览器矩阵 · 谷歌三件套 · 篡改猴 · 抓包回归

A hand-written bench manual. What runs inside the MuMu Android 12 image, what does not and
why, how the Google stack was installed, the full path from an APK download to a verified
result, and every trap hit on the way. Everything below was observed on this machine
(`127.0.0.1:16384`, MuMu 5.30.1.3586, Android 12, 900×1600 @320dpi, x86_64 with the ARM
translation layer `ro.dalvik.vm.native.bridge = libnb.so`), not copied from documentation.

Guest root is available and documented in `guest-root-and-module-install.md`; this page assumes
`adb -s 127.0.0.1:16384 root` works.

---

## 1. 浏览器矩阵：哪些能跑，哪些必崩

判据只有一条：**这个浏览器自己带不带 arm64 原生库**。

| 应用 | 包名 | 版本 | `primaryCpuAbi` | 自带原生库 | 结果 |
|---|---|---|---|---|---|
| Via | `mark.via.gp` | 7.3.3 | null | 无 `lib/` 目录 | 能跑（Activity `mark.via.Shell`） |
| X浏览器 | `com.mmbox.xbrowser` | 5.6.4 | null | 无 | 能跑（`.BrowserActivity`） |
| M浏览器 | `cn.mujiankeji.mbrowser` | 3.2.4.0706 | arm64-v8a | `lib/arm64` 空目录 | 能跑 |
| 雨见 WebView 版 | `com.rainsee.create` | 4.0.3.9 | arm64-v8a | 3 个 ≈ 1.0 MB | 能跑（页面渲染交给系统 WebView） |
| 雨见国际版 | `com.yjllq.internet` | 7.5.6.10 | arm64-v8a | Gecko（APK 150.8 MB，内含 `.xpi`） | **能跑** —— 篡改猴的宿主 |
| 雨见谷歌内核版 | `com.yjllq.chrome.beta` | 8.0.3.1 | arm64-v8a | 15 个 ≈ 190 MB（`libchrome.so` 188,617,928 B） | **启动即崩** |

规律：转译层只翻译 **Dalvik/ART 字节码**。纯 Java 的浏览器、或把页面渲染外包给系统
WebView 的浏览器都没问题；一旦 App 自己 dlopen 一个几十上百 MB 的 arm64 原生库（Chromium
的 `libchrome.so`），就会落在转译层里崩掉。

### 谷歌内核版的崩溃指纹（稳定可复现）

```
SIGSEGV  PC #00 00000000064774b4
BuildId 18740dec054ba82678a79151cee98f21b7ed44a9
#07 libchrome.so  Java_org_chromium_...LibraryLoader_1libraryLoaded+68
#08 /system/lib64/arm64/nb/libtcb.so          ← 转译层（houdini/libnb）
tombstone /data/tombstones/app/com.yjllq.chrome.beta/10042.log
```

装完 GMS 再跑一次，**同一 PC、同一 BuildId、同一崩溃栈** —— 见下一节。

---

## 2. 谷歌三件套（GMS）

MuMu 自带一键安装：**小工具 → 谷歌安装器**（`com.nemu.googleinstaller` 12）。装完实测：

| 组件 | 版本 |
|---|---|
| Google Play 服务 | 24.42.33 |
| Google Play 商店 | 23.7.11-21 |
| GSF / 通讯录同步 / Play 游戏 | 已随包装上 |

**实测结论：GMS 与「谷歌内核版启动即崩」零交集。** 装 GMS 前后是同一个 PC、同一个
BuildId、同一条崩溃栈。所以「装了 GMS 也许就能跑 Chrome 内核版」是错的想法 —— 崩的是
ARM 转译层，不是缺失的 Google 库。

---

## 3. 从下载 APK 到出结论的完整流程

```bash
ADB="D:\Tools\android-sdk\platform-tools\adb.exe"
S=127.0.0.1:16384

# 1) 装 App（本机已下好 yj-intl.apk，150.8 MB）
"$ADB" -s $S install -r yj-intl.apk          # 约 7 秒

# 2) 首启必须走完引导（只需一次）
#    协议「同意此协议」→ 功能卡「拓展支持」→ 条款「同意」→「继续」×N
#    →「百变主题」（须先选一张卡片）→「推荐设置」（长列表，要滑到底）
#    →「开始多彩的使用吧」
#    ⚠️ 引导没走完，后面所有 VIEW intent 都会被它吃掉

# 3) 装用户脚本管理器：雨见自带「拓展商店」（必备拓展，收录 16 个）
#    →「篡改猴-V5.3.1」→ 安装 → 同意并安装 → 允许 → 「拓展安装成功了」
#    （国际版的扩展面板是 雨见 → 扩展）

# 4) 装用户脚本
#    打开 https://…/<name>.user.js  → 篡改猴弹出安装页 → 点「安装」
#    已装过时复核页会显示「使用者腳本重新安裝」+「已安裝版本 v1.2.8」
#    ⚠️ 只有 https 会弹安装页，http 不会（见 §4 第 12 条）

# 5) 驱动 + 取结论
"$ADB" -s $S shell "am start -n com.yjllq.internet/cn.yujian.MainActivity \
    -a android.intent.action.VIEW -d 'https://example.com/x'"
```

结论出口（按可靠性排序）：

1. **自己那边的假后端日志** —— 脚本发出去的请求原样落到你手里，最硬；
   `123pan-userscript/capture_regression.py` 就是把它做成自动回归的。
2. `document.title` —— 探针把结论写进标题，`adb shell dumpsys` / 截图都能读。
3. `adb logcat` —— Chromium 系会打请求 URL；Gecko 系基本不打页面控制台。
4. `uiautomator dump` —— 见 §4 第 8 条，Gecko 页面上基本没用。
5. 视觉模型 —— 只能问语义（「这是什么页」），**别拿它给的像素坐标去点**（偏差可达 300+ px）。

---

## 4. 踩坑表

| # | 现象 | 根因 | 处置 |
|---|---|---|---|
| 1 | `am start` 打开链接，结果跑到系统默认浏览器（Chrome） | 没指定包名，系统按默认浏览器分发 | 一律带 `-p <包名>`（或 `-n <包名>/<Activity>`） |
| 2 | `adb shell input text 'https://a/b'` 变成 `https：//a、b` | 中文输入法把半角符号转全角 | 别用 input text 打 URL；用 `am start -d` 传 |
| 3 | 往 AMO 装 `.xpi`，页面只说「下载 Firefox 并安装扩展」 | AMO 不认非 Firefox | 走雨见自带的拓展商店 |
| 4 | `am start -t application/x-xpinstall -d file:///…xpi` 报 unable to resolve | 雨见没声明这个 MIME | 同上，走拓展商店 |
| 5 | `file:///sdcard/Download/x.xpi` → `ERROR_FILE_ACCESS_DENIED` | Android 10+ scoped storage | 别走 file://；需要分发文件就用 `adb push` + App 自己的导入入口 |
| 6 | 篡改猴安装页/任何 Gecko 页面，`uiautomator dump` 只给出一个「主页」 | Gecko 页面不走 Android a11y 文本节点，整页文字塞在 WebView 节点的 `text` 属性里（`&#10;` 当换行） | 读 WebView 节点属性，或直接读 `document.title`；按钮坐标靠像素分析，别按文本找 |
| 7 | 纯文本页（把 `.user.js` 当文本打开）在 a11y 里是一整块 | 同上：整页 = 一个节点 | 同上 |
| 8 | 探针写 `document.title` 但读不到 | 探针自己做了顶层跳转，跳完 title 变成 404 页的 | 探针不要跳转；或跳转后再写一次 title |
| 9 | 模拟器里的 `beacon.log` 读出来全是密文，而且一直在被写 | 本机 DGS 透明加密层接管了该目录（文件头 `17 DA 5F A0`） | 证据改走 `document.title` / logcat / 假后端，别依赖本地日志文件 |
| 10 | 纯 WebView 版雨见里点不动文件夹（`rows=1` 不变） | WebView 里 DOM 合成点击推不动 App 自绘的列表 | 换 Gecko 版（国际版）：同样的脚本 `drilled=1`，DOM 点击能进目录 |
| 11 | 想改 `/system/etc/hosts` 做域名映射 | MuMu 的 `/system` 是只读镜像，`mount -o rw,remount /system` 回 `read-only`，`mount -o bind` 也只在本 shell 命名空间 | 别打 hosts 的主意；用 IP 直连（`10.0.2.2` 就是宿主） |
| 12 | **篡改猴 5.3.1（雨见国际版）对 `http://…/x.user.js` 不弹安装页** | 对照实验：同一台机、同一个脚本、同一条路径，只换 scheme —— `https://` 弹安装页（标签页 1→2），`http://` 只把脚本渲染成源码；且篡改猴**背景页从未回来取脚本**（假后端日志里只有浏览器导航那一条 GET，Accept 是 `text/html,…`） | 安装源必须是 https（自签 CA 或公网 https）；纯 HTTP 的假后端驱动不了这条路 —— `capture_regression.py --engine tm` 此时按契约报 exit 2，不误报 FAIL |
| 13 | 在 PI 的 shell 里起的常驻服务（假后端、信标）过一会儿就没了 | PI 的 shell 把子进程挂在 Job object 上，命令结束即回收 | 用 WMI `Win32_Process Create` → `cmd /c start` 起，并且启动器写成**纯 ASCII 的 .cmd**；注意 WMI 子进程**没有** PI 注入的环境变量（例如 `PI_SCRATCH_DIR`），路径要写死 |
| 14 | `[IO.File]::ReadAllBytes('相对路径')` 报找不到文件 | .NET 用**进程 CWD**，不是 PowerShell 的位置 | 一律绝对路径 |
| 15 | PowerShell 管道里 `.Trim()` 吃到 ErrorRecord 会让整条命令中断 | 管道混入错误记录 | 先 `2>$null` 过滤，或拆成两步 |
| 16 | `sdkmanager` 被中断后，zip 报 `unknown archive` | 下载被截断，`.temp` 里留了半个包 | 清 `%SDK%\.temp` 再下；大文件用 `curl -C -` 循环续传 |
| 17 | 视觉模型给的按钮坐标点不中 | 它给的是「估计」，不是测量值 | 坐标用 a11y 的 `bounds` 或像素分析；视觉只用来问语义 |

---

## 5. 顺手的侦查手段：不装任何东西读篡改猴内部状态

MuMu 有 root，篡改猴（Gecko 扩展）的全部状态都能离线读出来，写自动化时很有用：

```bash
# profile 目录
ls -d /data/data/com.yjllq.internet/files/mozilla/*.default
# 篡改猴的扩展 uuid（注意 prefs.js 里是转义形式 \"firefox@tampermonkey.net\":\"<uuid>\"）
grep -o 'firefox@tampermonkey\.net[^,]*' <profile>/prefs.js
# 它的 IndexedDB（脚本就存在这里）
ls <profile>/storage/default/moz-extension+++<uuid>*/idb/*.sqlite
```

把那个 `.sqlite` 拉回来（sqlite3 直接可读）：

* 表 `object_data`，键名做了**字母 -1** 的混淆：`0$dpogjh` = `0$config`、`0$wfstjpo` = `0$version`；
* 每个脚本 5 条记录：`0@meta$<id>`（元数据）、`0@re$<id>`（**@match/@include**）、
  `0@source$<id>`（源码，UTF-16 存储）、`0@st$<id>`（storage）、`0@uid$<id>`；
* 判断「某个脚本装了没有、覆盖哪些 URL」看 `0@re$` 那条即可 —— 把 `0x00` 去掉就能直接搜字符串。

`123pan-userscript/capture_regression.py --engine tm` 就是这么做的（`tm_engine_probe`）。

---

## 6. 与本手册配套的回归脚本

* `123pan-userscript/capture_regression.py` —— 下载类接口「请求头策略」抓包回归：
  自带假后端（纯 HTTP）+ 从产物生成抓包副本 + 冻结判据 R1~R6 + JSON 报告，
  三种引擎 `via` / `tm` / `none`，退出码 `0=PASS / 1=FAIL / 2=环境不可用`。
* 证据链示例（同一台 MuMu）：`--engine via` 全绿；`--engine tm` 因第 12 条报
  `exit 2 环境不可用` 并落 `out/capture-report-env.json`。

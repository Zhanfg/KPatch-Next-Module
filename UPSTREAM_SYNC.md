# KernelPatch 上游同步状态

## 最后检查: 2026-06-06

### 结论

上游 dev 有 **2 个值得同步的变更**，其余为实验性代码：

| 文件 | diff | 优先级 | 动作 |
|---|---|---|---|
| `kernel/patch/common/secpass.c` | **无差异**(与 main 一致) | — | 已同步 |
| `kernel/patch/common/accctl.c` | **无差异**(与 main 一致) | — | 已同步 |
| `kernel/patch/common/sucompat.c` | **-8 行**: 移除了 `is_trusted_manager_uid` 判断,简化为 `is_su_allow_uid` | P1 | **值得同步** — 减少 manager-specific 逻辑,更通用 |
| `kernel/base/hook.c` | **+68/-55 行**: inlinehook 重构,改为在内核态计算 hook entry address,不再依赖函数序言扫描 | P2 | **值得同步** — 让 non-GKI 4.14+ 内核的 hook 更稳;但变化大,需测试 |
| `kernel/patch/include/uapi/scdefs.h` | 上游 dev 与 main 一致;我们的 fork 多出 27 个自定义 define(0x1120-0x1182) | — | 正常 |
| 其余 10+ 文件 | 无差异 | — | 已同步 |

### 推荐动作

1. **现在同步 `sucompat.c`** — 只删 3 行,改动极小,无风险。
2. **验证后同步 `hook.c`** — inlinehook 重构;需要在 3 种内核版本(4.14/5.10/6.1+)上测试 hook 是否正常。
3. **不跟 `dev` 分支其他实验性提交** — 这些是 dev-only 的开发中的功能(如 kcmd 重构、新的 ci 逻辑等),不适合生产。

### kptools -s 侧信道缓解 — **不适用**

上游 dev commit `ec82432` 是 `bmax121/KernelPatch` 的 kptools 改动(从 `-S <superkey>` 改为 `-s <superkey>`)。

但 **我们的 kptools 来自 `KernelSU-Next/KPatch-Next`**(不是 `bmax121/KernelPatch`)。KPatch-Next 的 kptools CLI 用法:

```c
optstr = "hvpurdfli:k:o:a:M:E:T:N:V:A:"
//      h v p u r d f l  i:k:o:a:M:E:T:N:V:A:
//      ^                  ^                          ^
//      help verbose     input  output  args         args
//      patch unpack     kernel  kpimg
//      repack delete
//      force
//      list
```

**superkey 是 `argv[1]` 位置参数,没有 `-S` 标志**。所以:
- 上游侧信道检测针对 `-S` argv 扫描 — 不适用
- 我们无需同步
- 这是不同 fork 架构的差异,不是 bug

**结论: 任务 E3 (kptools -s 移植) 关闭 — 不适用。**

### 上游 git log (dev, 最近 10 个)

```
8c2d2ae  sucompat: change to inlinehook, skip calculate sizeof pt_regs
decaf80  skip calculate sizeof struct pt_regs
3d9bdeb  su command: fuck compat compat-syscall for 32-bits
6f1781a  fix: hook input_handle_event
cbd6d6d  maintain pt_regs offset
221a3d5  kpatch is deprecated, instead is supercmd; hook improved; add thread local interface
e33d3a6  supercall: Fix super key authentication (#99)
6c59ee8  supercall: Add SUPERCALL_SU_GET_SAFEMODE (#101)
ec82432  kptools with -s instead of -S, to avoid side-channel detection
4455d14  disable hash superkey after reset key
```

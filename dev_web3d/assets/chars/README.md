# 角色方块模型（Blender MCP）

`js/charmodels.js` 由 Blender 生成，`js/models.js` 会优先加载它并覆盖同名内置模型。

## 文件

- `base_units.json`：从 `js/models.js` 提取的基准方块数据（改内置模型后需要重新提取）。
- `build_characters.py`：Blender 5.3 建模 / 导出脚本。
  - 修缮旧模型：补齐手臂、去掉全部“手”方块，手臂在手腕处直接结束。
  - 新建 3 名战术队员与 3 套动力装甲。
  - 导出 `js/charmodels.js`。
  - 渲染 `preview_*.png` 预览图。
- `eofata_chars.blend`：全部 15 个角色的可编辑参考工程（脚本自动保存副本）。
- `preview_existing.png`：旧角色修缮后合影。
- `preview_tactical.png`：战术队员三人。
- `preview_power.png`：动力装甲三人。

## 重新生成

1. 在 Blender 中打开 MCP 连接。
2. 执行：

```python
p = r"...\dev_web3d\assets\chars\build_characters.py"
g = {'__file__': p, '__name__': '__main__'}
exec(compile(open(p, encoding='utf-8').read(), p, 'exec'), g)
```

脚本会在当前 Blender 中新建 `EOFATA_Chars` 场景（不修改原场景），重新导出
`js/charmodels.js` 并覆盖预览图。

## 约定

- 坐标：X 右、Y 上、Z 前，原点在脚底。
- 导出的坐标已经包含游戏里的 `0.78` 垂直压矮，不要再次 `squash`。
- 骨骼分组按部件语义判定：头 / 躯干 / 左腿 / 右腿。胸灯、背包、电台、围巾等低位或后部部件不能绑到头部；靴子、护膝、护胫必须绑定到对应腿。
- 检查工具：`tools/bone_preview.html?key=juggernaut&pose=walk&view=side&t=0.24`，可用 `head=0.8` 检查头部旋转时胸灯是否留在躯干上。
- 新增角色需要同步：`js/lobby.js` 的 `CHARS`、`js/game.js` 的 `CHAR_KEYS`、
  `js/store.js` 的 `CHAR_COUNT`，以及 `js/selftest.js` 的检查数量。

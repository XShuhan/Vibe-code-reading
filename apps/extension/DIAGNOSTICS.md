# 扩展诊断报告

## 问题
Vibe 图标没有显示在 Activity Bar 中

## 可能原因和解决方案

### 1. 扩展没有激活
**检查方法:**
- 在 VS Code 中按 Cmd+Shift+P
- 运行 "Developer: Show Running Extensions"
- 查看是否有 "Code Vibe Reading"

**如果没有:**
- 检查 dist/extension.js 是否存在: $(ls -la dist/)
- 尝试重新构建: cd ~/Projects/code-vibe-reading && pnpm build

### 2. 命令是否存在
**检查方法:**
- Cmd+Shift+P
- 输入 "Vibe:"
- 应该看到: "Vibe: Refresh Index", "Vibe: Ask About Selection" 等

**如果没有命令:**
- 扩展没有正确加载
- 检查控制台错误: Cmd+Shift+P → "Developer: Toggle Developer Tools"

### 3. Views 容器问题
**手动检查:**
- 右键点击 Activity Bar
- 查看是否有 "Vibe" 选项
- 如果没有,可能是 views 注册失败

### 4. 图标问题
**检查:**
- media/icon.svg 是否存在: $(ls -la media/)
- 图标格式是否正确

## 快速修复步骤

1. **完全重启 VS Code**
   - 关闭所有 VS Code 窗口
   - 重新打开扩展目录: code ~/Projects/code-vibe-reading/apps/extension
   - 按 F5 启动调试

2. **检查扩展主机日志**
   - Cmd+Shift+P → "Developer: Open Extension Logs Folder"
   - 查看最新的日志文件

3. **重新构建扩展**
   ```bash
   cd ~/Projects/code-vibe-reading
   pnpm clean 2>/dev/null || true
   pnpm build
   ```

4. **检查 package.json 语法**
   - 确保没有 JSON 语法错误
   - 确保 viewsContainers 和 views 配置正确

## 如果以上都不工作

尝试手动安装扩展:
```bash
cd ~/Projects/code-vibe-reading/apps/extension
vsce package  # 如果有 vsce
# 或者
zip -r code-vibe-reading.vsix dist media package.json
# 然后在 VS Code 中: Extensions → ... → Install from VSIX
```

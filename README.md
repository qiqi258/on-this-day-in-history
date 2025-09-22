# 历史上的今天 - 自动文章发布系统

一个基于GitHub Actions和Vercel的自动化系统，每天自动生成"历史上的今天"相关事件文章并发布到网站。使用Gemini 2.5 Flash模型生成内容，支持双API密钥轮换，确保稳定运行。

## 部署步骤

### 1. 准备工作

- 注册 [GitHub](https://github.com/) 账号
- 注册 [Vercel](https://vercel.com/) 账号
- 获取 [Google AI Studio](https://makersuite.google.com/) API密钥（需要2个用于轮换）

### 2. GitHub仓库设置

1. Fork本仓库到你的GitHub账号下
2. 在仓库设置中启用GitHub Actions（Settings -> Actions -> General）

### 3. 配置GitHub Secrets

1. 进入仓库设置：Settings -> Secrets and variables -> Actions
2. 添加以下密钥：
   - `GEMINI_API_KEY_1`: 第一个Gemini API密钥
   - `GEMINI_API_KEY_2`: 第二个Gemini API密钥

### 4. Vercel部署

1. 登录Vercel账号
2. 点击"New Project"
3. 导入你fork的GitHub仓库
4. 保持默认配置，点击"Deploy"

### 5. 自动化说明

- 每天北京时间8点自动更新内容
- 支持手动触发更新：Actions -> Update Historical Events -> Run workflow
- 内容更新后自动部署到Vercel

## 本地开发

```bash
# 安装依赖
npm install

# 本地运行（需要设置环境变量）
GEMINI_API_KEY_1=your_key_1 GEMINI_API_KEY_2=your_key_2 node generate-events.js
```

## 技术支持

如遇到问题，请检查：

1. GitHub Actions是否正常运行
2. Secrets是否正确配置
3. Vercel部署状态

## 许可证

MIT

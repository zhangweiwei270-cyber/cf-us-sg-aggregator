# CF US/SG Auto Aggregator

一个只做“公开优选源聚合”的 Cloudflare Worker：

- GitHub 保存代码和上游源配置
- Cloudflare Worker 每 30 分钟自动拉取
- 自动提取美国 US / 新加坡 SG
- 自动去重
- 上游失败不会立即覆盖上一版结果
- Workers KV 保存最新列表
- 输出可直接作为远程 TXT 订阅地址

## 输出接口

部署后把 `https://你的Worker域名` 替换成真实地址：

```text
https://你的Worker域名/us.txt
https://你的Worker域名/sg.txt
https://你的Worker域名/all.txt
https://你的Worker域名/status.json
https://你的Worker域名/sources.json
```

也支持：

```text
/us.txt?limit=20
/sg.txt?limit=30&port=443
```

## 1. 创建 GitHub 仓库

新建一个仓库，例如：

```text
cf-us-sg-aggregator
```

把本项目全部文件上传到仓库。

## 2. 创建 Cloudflare KV

### 方法 A：网页操作

Cloudflare 控制台创建一个 Workers KV namespace，例如：

```text
cf-us-sg-data
```

复制它的 Namespace ID。

打开 `wrangler.jsonc`，把：

```text
YOUR_KV_NAMESPACE_ID
```

替换成真实 Namespace ID 后提交到 GitHub。

### 方法 B：Wrangler

本机进入项目目录：

```bash
npm install
npx wrangler login
npx wrangler kv namespace create CFIP_KV
```

命令会返回 Namespace ID，把它填进 `wrangler.jsonc`。

## 3. GitHub 连接 Cloudflare Workers

Cloudflare 控制台：

```text
Workers & Pages
→ Create application
→ Import a repository
→ 选择 GitHub 仓库
→ Save and Deploy
```

Cloudflare Workers Builds 支持 GitHub 自动部署。以后修改 `src/sources.js`
并 push 到 GitHub，Cloudflare 会自动重新部署代码。

## 4. 配置手动刷新密钥（推荐）

可以在 Cloudflare Worker 的 Settings / Variables and Secrets 中增加：

```text
ADMIN_TOKEN = 你自己生成的一串长随机字符
```

设为 Secret。

然后手动触发：

```bash
curl -X POST "https://你的Worker域名/refresh" \
  -H "Authorization: Bearer 你的ADMIN_TOKEN"
```

不设置也没关系，Cron 到点会自动聚合。

## 5. 自动更新时间

默认：

```text
17,47 * * * *
```

即每小时第 17、47 分钟运行，约每 30 分钟一次。

Cron 使用 UTC，但这个项目只关心间隔，因此无需换算时区。

## 6. 添加或删除上游

编辑：

```text
src/sources.js
```

例如强制归为美国：

```js
{
  name: "My-US",
  url: "https://example.com/us.txt",
  country: "US",
  priority: 100
}
```

强制归为新加坡：

```js
{
  name: "My-SG",
  url: "https://example.com/sg.txt",
  country: "SG",
  priority: 100
}
```

让程序从备注中的 US / SG / LAX / SJC / SIN 等标签自动判断：

```js
{
  name: "Mixed",
  url: "https://example.com/all.txt",
  country: "AUTO",
  priority: 80
}
```

## 7. 推荐给你的“自定义优选”填写方式

只想要美国：

```text
https://你的Worker域名/us.txt?limit=50
```

只想要新加坡：

```text
https://你的Worker域名/sg.txt?limit=50
```

两者一起：

```text
https://你的Worker域名/all.txt
```

仅保留 443：

```text
https://你的Worker域名/us.txt?port=443&limit=30
https://你的Worker域名/sg.txt?port=443&limit=30
```

## 8. 为什么不用 GitHub Actions 每 30 分钟提交一次？

因为这种项目的数据变化很频繁，把每次数据更新都变成 Git commit + Pages
重新部署并不划算。

本项目采用：

```text
GitHub = 保存代码/源配置
Cloudflare Cron = 定时采集
KV = 保存最新数据
Worker = 输出 TXT API
```

因此数据更新不需要重新部署代码。

## 9. 注意

本项目不对互联网任意地址进行端口扫描，只聚合公开发布的候选源。
“US / SG”标签来自上游发布信息或 Colo/地区备注；Cloudflare Anycast IP
并不是永久物理绑定到单一国家，所以最终速度仍应由你的客户端线路实测。

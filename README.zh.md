# dsh-plugin-mirobody

**[English](README.md)** · **中文**

把 [Mirobody](https://github.com/thetahealth/mirobody) 的术语引擎和只读记录工具装进 DeepSeek Harness。指标名收成一个 LOINC，单位收成 UCUM，病历、用药和基因型仍从 Mirobody 自己的 `/mcp` 读取。

Python 引擎继续负责解析。这个包是 Harness 侧：8 个工具、4 个技能、一个 Mirobody 页签和斜杠命令。LOINC 词表、Postgres、手环 OAuth 和文件入库仍在 Mirobody 里，没有重写。

## 安装

需要 Node 22.19+、pnpm（`dsh plugin` 用它装包）和能 `import mirobody` 的 Python 3.12+。

**和 [dsh-plugin-longpi](https://github.com/zwbao/dsh-plugin-longpi) 一起用时不用单独装。** LongPi 把本插件声明为依赖，`dsh plugin add` 会一起装进 profile，由 LongPi 按它自己那一行的配置挂载。再单独 `add` 一次会让同一组工具注册两遍。

单独使用：

```bash
# 1. Python 引擎（离线术语解析用）
python3.12 -m venv ~/.venvs/mirobody && ~/.venvs/mirobody/bin/pip install mirobody

# 2. 装进 DSH 的 web profile（profile 不存在会自动初始化）
dsh plugin --profile web add github:zwbao/dsh-plugin-mirobody
```

然后在 `~/.dsh/profiles/web/cordis.patch.yml` 里覆盖这一行的配置（文件里原来的 `[]` 换成下面的内容）。补丁会整体替换这一行的 `config`，所以每个键都要写：

```yaml
- id: dsh-plugin-mirobody
  config:
    pythonBin: /Users/you/.venvs/mirobody/bin/python   # 换成你的绝对路径
    mirobodyHome: ''
    mcpUrl: http://127.0.0.1:18060/mcp/<个人密钥>      # Mirobody 设置 → MCP 里复制
    mcpToken: ''
    timeoutMs: 30000
```

`dsh --profile web --dump-config` 能看到这一行生效，然后重启 `dsh web`。从源码装：`git clone https://github.com/zwbao/dsh-plugin-mirobody && cd dsh-plugin-mirobody && npm install && npm test && dsh plugin --profile web add link:$PWD`。

| 字段 | 含义 |
| --- | --- |
| `pythonBin` | 能导入 mirobody 的解释器。留空时依次尝试 `python3.14`、`python3.13`、`python3.12`、`python3`。 |
| `mirobodyHome` | 可选的源码目录，会放进 `sys.path`。源码树要先 `git lfs pull`，否则没有 LOINC 数据包。 |
| `mcpUrl` | 记录服务器。Mirobody 设置 → MCP 里的个人地址（`…/mcp/<密钥>`，默认 30 天有效，Mirobody 的 `MCP_URL_TTL_DAYS` 可改），或 `http://127.0.0.1:18060/mcp` 加 `mcpToken`。 |
| `mcpToken` | 地址本身不带凭证时，填账号 JWT（`POST /password/login` 返回的 `access_token`，默认 30 天有效）。只做术语解析可以留空。 |
| `timeoutMs` | 桥和 MCP 的时限，默认 `30000`。第一次解析要加载词表，可能更慢。 |

Python 桥只拿到最小的环境变量，不继承 Harness 自己的：`PATH`、`HOME`、`LANG`、`LC_ALL`、`TMPDIR`、`MIROBODY_HOME`（来自 `mirobodyHome`）、`PYTHONNOUSERSITE=1` 和 `PYTHONDONTWRITEBYTECODE=1`。所以 `pythonBin` 要能从自己的 site-packages 导入 `mirobody`（即上面的 venv）；`pip install --user` 装的副本和 `PYTHONPATH` 都看不到。源码目录请用 `mirobodyHome`。

## 工具

| 工具 | 在哪执行 | 返回什么 |
| --- | --- | --- |
| `resolve_indicator` | 本机引擎 | 每个印刷名对应的 LOINC。解析不了就是空，不会猜一个码。 |
| `resolve_reading` | 本机引擎 | 名字加上数值和单位后的 LOINC。单位会改码。 |
| `convert_unit` | 本机引擎 | 换算后的数；单位不能互化时 `converted` 为 null。 |
| `normalize_unit` | 本机引擎 | UCUM 写法和性质族。 |
| `query_health_indicators` | Mirobody `/mcp` | 目录、原始行、分桶、统计或最新值。 |
| `query_medications` | Mirobody `/mcp` | 用药计划、服药记录或疗程。只读。 |
| `query_genetic_data` | Mirobody `/mcp` | 指定 rsID 的基因型。文件里没有的 rsID 是“没分型”，不是阴性。 |
| `mirobody_status` | 本机 | 引擎能否导入、`mcpUrl` 是否已填。不返回病历，也不返回 token。 |

## 命令和 HTTP

- `/mirobody` — 引擎版本，以及 MCP 是否已配置
- `/mirobody-resolve 血红蛋白 血脂` — 离线解析
- `/mirobody-version`
- `GET /api/mirobody/status`
- `GET /api/mirobody/resolve?q=血红蛋白&q=血脂`
- `GET /api/mirobody/version`

网页页签名为 **Mirobody**。它会带上打开 DSH 时地址栏里的 `token`。

## 边界

不是医疗器械。不下诊断，不改剂量。紧急情况只回复拨打 120（在美国为 988），然后停止。详见 [docs/intended-use.md](docs/intended-use.md)。

`血红蛋白` 解析为 `718-7`。`血脂` 解析为空，因为它是一类检查而不是一项。总胆固醇 `5.0 mmol/L` 解析为 `14647-2`。

Apache-2.0。Mirobody 和术语许可见 [NOTICE](NOTICE)。

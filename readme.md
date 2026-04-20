# LLM 论文可视化（课程项目）

本项目参考 mbtaviz 的单页叙事思路，当前处于骨架搭建完成阶段。
目标是先稳定结构与样式治理，再逐步接入真实数据、图表与交互逻辑。

## 当前开发状态（2026-04-20）

1. 页面骨架已完成。
2. 模块挂载位已完成。
3. 占位组件已完成。
4. 样式变量化重构已完成（便于后续统一改风格）。
5. 图表与交互逻辑尚未接入（下一阶段工作）。

## 已完成内容

1. 架构调整
- 已从“JS 拼页面”迁移为“HTML 骨架 + JS 挂载”。
- `index.html` 负责结构，`src/main.js` 负责模块初始化。

2. 模块拆分
- 河流图与力导向图已拆分为两个独立模块。
- 5 个模块均有独立目录与入口文件，适合并行开发。

3. 样式治理
- 颜色、字号、间距、布局参数已集中到 `styles/main.css` 的 `:root` 变量。
- 当前不使用内联样式，样式统一在 CSS 层管理。
- 类名以结构语义为主，避免表现型命名。

## 项目结构（当前）

```text
llmviz/
├─ index.html
├─ readme.md
├─ 可视化大作业规划.md
├─ data/
│  ├─ raw/                      # 原始论文与引用数据
│  └─ processed/                # 前端直接读取的清洗数据
├─ media/                       # 截图、图标、汇报素材
├─ public/
│  └─ world.geojson             # 世界地图底图（机构散点图）
├─ scripts/
│  └─ prepare-data.js           # 数据预处理入口（占位）
├─ styles/
│  └─ main.css                  # 全局样式与设计变量
└─ src/
   ├─ main.js                   # 模块挂载与初始化
   ├─ shared/
   │  ├─ data-loader.js         # 数据加载工具
   │  └─ module-placeholder.js  # 通用占位组件
   └─ modules/
      ├─ theme-river/
      │  └─ index.js            # 主题河流图（占位）
      ├─ paper-force/
      │  └─ index.js            # 论文力导向图（占位）
      ├─ butterfly-path/
      │  └─ index.js            # 蝴蝶脉冲路径图（占位）
      ├─ institution-map/
      │  └─ index.js            # 机构影响力世界地图（占位）
      └─ ai-history/
         └─ index.js            # AI 简史生成器（占位）
```

## 开发约定（已落地）

1. 语义化类名稳定，不使用表现型命名。
2. 颜色、字号、间距优先走变量（design tokens）。
3. 不在模块里写内联样式，统一走样式层。

## 下一步计划

1. 定义最小数据契约
- `nodes.json`、`edges.json`、`keyword_trends.json`、`institutions_geo.json`。

2. 先跑通两大核心图
- 主题河流图（time trend）
- 论文力导向图（citation network）

3. 接入联动与交互
- 时间刷选
- 节点高亮
- 路径追踪

4. 完善剩余模块
- 机构地图散点图
- 蝴蝶脉冲路径细节
- AI 简史生成器（后置）

## 运行方式（当前静态阶段）

使用本地静态服务器打开项目根目录，例如：

```powershell
npx http-server .
```

然后访问命令行输出的本地地址。

# LLM 论文可视化（课程项目）

本项目参考 mbtaviz 的单页叙事方式，采用“HTML 骨架 + JS 模块挂载 + JSON 驱动可视化”的轻量架构。
当前目标是先完成可解释的原型图表，再逐步补齐交互联动与视觉优化。

## 当前开发状态（2026-04-23）

### 阶段性结论

已从“纯占位”进入“可运行原型”阶段：

1. 前 4 个核心图表已落地为可运行的简版可视化。
2. 第 5 个模块（AI 简史）仍保留占位。
3. 当前已经可以完整讲述项目核心想法，下一阶段重点是增强交互和美化表现。

### 已完成内容

1. 页面与架构
- 已从 JS 拼接页面迁移到 HTML 静态骨架。
- 统一由 `src/main.js` 进行模块初始化与挂载。

2. 图表模块（4/5 已完成原型）
- Module 01 主题河流图：支持年份滑块、Top 关键词高亮。
- Module 02 论文力导向图：支持年份过滤、简易力模拟、阶段着色。
- Module 03 蝴蝶路径图：以中心论文展开局部网络，支持目标论文路径高亮。
- Module 04 机构世界地图：支持底图渲染、机构散点叠加、颜色/尺寸维度切换。
- Module 05 AI 简史生成器：仍为占位模块。

3. 数据与资源
- 已在 `data/processed` 生成并接入 demo 数据：`nodes.json`、`edges.json`、`keyword_trends.json`、`institutions_geo.json`、`phases.json`。
- 世界地图底图 `public/world.geojson` 已可用（非空 features）。

4. 样式治理
- 全局 token 保留在 `styles/main.css`。
- 图表样式已按模块拆分到 `styles/charts/*.css`，降低耦合，便于后续单图迭代。
- 无内联样式，语义类名策略保持一致。

## 最新项目结构

```text
llmviz/                                # 项目根目录
├─ index.html                          # 页面骨架与模块挂载容器
├─ readme.md                           # 项目说明与开发进度
├─ 可视化大作业规划.md                  # 课程作业规划文档
├─ data/                               # 数据目录
│  ├─ raw/                             # 原始数据占位（未清洗）
│  │  └─ .gitkeep                      # 保留空目录
│  └─ processed/                       # 前端直接消费的处理后数据
│     ├─ .gitkeep                      # 保留空目录
│     ├─ nodes.json                    # 论文节点数据
│     ├─ edges.json                    # 引用边数据
│     ├─ keyword_trends.json           # 关键词年度趋势数据
│     ├─ institutions_geo.json         # 机构地理分布数据
│     ├─ phases.json                   # 阶段划分与阶段标签
│     └─ butterfly_paths.json          # 预计算路径数据（当前备用）
├─ media/                              # 展示素材目录（图片/录屏等）
│  └─ .gitkeep                         # 保留空目录
├─ public/                             # 静态资源目录
│  └─ world.geojson                    # 世界地图底图 GeoJSON
├─ scripts/                            # 数据处理与构建脚本
│  └─ prepare-data.js                  # 数据预处理入口脚本
├─ styles/                             # 样式目录
│  ├─ main.css                         # 全局 token 与主样式入口
│  └─ charts/                          # 各图表拆分样式
│     ├─ chart-common.css              # 图表通用样式
│     ├─ theme-river.css               # 主题河流图样式
│     ├─ paper-force.css               # 力导向图样式
│     ├─ butterfly-path.css            # 蝴蝶路径图样式
│     └─ institution-map.css           # 机构地图样式
└─ src/                                # 前端源码目录
   ├─ main.js                          # 应用启动与模块初始化
   ├─ shared/                          # 共享工具模块
   │  ├─ data-loader.js                # JSON 数据加载工具
   │  └─ module-placeholder.js         # 通用占位组件渲染
   └─ modules/                         # 业务可视化模块
      ├─ theme-river/
      │  └─ index.js                   # Module 01 主题河流图
      ├─ paper-force/
      │  └─ index.js                   # Module 02 论文力导向图
      ├─ butterfly-path/
      │  └─ index.js                   # Module 03 蝴蝶脉冲路径图
      ├─ institution-map/
      │  └─ index.js                   # Module 04 机构影响力地图
      └─ ai-history/
         └─ index.js                   # Module 05 AI 简史（当前占位）
```

## 开发约定（保持不变）

1. 优先语义化类名，不使用表现型命名。
2. 颜色、字号、间距走 design tokens。
3. 模块不写内联样式，统一在样式层管理。
4. 数据读取统一通过 `src/shared/data-loader.js`。

## 下一阶段重点

1. 补全 AI 简史模块最小可用版本，完成 5/5 模块去占位。
2. 增加跨图联动（时间、节点选择、路径追踪）。
3. 完善交互细节（hover、tooltip、状态提示、空态与错误态）。
4. 统一视觉系统（颜色层级、字号密度、图例和控件样式）。
5. 视课程展示需求补充导出与讲解视图。

## 运行方式

在项目根目录启动本地静态服务器，例如：

```powershell
npx http-server .
```

访问命令行输出地址即可。

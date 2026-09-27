# 脚本编写指南

图库目录千奇百怪，脚本就是用来吸收这些差异的：**决定怎么把目录拆成角色与图片组**，以及**从一堆图里挑出该入库的那张**。

---

## 脚本是什么

- 一个 **CommonJS** 的 `.js` 文件，`module.exports` 导出若干具名函数。
- 在「脚本管理」页导入后，正文被**复制**到用户目录的 `scripts/` 下，库里只留索引（名称、文件路径、分组）。**那份文件就是唯一副本**：它被删掉或损坏，这条脚本就不能执行了。
- 框架按导出函数的**名字**识别类型，导入时自动检测并打标签。
- 脚本在**主进程**执行，拥有完整 Node 权限。
- **新库自带一份内置默认脚本**（脚本列表里名为「默认」）：三种方法齐全，装完就能直接扫描。
  它的正文和普通脚本一样是 `scripts/` 下的一个文件，区别只在**不能删除**；右键的**「恢复默认」**会用随应用发布的源码把文件覆盖回出厂版本，文件被删也能借此重建。

```javascript
module.exports = {
    "identify-structure": ({ rootPath, tree }) => [ /* ... */ ],
    "select-image": ({ characterName, groupDirPath, files }) => "某个 uuid",
    "identify-character": (dirName) => String(dirName).trim(),
};
```

---

## 三种脚本类型

| 类型 | 何时被调用 | 签名 | 返回值 |
|---|---|---|---|
| `identify-structure` | 扫描任务开始时，一次 | `({ rootPath, tree })` | `Array<{ name, groups }>` |
| `select-image` | 批量选图任务中，每个图片组一次 | `({ characterName, groupDirPath, files })` | 文件的 `uuid`（字符串） |
| `identify-character` | **框架不直接调用** | `(dirName)` | 角色名（字符串） |

> `identify-character` 会被检测、会显示在脚本列表里，但框架从不调用它。惯例做法是把它定义成普通函数，由 `identify-structure` 内部自己调用（见 `src/static/default-script.js`）。这样做的好处是同一套命名清洗逻辑只写一次。

---

## identify-structure

把目录树映射成「角色 → 图片组」。

### 输入

```typescript
{
    rootPath: string,     // 图库根目录绝对路径
    tree: DirNode[],      // 根目录下的节点
}

interface DirNode {
    name: string,
    path: string,         // 绝对路径
    children: DirNode[] | null,   // null = 文件；[] = 空目录；非空 = 有子节点
}
```

- 目录树**只含目录与文件名**，不含图片尺寸等元数据（遍历阶段刻意不读图片内容）。
- 以 `.` 开头的隐藏项已被跳过。

### 输出

```typescript
Array<{
    name: string,      // 角色名
    groups: string[],  // 图片组路径，**相对图库根目录**，用 / 分隔
}>
```

同一个 `name` 出现多次会被合并（按角色名去重），因此可以放心地把多个源目录映射到同一个角色。

### 示例：第一层是角色、第二层是图片组

这是内置默认脚本 `default-script.js` 的做法，适配「角色目录 / 图片组目录 / 图片」结构：

```javascript
const identifyCharacter = (dirName) => {
    let name = String(dirName).trim();
    const dashIndex = name.indexOf("-");
    if (dashIndex >= 0) {
        name = name.slice(dashIndex + 1).trim();   // "A-阿波尼亚" → "阿波尼亚"
    }
    return name;
};

const identifyStructure = ({ tree }) => {
    const byCharacter = new Map();

    for (const node of tree) {
        if (!node.children) continue;                 // 跳过根目录下的散放文件

        const name = identifyCharacter(node.name);
        if (!byCharacter.has(name)) byCharacter.set(name, []);

        const subDirs = node.children.filter((child) => child.children !== null);
        if (subDirs.length > 0) {
            for (const sub of subDirs) byCharacter.get(name).push(node.name + "/" + sub.name);
        } else {
            byCharacter.get(name).push(node.name);    // 没有子目录，角色目录本身就是图片组
        }
    }

    return [...byCharacter.entries()].map(([name, groups]) => ({ name, groups }));
};
```

### 示例：只处理某几个角色

调试时常这么写，避免每次全量扫描：

```javascript
return [...byCharacter.entries()]
    .filter(([name]) => name.includes("流萤"))
    .map(([name, groups]) => ({ name, groups }));
```

---

## select-image

从图片组里挑一张入库。

### 输入

```typescript
{
    characterName: string,     // 角色名
    groupDirPath: string,      // 图片组绝对路径（想自己遍历文件系统也可以）
    files: Array<{
        uuid: string,          // 临时 UUID，返回它表示选中该文件
        fileName: string,
        filePath: string,
        width: number | null,  // 读不到尺寸时为 null
        height: number | null,
        fileSize: number,      // 字节
        ext: string,           // 小写、无点
    }>,
}
```

- `files` 已含元数据，**不需要也不应该再扫描目录**。
- `uuid` 每次调用都会重新生成，只在本轮调用内有效；不要缓存。

### 输出

**必须返回 `files` 中某个元素的 `uuid`**。返回不存在的值会被记为一次失败。

### 示例：挑「电脑」版里最大的一张

```javascript
const selectImage = ({ files }) => {
    const candidates = files
        .filter((file) => file.fileName.includes("电脑"))
        .sort((a, b) => a.fileSize - b.fileSize);

    if (candidates.length === 0) throw new Error("没有找到电脑版壁纸");
    return candidates[candidates.length - 1].uuid;
};
```

### 示例：按分辨率挑，并排除封面

```javascript
const selectImage = ({ files }) => {
    const candidates = files
        .filter((file) => !/封面|cover|thumb/i.test(file.fileName))
        .filter((file) => (file.width ?? 0) >= 1920 && (file.height ?? 0) >= 1080)
        .sort((a, b) => (b.width * b.height) - (a.width * a.height));

    if (candidates.length === 0) throw new Error("没有符合分辨率要求的图片");
    return candidates[0].uuid;
};
```

---

## 错误处理

| 场景 | 结果 |
|---|---|
| `select-image` 抛错 | **该图片组**计为失败，脚本继续处理其余图片组；其余组不受影响 |
| `select-image` 返回未知 uuid | 同上，计为一次失败 |
| `identify-structure` 抛错 | **整个扫描任务失败**，图库原有数据保持不变（此时尚未动数据库） |
| 脚本语法错误 / 顶层抛错 | 导入时就能发现：该脚本的类型标签会是空的 |

因此 **`select-image` 里遇到无法处理的图片组，直接 `throw` 是正确做法**——它等价于「这组跳过」。

---

## 调试

- 脚本里的 `console.log` / `console.error` 输出到**主进程控制台**，也就是你运行 `yarn dev` 的那个终端，**不是**窗口的 DevTools。
- 改完脚本源码后**什么都不用点**：每次调用前都重新读盘并编译（按路径 + mtime + 大小判断要不要重读），下一次扫描 / 选图就用新内容。只有脚本管理页里**正打开着**的那一份是例外——它停留在打开时读到的那一版，重新打开它（或右键「放弃修改」）才会看到磁盘上的新内容。
- 任务失败的原因会显示在「任务管理」页对应任务的错误栏里，直接看那里最快。

---

## 限制与安全

**限制**

- 只能用 CommonJS（`module.exports`），不能用 `import`。
- `require('./helper')` 可用：编译时传入了脚本文件自己的路径，相对路径按**脚本文件所在目录**（用户目录的 `scripts/`）解析——前提是 helper 也在那个目录里（「加载文件」只复制你选中的那一个文件）。
- 想让脚本复用别的脚本，就把 helper 放进 `scripts/`，或者把逻辑写进同一个文件。

**安全**

- 脚本**没有沙箱**，运行在主进程，可 `require` 任意 Node 模块、读写任意文件。
- **导入时就会执行顶层代码**（检测导出类型需要先编译一次），所以导入一个脚本等于运行它。
- 只导入你信任的脚本。

---

## 从零写一个：适配「角色下只有一个图片组长目录」

这类图库长这样：

```
动漫游戏人物/
└── A-阿尼亚/
    └── 01 阿尼亚 转存后再下载 防丢失/
        ├── 电脑.jpeg
        ├── 平板.jpeg
        ├── 手机.jpeg
        ├── 封面.png          ← 不是壁纸
        └── Thumbs.db         ← 系统文件，扫描阶段已跳过
```

```javascript
const identifyCharacter = (dirName) => String(dirName).trim().replace(/^[A-Z]-/, "");

const identifyStructure = ({ tree }) => {
    const characters = [];
    for (const node of tree) {
        if (!node.children) continue;
        const groups = node.children
            .filter((child) => child.children !== null)
            .map((child) => node.name + "/" + child.name);
        // 角色下没有子目录时，把角色目录本身当作图片组
        characters.push({ name: identifyCharacter(node.name), groups: groups.length ? groups : [node.name] });
    }
    return characters;
};

const selectImage = ({ files }) => {
    const devices = ["电脑", "平板", "手机"];
    const device = devices.find((name) => files.some((file) => file.fileName.includes(name)));
    if (!device) throw new Error("没有识别到设备类型");

    const candidates = files
        .filter((file) => file.fileName.includes(device))
        .sort((a, b) => b.fileSize - a.fileSize);

    return candidates[0].uuid;
};

module.exports = {
    "identify-character": identifyCharacter,
    "identify-structure": identifyStructure,
    "select-image": selectImage,
};
```

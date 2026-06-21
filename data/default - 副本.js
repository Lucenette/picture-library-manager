/**
 * 示例脚本
 */

const path = require("path");

const IMG_EXT_SET = new Set([".png", ".jpg", ".jpeg", ".webp"]);

/**
 * 识别角色名称 - 从目录名提取角色名
 *
 * 处理规则：
 *   1. 输入为空 → 报错
 *   2. 含 "-" → 取第一个 "-" 之后的部分
 *   3. 否则数字开头 → 去除开头连续数字
 *   4. 否则返回原始名称
 *   5. 处理结果为空 → 报错
 *
 * @param {string} dirName 角色目录名称
 * @returns {string} 角色名称
 */
const identifyCharacter = dirName => {
    let name = String(dirName).trim();
    if (!name) {
        throw new Error("角色目录名称为空");
    }

    const dashIdx = name.indexOf("-");
    if (dashIdx >= 0) {
        name = name.slice(dashIdx + 1).trim();
    } else {
        const match = name.match(/^(\d+)/);
        if (match) {
            name = name.slice(match[1].length).trim();
        }
    }

    if (!name) {
        throw new Error("角色名称处理结果为空");
    }
    return name;
};

/**
 * 目录结构识别 - 将图库目录树映射为角色→图片组结构
 *
 * 默认行为：第一层子目录是角色，第二层子目录是图片组
 * 对于编号型图库（第一层是"51雷电将军"），由 identifyCharacter 清洗角色名
 *
 * @param {Object}   ctx
 * @param {string}   ctx.rootPath  图库根路径
 * @param {Object[]} ctx.tree      目录树（name/path/children）
 * @returns {Array<{ name: string, groups: string[] }>}
 */
const identifyStructure = ({ rootPath, tree }) => {
    const charMap = new Map();

    for (const node of tree) {
        if (!node.children) continue;
        const charName = identifyCharacter(node.name);

        if (!charMap.has(charName)) {
            charMap.set(charName, []);
        }

        const subDirs = node.children.filter(c => c.children !== null);
        if (subDirs.length > 0) {
            for (const sd of subDirs) {
                charMap.get(charName).push(node.name + "/" + sd.name);
            }
        } else {
            charMap.get(charName).push(node.name);
        }
    }

    return Array.from(charMap.entries()).map(([name, groups]) => ({ name, groups }));
};

/**
 * 输入的文件信息
 *
 * @typedef {Object} SelectImageFile
 * @property {string}      uuid      - 文件临时 UUID
 * @property {string}      fileName  - 文件名（含扩展名）
 * @property {string}      filePath  - 文件绝对路径
 * @property {number|null} width     - 图片宽度（像素）
 * @property {number|null} height    - 图片高度（像素）
 * @property {number}      fileSize  - 文件大小（字节）
 * @property {string}      ext       - 扩展名（小写，无点）
 */

/**
 * 选择合适的图片 - 基于已有文件元数据，过滤后取第一个
 *
 * @param {Object} ctx
 * @param {string} ctx.characterName - 角色名称
 * @param {string} ctx.groupDirPath  - 图片组路径（如需自行扫描）
 * @param {SelectImageFile[]} ctx.files - 文件列表
 * @returns {string} 被选中的文件的 uuid
 */
const selectImage = ({ characterName, groupDirPath, files }) => {
    const filtered = files.filter(f => IMG_EXT_SET.has(path.extname(f.fileName).toLowerCase()));
    if (!filtered || filtered.length === 0) {
        throw new Error("没有可选的图片");
    }
    return filtered[0].uuid;
};

module.exports = {
    "identify-character": identifyCharacter,
    "identify-structure": identifyStructure,
    "select-image": selectImage,
};

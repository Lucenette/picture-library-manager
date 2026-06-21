/**
 * 示例脚本
 */

const fs = require("fs");
const path = require("path");

const IMG_EXT_SET = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"]);

/**
 * 识别角色名称 - 使用目录名本身
 *
 * @param dirName 角色目录名称
 * @returns {string} 角色名称
 */
const identifyCharacter = dirName => {
    return String(dirName);
};

/**
 * 选择合适的图片 - 递归子目录，取第一个可用的图片
 *
 * @param dir 图片组的绝对路径
 * @returns {string|*} 被选中的图片的绝对路径
 */
const selectImage = dir => {
    const entries = fs.readdirSync(dir);
    let firstDir = null;
    for (const entry of entries) {
        const full = path.join(dir, entry);
        const stat = fs.statSync(full);
        if (stat.isFile() && IMG_EXT_SET.has(path.extname(entry).toLowerCase())) {
            return full;
        }
        if (!firstDir && stat.isDirectory()) {
            firstDir = full;
        }
    }
    if (firstDir) {
        return selectImage(firstDir);
    }
    throw new Error("没有找到图片");
};

module.exports = {
    "identify-character": identifyCharacter,
    "select-image": selectImage,
};

/**
 * pick-first.js —— 取第一个可用的图片
 *
 * 逻辑：
 * 1. 在当前目录找第一张图片（png/jpg/jpeg/gif/webp/bmp）
 * 2. 没有图片则进第一个子目录递归找
 * 3. 没有子目录也没有图片则抛错跳过
 *
 * 适用于：图片都在单层子目录下的图包
 */
const fs = require('fs');
const path = require('path');

const IMG_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']);

module.exports = function(groupDirPath) {
    const entries = fs.readdirSync(groupDirPath);
    let firstDir = null;

    for (const entry of entries) {
        const full = path.join(groupDirPath, entry);
        const stat = fs.statSync(full);
        if (stat.isFile() && IMG_EXTS.has(path.extname(entry).toLowerCase())) {
            return full;
        }
        if (!firstDir && stat.isDirectory()) {
            firstDir = full;
        }
    }

    if (firstDir) {
        return module.exports(firstDir);
    }

    throw new Error('没有找到图片');
};

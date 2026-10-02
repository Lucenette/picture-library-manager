/** 「更新详情」的一节 */
export interface ChangelogSection {
  version: string;
  body: string;
}

/** 把 CHANGELOG 拆成有序小节；顺序与文件一致（新的在前） */
export function changelogSections(text: string): ChangelogSection[];

/** 只比 x.y.z 三段；非版本号（`未发布`）按「更新」处理，返回 1 */
export function compareVersions(left: string, right: string): number;

/** 上次发布以来的小节；找不到那一节时退回按版本号比较 */
export function sectionsSinceLastRelease(sections: ChangelogSection[], previousTag: string): ChangelogSection[];

/** 拼成「更新详情」的正文：只有一节原样输出；多节按版本分块、节内标题降一级 */
export function formatSections(sections: ChangelogSection[]): string;

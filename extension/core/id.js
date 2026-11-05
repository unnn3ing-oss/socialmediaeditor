// 固定外掛 ID：由 manifest 的 key（公鑰 DER 的 base64）算出。
// SHA-256 前 32 個 hex 字元，0-f 對應 a-p。每台電腦載入同一份外掛，ID 都相同。
// 這支只給測試與文件核對用（用到 node:crypto），外掛本體不載入它。
import { createHash } from 'node:crypto';

export const EXT_ID = 'odajlpffjjeiliinefhimmbpdeeggckg';

export function extensionIdFromKey(b64) {
  const hex = createHash('sha256').update(Buffer.from(b64, 'base64')).digest('hex').slice(0, 32);
  return [...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
}

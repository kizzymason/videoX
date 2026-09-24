import { decryptSecret, encryptSecret } from '../../core/secret-box.js';

/** 采集侧沿用的名字，实现已并入 core/secret-box，避免两份 AES 逻辑各自漂移。 */
export const encryptCredential = encryptSecret;
export const decryptCredential = decryptSecret;

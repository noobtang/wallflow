/** 生成 RFC4122 v4 UUID(不依赖 crypto,小程序环境可用) */
export function generateUuid(): string {
  const hex = '0123456789abcdef';
  let s = '';
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) {
      s += '-';
    } else if (i === 14) {
      s += '4'; // version 4
    } else if (i === 19) {
      s += hex[(Math.random() * 4 + 8) | 0]; // variant 10xx
    } else {
      s += hex[(Math.random() * 16) | 0];
    }
  }
  return s;
}
